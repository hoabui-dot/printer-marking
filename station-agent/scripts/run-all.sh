#!/bin/bash

# Get directory where script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
PID_FILE="$SCRIPT_DIR/services.pid"
LOGS_DIR="$SCRIPT_DIR/logs"

mkdir -p "$LOGS_DIR"

echo "=== ND Station Agent System Runner ==="

# 1. Check if Redis is running locally
if ! nc -z localhost 6379 &>/dev/null; then
    echo "[!] Redis is not running on localhost:6379."
    echo "[*] Attempting to start Redis via Docker..."
    docker run -d --name station-redis-local -p 6379:6379 redis:7.4-alpine &>/dev/null
    if [ $? -eq 0 ]; then
        echo "[+] Successfully started Redis in Docker container 'station-redis-local'."
    else
        echo "[-] Failed to start Redis. Please make sure Redis or Docker is running."
        exit 1
    fi
else
    echo "[+] Redis is already running on localhost:6379."
fi

# 2. Check if a run is already active
if [ -f "$PID_FILE" ]; then
    echo "[-] PID file already exists at $PID_FILE. Services might already be running."
    echo "[*] Please run kill-all.sh first."
    exit 1
fi

echo "Starting services in background..."
touch "$PID_FILE"

# Helper function to start a service
start_service() {
    local name=$1
    local path=$2
    local port=$3
    local env_vars=$4
    
    echo "[*] Starting $name on port $port..."
    cd "$ROOT_DIR/$path"
    
    # Run dotnet run in background, redirect output to log file
    if [ -n "$env_vars" ]; then
        env $env_vars dotnet run > "$LOGS_DIR/$name.log" 2>&1 &
    else
        dotnet run > "$LOGS_DIR/$name.log" 2>&1 &
    fi
    
    local pid=$!
    echo "$name:$pid" >> "$PID_FILE"
    echo "[+] Started $name (PID: $pid). Logs: scripts/logs/$name.log"
}

# Start all 8 services
start_service "mqtt-adapter" "services/mqtt-adapter/src/ND.MqttAdapter.Worker" "N/A (Worker)" "ASPNETCORE_ENVIRONMENT=Development"
start_service "job-engine" "services/job-engine/src/ND.JobEngine.Api" "5002" "ASPNETCORE_ENVIRONMENT=Development"
start_service "printer-adapter" "services/printer-adapter/src/ND.PrinterAdapter.Api" "5003" "ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5003"
start_service "laser-adapter" "services/laser-adapter/src/ND.LaserAdapter.Api" "5004" "ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5004"
start_service "vision-service" "services/vision-service/src/ND.VisionService.Api" "5005" "ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5005"
start_service "plc-adapter" "services/plc-adapter/src/ND.PlcAdapter.Api" "5006" "ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5006"
start_service "kiosk-ui" "services/kiosk-ui/src/ND.KioskUi.Api" "5007" "ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5007"
start_service "device-simulator" "services/device-simulator/src/ND.DeviceSimulator.Api" "5000/5008" "ASPNETCORE_ENVIRONMENT=Development"

echo "=== All backend services started! ==="
echo "[*] To check logs, tail files in: scripts/logs/"
echo "[*] To stop all services, run: scripts/kill-all.sh"
