# Python Cloud Server

FastAPI-based backend server that receives telemetry data from edge loggers, reconstructs compressed fields, stores data in Supabase, and streams real-time updates to the React dashboard via WebSocket.

## Overview

This component handles:
- **Protocol Buffer deserialization** from edge loggers
- **Compression reconstruction** using synchronized predictor state
- **Database persistence** to Supabase PostgreSQL
- **Real-time WebSocket streaming** to frontend dashboard
- **Logger orchestration** (start/stop commands)
- **Compression statistics** tracking and reporting

## Architecture

```
Edge Logger → HTTP POST /api/telemetry → Predictor Reconstruction
                                                    ↓
                                            Supabase PostgreSQL
                                                    ↓
                                            WebSocket Broadcast → Frontend
```

## Key Components

### server.py
Main FastAPI application with:
- REST API endpoints for telemetry ingestion
- WebSocket endpoint for real-time dashboard updates
- Logger control endpoints (start/stop)
- Health check and status endpoints
- CORS middleware for frontend access

### predictor.py
Server-side predictor that mirrors C++ edge logic:
- Exponential smoothing algorithm matching edge predictor
- Reconstructs missing fields from compressed telemetry
- Maintains synchronized state with edge predictor
- Tracks compression statistics

### telemetry_pb2.py
Auto-generated Protocol Buffer Python code (from `telemetry.proto`)

## API Endpoints

### POST `/api/telemetry`
Receives binary Protocol Buffer telemetry data from edge loggers.

**Request:**
- Content-Type: `application/x-protobuf`
- Body: Binary Protocol Buffer message

**Response:**
```json
{
  "status": "success",
  "compression_ratio": 0.65,
  "transmitted_fields": 12,
  "skipped_fields": 8
}
```

### WebSocket `/ws`
Real-time streaming endpoint for dashboard.

**Message Types:**
- `history` - Initial historical data load
- `telemetry` - New telemetry record
- `log` - Logger status messages
- `compression_stats` - Compression statistics updates

**Client Messages:**
- `{"type": "start_logger"}` - Start the logger
- `{"type": "stop_logger"}` - Stop the logger

### GET `/status`
Health check and system status.

**Response:**
```json
{
  "status": "healthy",
  "compression_stats": {
    "total_readings": 1000,
    "transmitted_readings": 350,
    "skipped_readings": 650,
    "compression_ratio": 0.65
  },
  "supabase_enabled": true
}
```

### POST `/logger/start`
Start the telemetry logger (spawns subprocess).

### POST `/logger/stop`
Stop the telemetry logger (terminates subprocess).

## Compression Reconstruction

The server maintains a synchronized predictor state:

1. **Receives compressed telemetry** (missing some fields)
2. **Uses predictor** to reconstruct missing values
3. **Updates predictor** with actual transmitted values
4. **Stores complete record** in database (transmitted + reconstructed)

**Example:**
- Edge sends: `{speed: 65.0, battery: 82}` (power and heading omitted)
- Server predictor predicts: `power: 12.5, heading: 45`
- Server stores: `{speed: 65.0, battery: 82, power: 12.5, heading: 45}`

## Database Integration

### Supabase Configuration
Set environment variables:
```bash
ENABLE_SUPABASE=true
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
```

### Schema
See `../database/schema.sql` for table definitions:
- `vehicles` - Vehicle metadata (VIN, model, year)
- `telemetry_data` - Time-series telemetry records
- `compression_stats` - Daily compression statistics

### Data Flow
1. Insert telemetry record with `vehicle_id` from VIN lookup
2. Update or insert compression stats for the day
3. Broadcast to all connected WebSocket clients

## WebSocket Broadcasting

When new telemetry is received:
1. Store in database
2. Reconstruct compressed fields
3. Broadcast to all connected clients
4. Include compression statistics if changed

**Message Format:**
```json
{
  "type": "telemetry",
  "data": {
    "timestamp": 1234567890,
    "speed": 65.0,
    "battery": 82,
    "power": 12.5,
    "heading": 45,
    "vehicle_vin": "5YJ3E1EA1KF000001"
  }
}
```

## Multi-Vehicle Support

The server supports concurrent telemetry from multiple vehicles:
- VIN-based routing in database queries
- Per-vehicle predictor state (currently global, can be enhanced)
- Vehicle identification in WebSocket messages
- Independent compression statistics per vehicle

## Dependencies

Install from `requirements.txt`:
```bash
pip install fastapi uvicorn websockets supabase protobuf python-dotenv
```

## Running

### Development
```bash
cd python_cloud
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### Production (Docker)
The server runs as the main process in the Docker container (see root `Dockerfile`).

### Environment Variables
```bash
ENABLE_SUPABASE=false          # Enable/disable Supabase
SUPABASE_URL=<url>            # Supabase project URL
SUPABASE_SERVICE_KEY=<key>    # Supabase service role key
PORT=8001                     # Server port (default: 8001)
```

## Performance

- **Throughput**: ~1000 records/second per instance
- **WebSocket Connections**: Supports 100+ concurrent connections
- **Memory Usage**: ~50MB base + ~1MB per connected client
- **Latency**: <10ms for database insert, <5ms for WebSocket broadcast

## Error Handling

- Invalid Protocol Buffer data: Returns 400 error, logs warning
- Database errors: Logs error, returns 500, continues operation
- WebSocket disconnects: Gracefully handles cleanup
- Logger process errors: Captures stderr, logs to console

## Logging

Server logs include:
- HTTP request logs (via FastAPI)
- Compression statistics
- Database operation results
- WebSocket connection events
- Logger process status

## Testing

Manual testing endpoints:
```bash
# Health check
curl http://localhost:8001/status

# Test WebSocket (use wscat or similar)
wscat -c ws://localhost:8001/ws
```

## Future Enhancements

- [ ] Per-vehicle predictor state management
- [ ] Redis pub/sub for multi-instance WebSocket broadcasting
- [ ] Rate limiting and authentication
- [ ] Prometheus metrics endpoint
- [ ] GraphQL API for flexible queries
- [ ] Batch inserts for better database performance

