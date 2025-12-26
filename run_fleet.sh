#!/bin/bash
# Multi-Vehicle Fleet Simulator
# Runs multiple C++ logger instances with different VINs

# Array of vehicle VINs (5 vehicles total)
VINS=(
    "5YJ3E1EA1KF000001"  # Model 3 Long Range (original)
    "5YJ3E1EA2KF000002"  # Model Y Performance
    "5YJSA1E26MF000003"  # Model S Plaid
    "7SAYGDEE3MF000004"  # Model X Long Range
    "5YJ3E1EB9MF000005"  # Model 3 Standard Range
)

# Colors for terminal output
COLORS=("\033[0;32m" "\033[0;36m" "\033[0;33m" "\033[0;35m" "\033[0;34m")
RESET="\033[0m"

echo "================================================"
echo "  Multi-Vehicle Tesla Telemetry Fleet Simulator"
echo "================================================"
echo ""
echo "Starting ${#VINS[@]} vehicle loggers..."
echo ""

# Rebuild the logger
cd cpp_edge
echo "Compiling logger..."
g++ -std=c++17 -o logger logger.cpp telemetry.pb.cc -lprotobuf -lcurl -lsqlite3
if [ $? -ne 0 ]; then
    echo "Compilation failed!"
    exit 1
fi
cd ..

# Function to run a single vehicle logger
run_vehicle() {
    VIN=$1
    COLOR=$2
    INDEX=$3
    
    # Set unique server port offset (optional, use same server for now)
    # export SERVER_PORT=$((8001 + INDEX))
    
    while true; do
        echo -e "${COLOR}[Vehicle ${VIN:(-6)}] Starting logger...${RESET}"
        VEHICLE_VIN=$VIN ./cpp_edge/logger 2>&1 | while IFS= read -r line; do
            echo -e "${COLOR}[${VIN:(-6)}]${RESET} $line"
        done
        
        echo -e "${COLOR}[Vehicle ${VIN:(-6)}] Logger stopped. Restarting in 5s...${RESET}"
        sleep 5
    done
}

# Start each vehicle logger in background
PIDS=()
for i in "${!VINS[@]}"; do
    run_vehicle "${VINS[$i]}" "${COLORS[$i]}" "$i" &
    PIDS+=($!)
    sleep 2  # Stagger starts
done

echo ""
echo "All ${#VINS[@]} vehicle loggers started!"
echo "Process IDs: ${PIDS[@]}"
echo ""
echo "Press Ctrl+C to stop all loggers"
echo ""

# Wait for all background processes
trap "echo 'Stopping all loggers...'; kill ${PIDS[@]} 2>/dev/null; exit" SIGINT SIGTERM

# Keep script running
wait
