from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import List
import telemetry_pb2  # Generated protobuf file
import json
from datetime import datetime
import uvicorn
import subprocess
import asyncio
import os
import sys
import threading
from predictor import TelemetryPredictor

# Kafka consumer (optional)
try:
    from confluent_kafka import Consumer, KafkaError, KafkaException
    KAFKA_AVAILABLE = True
except ImportError:
    KAFKA_AVAILABLE = False
    print("[KAFKA] confluent-kafka not installed, Kafka consumer disabled")

# Add parent directory to path for database imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from database.supabase_client import get_supabase_client

app = FastAPI()

# Global script process
script_process = None

# Global predictor for reconstruction
g_predictor = TelemetryPredictor()

# Supabase configuration
USE_SUPABASE = os.getenv("ENABLE_SUPABASE", "false") == "true"
VEHICLE_ID = None
supabase = None

if USE_SUPABASE:
    supabase = get_supabase_client()
    # Get sample vehicle ID (VIN: 5YJ3E1EA1KF000001)
    sample_vehicle = supabase.get_vehicle_by_vin("5YJ3E1EA1KF000001")
    if sample_vehicle:
        VEHICLE_ID = sample_vehicle['id']
        print(f"[SUPABASE] Using vehicle: {sample_vehicle['model']} (ID: {VEHICLE_ID})")
    else:
        print("[SUPABASE] Warning: Sample vehicle not found. Run database/schema.sql first.")
        USE_SUPABASE = False  # Disable if vehicle not found

script_task = None

# Enable CORS for React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage (simple list for demo)
telemetry_buffer: List[dict] = []
MAX_BUFFER_SIZE = 1000

