# Dockerfile for Tesla Telemetry Backend (Cloud Run)
# Frontend deployed separately to Vercel
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    g++ \
    libprotobuf-dev \
    protobuf-compiler \
    libcurl4-openssl-dev \
    libsqlite3-dev \
    nlohmann-json3-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Python requirements first
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy protobuf schema
COPY telemetry.proto .

# Copy Python server code first
COPY python_cloud/ ./python_cloud/

# Compile protobuf for Python into python_cloud directory
RUN protoc --python_out=python_cloud telemetry.proto

# Copy C++ source files
COPY cpp_edge/ ./cpp_edge/

# Compile protobuf for C++ 
RUN protoc --cpp_out=cpp_edge telemetry.proto

# Compile C++ logger
RUN cd cpp_edge && \
    g++ -std=c++17 -o logger logger.cpp telemetry.pb.cc \
    -lprotobuf -lcurl -lsqlite3

# Copy data files
COPY data/ ./data/

# Expose port 8080 for Cloud Run
EXPOSE 8080

# Set Python path and working directory
ENV PYTHONUNBUFFERED=1
WORKDIR /app/python_cloud

# Run the Python server
CMD ["python", "server.py"]
