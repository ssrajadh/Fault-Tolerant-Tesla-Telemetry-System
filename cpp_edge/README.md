# C++ Edge Logger

The C++ edge engine is the core telemetry ingestion and buffering system that runs on embedded devices (simulated on Linux). It implements a fault-tolerant store-and-forward architecture with predictive compression to ensure zero data loss during network outages.

## Overview

This component is responsible for:
- **High-frequency data ingestion** (50Hz) from vehicle sensors via CSV replay
- **Predictive compression** using exponential smoothing to reduce bandwidth by 60-90%
- **Offline buffering** in SQLite when network connectivity is lost
- **Smart synchronization** that prioritizes oldest buffered records first
- **Protocol Buffer serialization** for efficient binary data transmission
- **Multi-vehicle support** with VIN-based routing and per-vehicle state

## Architecture

```
CSV Replay → TelemetryLogger → Compression Engine → Network Check
                                                  ↓          ↓
                                              Online    Offline
                                                  ↓          ↓
                                            Protobuf    SQLite Buffer
                                                  ↓          ↓
                                            Upload    Sync Worker
```

## Key Components

### TelemetryLogger
Main class that orchestrates:
- Data ingestion from CSV files
- Network status monitoring
- Buffer management
- Background sync worker thread

### TelemetryPredictor
Predictive compression engine using exponential smoothing:
- Predicts next values based on historical trends
- Compares actual vs predicted values
- Only transmits fields when difference exceeds threshold
- Forces full transmission every 30 seconds (resync)

### Compression Thresholds
- **Speed**: ±2 mph
- **Power**: ±5 kW  
- **Battery**: ±0.5%
- **Heading**: ±5°

### Store-and-Forward Logic
- Detects network status via HTTP health checks
- When offline: Serializes telemetry to Protocol Buffers and writes to SQLite
- When online: Uploads real-time data + syncs buffered records
- Sync worker ensures 100ms spacing between buffered uploads

## Building

### Dependencies
- C++17 compiler (g++ or clang++)
- libcurl (for HTTP requests)
- nlohmann/json (header-only JSON library)
- SQLite3
- Protocol Buffers compiler and libraries

### Compilation

1. Generate Protocol Buffer headers:
```bash
protoc --cpp_out=. ../telemetry.proto
```

2. Compile the logger:
```bash
g++ -std=c++17 -O2 logger.cpp telemetry.pb.cc \
    -lprotobuf -lcurl -lsqlite3 -pthread \
    -o logger
```

### Docker Build
The logger is compiled as part of the multi-stage Docker build in the root directory.

## Usage

### Single Vehicle
```bash
./logger <VIN> <CSV_FILE> <BACKEND_URL>
```

Example:
```bash
./logger 5YJ3E1EA1KF000001 ../data/vehicle_logs/tesla_log_5YJ3E1EA1KF000001.jsonl http://localhost:8001
```

### Multi-Vehicle Fleet
Use the fleet orchestration script in the root directory:
```bash
../run_fleet.sh
```

## Database Files

The logger creates per-vehicle SQLite databases:
- `telemetry_buffer_<VIN>.db` - Buffered telemetry data during offline periods
- Uses WAL (Write-Ahead Logging) mode for concurrent access
- Schema: `(id, timestamp, proto_data)` where `proto_data` is binary Protocol Buffer serialization

## Network Detection

Network status is determined by:
1. HTTP GET request to `/health` endpoint
2. Success (200 OK) = Online
3. Failure/timeout = Offline
4. Check interval: Every 5 seconds

## Compression Algorithm

The predictor uses exponential smoothing:

```
predicted_value = α × actual_current + (1 - α) × predicted_previous
```

Where `α = 0.3` (smoothing factor).

**Decision Logic:**
1. Calculate predicted value for each field
2. Compare `|actual - predicted|` to threshold
3. If difference > threshold → transmit field
4. If difference ≤ threshold → skip field (use predicted value on server)
5. Every 30 seconds: force full transmission regardless of thresholds

## Performance

- **Ingestion Rate**: 50Hz (20ms per record)
- **Compression Ratio**: 60-90% reduction on highways, 20-40% in city driving
- **Buffer Latency**: <100ms overhead for SQLite writes
- **Memory Usage**: ~10MB for logger + ~1MB per 1000 buffered records

## File Structure

- `logger.cpp` - Main implementation (580+ lines)
- `telemetry.pb.h` / `telemetry.pb.cc` - Generated Protocol Buffer code
- `telemetry_buffer_*.db` - SQLite buffer databases (auto-generated)
- `logger` - Compiled binary (after build)

## Integration

The logger communicates with:
- **Python Cloud Server** (`python_cloud/server.py`) via HTTP POST to `/api/telemetry`
- Sends binary Protocol Buffer data in request body
- Receives JSON response with compression statistics

## Thread Safety

- Main thread: Data ingestion and network checks
- Sync worker thread: Buffer upload and SQLite reads
- SQLite WAL mode ensures concurrent read/write safety
- Atomic flags for thread coordination

## Error Handling

- Network failures: Gracefully buffers data
- SQLite errors: Logs error, continues operation (data may be lost)
- Invalid CSV data: Skips malformed lines, continues processing
- Protobuf serialization errors: Logs error, skips record

## Future Enhancements

- [ ] Hardware-in-the-loop CAN bus integration
- [ ] Encrypted buffer storage
- [ ] Compression algorithm tuning per vehicle type
- [ ] Local metrics endpoint
- [ ] OTA update capability

