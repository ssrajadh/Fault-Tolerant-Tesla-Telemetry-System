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
from predictor import TelemetryPredictor

app = FastAPI()

# Global script process
script_process = None

# Global predictor for reconstruction
g_predictor = TelemetryPredictor()
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


@app.post("/telemetry")
async def receive_telemetry(request: Request):
    """Receive protobuf binary data from C++ edge device (compressed or uncompressed)"""
    try:
        # Check if this is compressed data
        is_compressed = request.headers.get("X-Compressed", "false") == "true"
        
        # Read binary protobuf data
        data = await request.body()
        
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
            
            log_msg = f"[COMPRESSED] Received: {', '.join(fields_sent) if fields_sent else 'No updates'}"
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
                f"[UPLOAD] ✓ Received: Speed={vehicle_data.vehicle_speed} mph, Battery={vehicle_data.battery_level}%, Power={vehicle_data.power_kw} kW",
                "success"
            )
        
        # Store in memory (keep last MAX_BUFFER_SIZE records)
        telemetry_buffer.append(telemetry_dict)
        if len(telemetry_buffer) > MAX_BUFFER_SIZE:
            telemetry_buffer.pop(0)
        
        # Broadcast to all connected WebSocket clients
        await manager.broadcast({
            "type": "telemetry",
            "data": telemetry_dict,
            "compression_stats": g_predictor.get_compression_stats()
        })
        
        return {"status": "ok", "records_buffered": len(telemetry_buffer)}
        
    except Exception as e:
        print(f"[ERROR] Failed to process telemetry: {e}")
        await manager.broadcast_log(f"[ERROR] Failed to process telemetry: {e}", "error")
        return {"status": "error", "message": str(e)}


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
        env['SERVER_PORT'] = str(int(os.environ.get("PORT", 8000)))
        
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
    port = int(os.environ.get("PORT", 8000))
    print("\n=== Tesla Telemetry Server ===")
    print(f"HTTP endpoint: http://0.0.0.0:{port}/telemetry")
    print(f"WebSocket: ws://0.0.0.0:{port}/ws")
    print(f"Status: http://0.0.0.0:{port}/status")
    print(f"Dashboard: http://0.0.0.0:{port}/\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