# Kafka configuration
KAFKA_ENABLED = os.getenv("KAFKA_BOOTSTRAP_SERVERS") is not None and KAFKA_AVAILABLE
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "telemetry-raw")
KAFKA_CONSUMER_GROUP = os.getenv("KAFKA_CONSUMER_GROUP", "telemetry-processors")
kafka_consumer_thread = None
kafka_consumer_running = False


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"[WS] Client connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        print(f"[WS] Client disconnected. Total connections: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients"""
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"[WS ERROR] Failed to send: {e}")
                dead_connections.append(connection)
        
        # Clean up dead connections
        for conn in dead_connections:
            self.active_connections.remove(conn)
    
    async def broadcast_log(self, message: str, log_type: str = "info"):
        """Broadcast log message to all connected clients"""
        await self.broadcast({
            "type": "log",
            "message": message,
            "log_type": log_type
        })


async def stream_script_output():
    """Stream script output to WebSocket clients"""
    global script_process
    
    if script_process and script_process.stdout:
        try:
            while True:
                line = await script_process.stdout.readline()
                if not line:
                    break
                decoded_line = line.decode('utf-8').strip()
                if decoded_line:
                    await manager.broadcast_log(decoded_line, "info")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            await manager.broadcast_log(f"Error reading script output: {e}", "error")


manager = ConnectionManager()


async def process_telemetry_data(data: bytes, vehicle_vin: str, is_compressed: bool = True):
    """Process telemetry data (from Kafka or HTTP) and store/broadcast it"""
    try:
        if is_compressed:
            # Parse compressed protobuf
            compressed_data = telemetry_pb2.CompressedVehicleData()
            compressed_data.ParseFromString(data)
            
            # Track compression statistics
            g_predictor.total_readings += 4  # 4 fields: speed, power, battery, heading
            fields_transmitted = 0
            if compressed_data.HasField('vehicle_speed'):
                fields_transmitted += 1
            if compressed_data.HasField('power_kw'):
                fields_transmitted += 1
            if compressed_data.HasField('battery_level'):
                fields_transmitted += 1
            if compressed_data.HasField('heading'):
                fields_transmitted += 1
            
            g_predictor.transmitted_readings += fields_transmitted
            g_predictor.skipped_readings += (4 - fields_transmitted)
            
            # Reconstruct full telemetry using predictor
            predicted = g_predictor.get_predicted_values()
            
            # Use received values if present, otherwise use predicted
            speed = compressed_data.vehicle_speed if compressed_data.HasField('vehicle_speed') else predicted.get('speed', 0)
            battery = compressed_data.battery_level if compressed_data.HasField('battery_level') else predicted.get('battery', 0)
            power = compressed_data.power_kw if compressed_data.HasField('power_kw') else predicted.get('power', 0)
            heading = compressed_data.heading if compressed_data.HasField('heading') else int(predicted.get('heading', 0))
            
            # Update predictor with actual received values
            g_predictor.update_with_actual(
                speed=compressed_data.vehicle_speed if compressed_data.HasField('vehicle_speed') else None,
                battery=compressed_data.battery_level if compressed_data.HasField('battery_level') else None,
                power=compressed_data.power_kw if compressed_data.HasField('power_kw') else None,
                heading=float(compressed_data.heading) if compressed_data.HasField('heading') else None
            )
            
            # Build telemetry dict with reconstructed data
            telemetry_dict = {
                "timestamp": compressed_data.timestamp,
                "speed": speed,
                "battery": battery,
                "power": power,
                "odometer": compressed_data.odometer,
                "heading": heading,
                "received_at": datetime.now().isoformat()
            }
            
            # Log which fields were transmitted vs predicted
            fields_sent = []
            if compressed_data.HasField('vehicle_speed'): fields_sent.append('Speed')
            if compressed_data.HasField('battery_level'): fields_sent.append('Battery')
            if compressed_data.HasField('power_kw'): fields_sent.append('Power')
            if compressed_data.HasField('heading'): fields_sent.append('Heading')
            
            log_msg = f"[KAFKA] Received: {', '.join(fields_sent) if fields_sent else 'No updates'}"
            if compressed_data.is_resync:
                log_msg += " [RESYNC]"
            
            await manager.broadcast_log(log_msg, "info")
            
        else:
            # Parse uncompressed protobuf (legacy support)
            vehicle_data = telemetry_pb2.VehicleData()
            vehicle_data.ParseFromString(data)
            
            # Convert to dict for JSON broadcasting
            telemetry_dict = {
                "timestamp": vehicle_data.timestamp,
                "speed": vehicle_data.vehicle_speed,
                "battery": vehicle_data.battery_level,
                "power": vehicle_data.power_kw,
                "odometer": vehicle_data.odometer,
                "heading": vehicle_data.heading,
                "received_at": datetime.now().isoformat()
            }
            
            await manager.broadcast_log(
                f"[KAFKA] ✓ Received: Speed={vehicle_data.vehicle_speed} mph, Battery={vehicle_data.battery_level}%, Power={vehicle_data.power_kw} kW",
                "success"
            )
        
        # Lookup vehicle ID for this VIN
        vehicle_id = VEHICLE_ID  # Use default cached ID
        if USE_SUPABASE and vehicle_vin != "5YJ3E1EA1KF000001":
            # Lookup vehicle by VIN if not the default
            vehicle_info = supabase.get_vehicle_by_vin(vehicle_vin)
            if vehicle_info:
                vehicle_id = vehicle_info['id']
            else:
                print(f"[WARNING] Unknown vehicle VIN: {vehicle_vin}")
                vehicle_id = None
        
        # Store in memory (keep last MAX_BUFFER_SIZE records)
        telemetry_buffer.append(telemetry_dict)
        if len(telemetry_buffer) > MAX_BUFFER_SIZE:
            telemetry_buffer.pop(0)
        
        # Store in Supabase if enabled
        if USE_SUPABASE and vehicle_id:
            supabase.insert_telemetry(vehicle_id, telemetry_dict)
        
        # Broadcast to all connected WebSocket clients
        await manager.broadcast({
            "type": "telemetry",
            "data": telemetry_dict,
            "vehicle_vin": vehicle_vin[-6:],  # Last 6 chars for privacy
            "compression_stats": g_predictor.get_compression_stats()
        })
        
        return True
    except Exception as e:
        print(f"[ERROR] Failed to process telemetry: {e}")
        await manager.broadcast_log(f"[ERROR] Failed to process telemetry: {e}", "error")
        return False


@app.post("/telemetry")
async def receive_telemetry(request: Request):
    """Receive protobuf binary data from C++ edge device via HTTP (fallback when Kafka not available)"""
    try:
        # Check if this is compressed data
        is_compressed = request.headers.get("X-Compressed", "false") == "true"
        
        # Get vehicle VIN from header (for multi-vehicle support)
        vehicle_vin = request.headers.get("X-Vehicle-VIN", "5YJ3E1EA1KF000001")
        
        # Read binary protobuf data
        data = await request.body()
        
        # Process using shared function
        success = await process_telemetry_data(data, vehicle_vin, is_compressed)
        
        if success:
        return {"status": "ok", "records_buffered": len(telemetry_buffer)}
        else:
            return {"status": "error", "message": "Failed to process telemetry"}
        
    except Exception as e:
        print(f"[ERROR] Failed to process telemetry: {e}")
        await manager.broadcast_log(f"[ERROR] Failed to process telemetry: {e}", "error")
        return {"status": "error", "message": str(e)}


def kafka_consumer_loop():
    """Kafka consumer running in background thread"""
    global kafka_consumer_running
    
    if not KAFKA_ENABLED:
        print("[KAFKA] Consumer disabled (KAFKA_BOOTSTRAP_SERVERS not set or library not available)")
        return
    
    print(f"[KAFKA] Starting consumer: brokers={KAFKA_BOOTSTRAP_SERVERS}, topic={KAFKA_TOPIC}, group={KAFKA_CONSUMER_GROUP}")
    
    # Create a new event loop for this thread
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    # Create consumer configuration
    conf = {
        'bootstrap.servers': KAFKA_BOOTSTRAP_SERVERS,
        'group.id': KAFKA_CONSUMER_GROUP,
        'auto.offset.reset': 'earliest',  # Start from beginning if no offset
        'enable.auto.commit': True,
        'auto.commit.interval.ms': 1000,
    }
    
    consumer = None
    try:
        consumer = Consumer(conf)
        consumer.subscribe([KAFKA_TOPIC])
        
        kafka_consumer_running = True
        print(f"[KAFKA] Consumer subscribed to topic: {KAFKA_TOPIC}")
        
        message_count = 0
        while kafka_consumer_running:
            try:
                # Poll for messages (timeout 1 second)
                msg = consumer.poll(timeout=1.0)
                
                if msg is None:
                    continue
                
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        # End of partition event - not an error
                        continue
                    else:
                        print(f"[KAFKA ERROR] {msg.error()}")
                        continue
                
                # Extract VIN from message key (used for partitioning)
                vehicle_vin = msg.key().decode('utf-8') if msg.key() else "5YJ3E1EA1KF000001"
                
                # Get message value (protobuf binary data)
                data = msg.value()
                
                # Process message asynchronously in the thread's event loop
                loop.run_until_complete(process_telemetry_data(data, vehicle_vin, is_compressed=True))
                
                message_count += 1
                if message_count % 100 == 0:
                    print(f"[KAFKA] Processed {message_count} messages")
                    
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"[KAFKA ERROR] Error processing message: {e}")
                continue
                
    except Exception as e:
        print(f"[KAFKA ERROR] Consumer error: {e}")
    finally:
        if consumer:
            consumer.close()
        loop.close()
        kafka_consumer_running = False
        print("[KAFKA] Consumer stopped")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates to React dashboard"""
    await manager.connect(websocket)
    
    try:
        # Send initial log messages
        await websocket.send_json({
            "type": "log",
            "message": "Connected to telemetry server",
            "log_type": "success"
        })
        
        # Send historical data on connect
        await websocket.send_json({
            "type": "history",
            "data": telemetry_buffer[-100:] if len(telemetry_buffer) > 100 else telemetry_buffer
        })
        
        await websocket.send_json({
            "type": "log",
            "message": f"Loaded {min(len(telemetry_buffer), 100)} historical telemetry records",
            "log_type": "info"
        })
        
        # Keep connection alive
        while True:
            # Wait for any messages from client (like ping/pong)
            try:
                await websocket.receive_text()
            except WebSocketDisconnect:
                break
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"[WS ERROR] {e}")
        manager.disconnect(websocket)


