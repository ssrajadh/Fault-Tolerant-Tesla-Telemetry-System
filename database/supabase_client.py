"""
Supabase client for Tesla Telemetry System
Handles database operations for telemetry data
"""

import os
from typing import Optional, List, Dict
from supabase import create_client, Client
from dotenv import load_dotenv
import logging

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)


class SupabaseClient:
    """Wrapper for Supabase operations"""
    
    def __init__(self):
        self.url = os.getenv("SUPABASE_URL")
        self.key = os.getenv("SUPABASE_SERVICE_KEY")  # Use service key for server-side
        
        if not self.url or not self.key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        
        self.client: Client = create_client(self.url, self.key)
        logger.info("Supabase client initialized")
    
    def get_vehicle_by_vin(self, vin: str) -> Optional[Dict]:
        """Get vehicle by VIN"""
        try:
            response = self.client.table('vehicles').select("*").eq('vin', vin).single().execute()
            return response.data
        except Exception as e:
            logger.error(f"Error fetching vehicle {vin}: {e}")
            return None
    
    def insert_telemetry(self, vehicle_id: str, telemetry_data: Dict) -> bool:
        """Insert telemetry data"""
        try:
            data = {
                "vehicle_id": vehicle_id,
                "timestamp": telemetry_data.get("timestamp"),
                "vehicle_speed": telemetry_data.get("speed"),
                "battery_level": int(telemetry_data.get("battery", 0)),  # Convert to int
                "power_kw": telemetry_data.get("power"),
                "odometer": telemetry_data.get("odometer"),
                "heading": int(telemetry_data.get("heading", 0)),  # Convert to int
                "is_compressed": telemetry_data.get("is_compressed", False)
            }
            
            self.client.table('telemetry_data').insert(data).execute()
            logger.debug(f"Inserted telemetry for vehicle {vehicle_id}")
            return True
        except Exception as e:
            logger.error(f"Error inserting telemetry: {e}")
            return False
    
    def get_recent_telemetry(self, vehicle_id: str, limit: int = 100) -> List[Dict]:
        """Get recent telemetry for a vehicle"""
        try:
            response = self.client.table('telemetry_data') \
                .select("*") \
                .eq('vehicle_id', vehicle_id) \
                .order('timestamp', desc=True) \
                .limit(limit) \
                .execute()
            return response.data
        except Exception as e:
            logger.error(f"Error fetching telemetry: {e}")
            return []
    
    def get_telemetry_by_time_range(
        self, 
        vehicle_id: str, 
        start_timestamp: int, 
        end_timestamp: int
    ) -> List[Dict]:
        """Get telemetry within a time range"""
        try:
            response = self.client.table('telemetry_data') \
                .select("*") \
                .eq('vehicle_id', vehicle_id) \
                .gte('timestamp', start_timestamp) \
                .lte('timestamp', end_timestamp) \
                .order('timestamp', desc=False) \
                .execute()
            return response.data
        except Exception as e:
            logger.error(f"Error fetching telemetry by time range: {e}")
            return []
    
    def update_compression_stats(
        self, 
        vehicle_id: str, 
        total_packets: int,
        transmitted_fields: int,
        skipped_fields: int,
        bandwidth_saved_percent: float
    ) -> bool:
        """Update daily compression statistics"""
        try:
            data = {
                "vehicle_id": vehicle_id,
                "total_packets": total_packets,
                "transmitted_fields": transmitted_fields,
                "skipped_fields": skipped_fields,
                "bandwidth_saved_percent": bandwidth_saved_percent
            }
            
            # Upsert: update if exists for today, insert if not
            self.client.table('compression_stats') \
                .upsert(data, on_conflict='vehicle_id,date') \
                .execute()
            
            logger.debug(f"Updated compression stats for vehicle {vehicle_id}")
            return True
        except Exception as e:
            logger.error(f"Error updating compression stats: {e}")
            return False
    
    def create_offline_session(self, vehicle_id: str, started_at: str) -> Optional[int]:
        """Create a new offline session record"""
        try:
            response = self.client.table('offline_sessions').insert({
                "vehicle_id": vehicle_id,
                "started_at": started_at,
                "status": "active"
            }).execute()
            
            session_id = response.data[0]['id']
            logger.info(f"Created offline session {session_id} for vehicle {vehicle_id}")
            return session_id
        except Exception as e:
            logger.error(f"Error creating offline session: {e}")
            return None
    
    def complete_offline_session(
        self, 
        session_id: int, 
        ended_at: str,
        records_buffered: int,
        records_uploaded: int
    ) -> bool:
        """Mark offline session as complete"""
        try:
            self.client.table('offline_sessions') \
                .update({
                    "ended_at": ended_at,
                    "records_buffered": records_buffered,
                    "records_uploaded": records_uploaded,
                    "status": "synced"
                }) \
                .eq('id', session_id) \
                .execute()
            
            logger.info(f"Completed offline session {session_id}")
            return True
        except Exception as e:
            logger.error(f"Error completing offline session: {e}")
            return False
    
    def get_analytics_summary(self, vehicle_id: str, days: int = 7) -> Dict:
        """Get analytics summary for a vehicle"""
        try:
            # This would use a custom SQL query or Supabase RPC function
            # For now, return basic stats
            telemetry = self.get_recent_telemetry(vehicle_id, limit=1000)
            
            if not telemetry:
                return {}
            
            speeds = [t['vehicle_speed'] for t in telemetry if t.get('vehicle_speed')]
            batteries = [t['battery_level'] for t in telemetry if t.get('battery_level')]
            
            return {
                "total_records": len(telemetry),
                "avg_speed": sum(speeds) / len(speeds) if speeds else 0,
                "avg_battery": sum(batteries) / len(batteries) if batteries else 0,
                "max_speed": max(speeds) if speeds else 0,
                "min_battery": min(batteries) if batteries else 0
            }
        except Exception as e:
            logger.error(f"Error getting analytics: {e}")
            return {}


# Global instance
_supabase_client: Optional[SupabaseClient] = None


def get_supabase_client() -> SupabaseClient:
    """Get or create Supabase client singleton"""
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = SupabaseClient()
    return _supabase_client
