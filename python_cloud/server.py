from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import List
import telemetry_pb2  # Generated protobuf file
import json
from datetime import datetime
import uvicorn

app = FastAPI()

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


manager = ConnectionManager()


@app.post("/telemetry")
async def receive_telemetry(request: Request):
    """Receive protobuf binary data from C++ edge device"""
    try:
        # Read binary protobuf data
        data = await request.body()
        
        # Parse protobuf
        vehicle_data = telemetry_pb2.VehicleData()
        vehicle_data.ParseFromString(data)
        
        # Convert to dict for JSON broadcasting
        telemetry_dict = {
            "timestamp": vehicle_data.timestamp,
            "speed": vehicle_data.vehicle_speed,
            "battery": vehicle_data.battery_level,
            "power": vehicle_data.power_kw,
            "gear": vehicle_data.gear,
            "received_at": datetime.now().isoformat()
        }
        
        # Store in memory (keep last MAX_BUFFER_SIZE records)
        telemetry_buffer.append(telemetry_dict)
        if len(telemetry_buffer) > MAX_BUFFER_SIZE:
            telemetry_buffer.pop(0)
        
        # Broadcast to all connected WebSocket clients
        await manager.broadcast({
            "type": "telemetry",
            "data": telemetry_dict
        })
        
        print(f"[RECV] Time={vehicle_data.timestamp}, Speed={vehicle_data.vehicle_speed} mph, "
              f"Battery={vehicle_data.battery_level}%, Power={vehicle_data.power_kw} kW, Gear={vehicle_data.gear}")
        
        return {"status": "ok", "records_buffered": len(telemetry_buffer)}
        
    except Exception as e:
        print(f"[ERROR] Failed to process telemetry: {e}")
        return {"status": "error", "message": str(e)}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates to React dashboard"""
    await manager.connect(websocket)
    
    try:
        # Send historical data on connect
        await websocket.send_json({
            "type": "history",
            "data": telemetry_buffer[-100:] if len(telemetry_buffer) > 100 else telemetry_buffer
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
        "active_connections": len(manager.active_connections)
    }


@app.get("/status")
async def status():
    """Get server status and latest telemetry"""
    return {
        "total_records": len(telemetry_buffer),
        "active_websockets": len(manager.active_connections),
        "latest": telemetry_buffer[-10:] if telemetry_buffer else []
    }


if __name__ == "__main__":
    print("\n=== Tesla Telemetry Server ===")
    print("HTTP endpoint: http://localhost:8000/telemetry")
    print("WebSocket: ws://localhost:8000/ws")
    print("Status: http://localhost:8000/status\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
