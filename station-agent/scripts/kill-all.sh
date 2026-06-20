#!/bin/bash

# Get directory where script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PID_FILE="$SCRIPT_DIR/services.pid"

echo "=== ND Station Agent System Stopper ==="

if [ ! -f "$PID_FILE" ]; then
    echo "[!] No PID file found at $PID_FILE."
    echo "[*] Attempting fallback: killing any ND.* processes..."
    
    # Fallback pattern matching
    pkill -f "ND.MqttAdapter"
    pkill -f "ND.JobEngine"
    pkill -f "ND.PrinterAdapter"
    pkill -f "ND.LaserAdapter"
    pkill -f "ND.VisionService"
    pkill -f "ND.PlcAdapter"
    pkill -f "ND.KioskUi"
    pkill -f "ND.DeviceSimulator"
    
    echo "[+] Done."
    exit 0
fi

# Read PID file and kill processes
while IFS=: read -r name pid; do
    if [ -n "$pid" ]; then
        echo "[*] Stopping $name (PID: $pid)..."
        # Check if process is still running
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid"
            # Give it a moment to stop gracefully, then force kill if needed
            sleep 0.5
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid"
            fi
            echo "[+] Stopped $name."
        else
            echo "[?] $name (PID: $pid) was not running."
        fi
    fi
done < "$PID_FILE"

rm -f "$PID_FILE"
echo "[+] Cleaned up PID file. All services stopped."
