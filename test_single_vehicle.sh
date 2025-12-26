#!/bin/bash
# Quick test: Run single vehicle logger

VIN="5YJ3E1EA2KF000002"  # Model Y Performance

echo "Testing single vehicle logger..."
echo "VIN: $VIN (Model Y Performance)"
echo ""
echo "Make sure the server is running in another terminal:"
echo "  python python_cloud/server.py"
echo ""
echo "Press Ctrl+C to stop"
echo ""

cd cpp_edge
VEHICLE_VIN=$VIN ./logger
