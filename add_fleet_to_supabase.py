#!/usr/bin/env python3
"""
Add fleet vehicles to Supabase database
"""

import sys
import os
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from database.supabase_client import get_supabase_client

def add_fleet_vehicles():
    """Add 4 additional vehicles to the fleet"""
    
    vehicles = [
        {
            "vin": "5YJ3E1EA2KF000002",
            "model": "Model Y Performance",
            "year": 2024,
            "owner_email": "fleet@example.com"
        },
        {
            "vin": "5YJSA1E26MF000003",
            "model": "Model S Plaid",
            "year": 2024,
            "owner_email": "fleet@example.com"
        },
        {
            "vin": "7SAYGDEE3MF000004",
            "model": "Model X Long Range",
            "year": 2023,
            "owner_email": "fleet@example.com"
        },
        {
            "vin": "5YJ3E1EB9MF000005",
            "model": "Model 3 Standard Range",
            "year": 2024,
            "owner_email": "fleet@example.com"
        }
    ]
    
    print("=" * 60)
    print("  Adding Fleet Vehicles to Supabase")
    print("=" * 60)
    print()
    
    client = get_supabase_client()
    added = 0
    existing = 0
    
    for vehicle in vehicles:
        try:
            # Check if vehicle already exists
            result = client.get_vehicle_by_vin(vehicle["vin"])
            if result:
                print(f"✓ Vehicle {vehicle['vin'][-6:]} already exists: {vehicle['model']}")
                existing += 1
                continue
            
            # Insert new vehicle
            response = client.client.table('vehicles').insert(vehicle).execute()
            if response.data:
                print(f"✓ Added vehicle {vehicle['vin'][-6:]}: {vehicle['model']}")
                added += 1
            else:
                print(f"✗ Failed to add {vehicle['vin'][-6:]}")
        
        except Exception as e:
            print(f"✗ Error adding {vehicle['vin'][-6:]}: {e}")
    
    print()
    print(f"Summary: {added} added, {existing} already existed")
    print()
    
    # Show all vehicles
    try:
        all_vehicles = client.client.table('vehicles').select('*').order('vin').execute()
        if all_vehicles.data:
            print("Current Fleet:")
            print("-" * 60)
            for v in all_vehicles.data:
                print(f"  {v['vin'][-6:]} - {v['model']} ({v['year']})")
            print()
    except Exception as e:
        print(f"Error fetching vehicles: {e}")
    
    return added > 0 or existing > 0

if __name__ == "__main__":
    try:
        success = add_fleet_vehicles()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\nError: {e}")
        print("\nMake sure:")
        print("  1. .env file exists with SUPABASE_URL and SUPABASE_SERVICE_KEY")
        print("  2. Supabase connection is working")
        sys.exit(1)
