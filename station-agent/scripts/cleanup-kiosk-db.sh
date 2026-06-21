#!/bin/bash

# Get directory where script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
PID_FILE="$SCRIPT_DIR/services.pid"

echo "=== ND Station Agent Kiosk DB Cleanup ==="

# Check if services are running
if [ -f "$PID_FILE" ]; then
    echo "[!] Services are currently running."
    echo "[*] Please run kill-all.sh first before cleaning up databases."
    exit 1
fi

KIOSK_DB_PATH="$ROOT_DIR/services/kiosk-ui/src/ND.KioskUi.Api/data/kiosk.db"

if [ -f "$KIOSK_DB_PATH" ]; then
    echo "[*] Deleting Kiosk SQLite database files..."
    rm -f "$KIOSK_DB_PATH"
    rm -f "${KIOSK_DB_PATH}-wal"
    rm -f "${KIOSK_DB_PATH}-shm"
    echo "[+] Deleted Kiosk database files successfully."
else
    echo "[+] Kiosk database file not found (already clean)."
fi

# Re-create and seed the database file immediately
echo "[*] Initializing and seeding Kiosk DB with super user (admin123 / admin123)..."
cd "$ROOT_DIR/services/kiosk-ui/src/ND.KioskUi.Api"
dotnet run -- --seed-only

echo "[+] Done. Kiosk DB has been re-created and seeded."
