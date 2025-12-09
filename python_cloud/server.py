from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import telemetry_pb2 # Generated file

app = FastAPI()
# Enable CORS for React
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"])

@app.post("/upload")
async def upload(request: Request):
    data = await request.body()
    batch = telemetry_pb2.TelemetryBatch()
    batch.ParseFromString(data) # Decode binary
    
    print(f"Received {len(batch.records)} records")
    # In real life, save to DB. For now, just print or push to WebSocket.
    return {"status": "ok"}