@app.get("/")
async def root():
    return {
        "message": "Tesla Telemetry Server",
        "records_buffered": len(telemetry_buffer),
        "active_connections": len(manager.active_connections),
        "compression_enabled": True
    }


@app.get("/status")
async def status():
    """Get server status and latest telemetry"""
    return {
        "total_records": len(telemetry_buffer),
        "active_websockets": len(manager.active_connections),
        "latest": telemetry_buffer[-10:] if telemetry_buffer else [],
        "script_running": script_process is not None and script_process.returncode is None,
        "compression_stats": g_predictor.get_compression_stats()
    }


@app.post("/start_script")
async def start_script():
    """Start the C++ logger script"""
    global script_process, script_task
    
    if script_process and script_process.returncode is None:
        return {"status": "error", "message": "Script already running"}
    
    try:
        # Reset predictor when starting new script
        g_predictor.reset()
        
        # Path to the logger executable
        logger_path = os.path.join(os.path.dirname(__file__), "..", "cpp_edge", "logger")
        
        if not os.path.exists(logger_path):
            await manager.broadcast_log("Logger executable not found. Compile it first with: g++ -o logger logger.cpp telemetry.pb.cc -lprotobuf -lcurl", "error")
            return {"status": "error", "message": "Logger not found"}
        
        # Start the process with unbuffered output
        # Set SERVER_PORT env var so logger knows which port to use
        env = os.environ.copy()
        env['SERVER_PORT'] = str(int(os.environ.get("PORT", 8001)))
        
        script_process = await asyncio.create_subprocess_exec(
            "stdbuf", "-oL", "-eL", logger_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            stdin=asyncio.subprocess.PIPE,
            cwd=os.path.dirname(logger_path),
            env=env,
            bufsize=0
        )
        
        # Start streaming output
        script_task = asyncio.create_task(stream_script_output())
        
        await manager.broadcast_log("=== Logger Started ===", "success")
        return {"status": "success", "message": "Script started"}
        
    except Exception as e:
        await manager.broadcast_log(f"Failed to start script: {e}", "error")
        return {"status": "error", "message": str(e)}


@app.post("/stop_script")
async def stop_script():
    """Stop the C++ logger script"""
    global script_process, script_task
    
    if not script_process or script_process.returncode is not None:
        return {"status": "error", "message": "Script not running"}
    
    try:
        script_process.terminate()
        await asyncio.sleep(0.5)
        
        if script_process.returncode is None:
            script_process.kill()
        
        if script_task:
            script_task.cancel()
            script_task = None
        
        script_process = None
        await manager.broadcast_log("=== Logger Stopped ===", "warning")
        return {"status": "success", "message": "Script stopped"}
        
    except Exception as e:
        await manager.broadcast_log(f"Failed to stop script: {e}", "error")
        return {"status": "error", "message": str(e)}


@app.post("/toggle_offline")
async def toggle_offline():
    """Send Enter key to C++ logger to toggle offline/online mode"""
    global script_process
    
    if not script_process or script_process.returncode is not None:
        return {"status": "error", "message": "Script not running"}
    
    try:
        if script_process.stdin:
            script_process.stdin.write(b"\n")
            await script_process.stdin.drain()
            return {"status": "success", "message": "Toggled offline mode"}
        else:
            return {"status": "error", "message": "Stdin not available"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/clear_data")
async def clear_data():
    """Clear all telemetry data"""
    global telemetry_buffer, g_predictor
    
    try:
        telemetry_buffer.clear()
        # Reset predictor statistics
        g_predictor.total_readings = 0
        g_predictor.transmitted_readings = 0
        g_predictor.skipped_readings = 0
        await manager.broadcast_log("=== Data Cleared ===", "info")
        return {"status": "success", "message": "Data cleared", "records_cleared": 0}
    except Exception as e:
        await manager.broadcast_log(f"Failed to clear data: {e}", "error")
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    print("\n=== Tesla Telemetry Server ===")
    print(f"HTTP endpoint: http://0.0.0.0:{port}/telemetry")
    print(f"WebSocket: ws://0.0.0.0:{port}/ws")
    print(f"Status: http://0.0.0.0:{port}/status")
    print(f"Dashboard: http://0.0.0.0:{port}/")
    
    # Start Kafka consumer in background thread if enabled
    if KAFKA_ENABLED:
        print(f"\n[KAFKA] Starting Kafka consumer...")
        kafka_consumer_thread = threading.Thread(target=kafka_consumer_loop, daemon=True)
        kafka_consumer_thread.start()
        print(f"[KAFKA] Consumer thread started")
    else:
        print(f"\n[KAFKA] Kafka consumer disabled (using HTTP endpoint)")
    
    print()
    uvicorn.run(app, host="0.0.0.0", port=port)
