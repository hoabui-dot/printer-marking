#!/bin/bash

# ============================================================
# cleanup-alarms.sh — ND Station Agent (production / Docker)
# Cleans projection_alarms rows inside the running container.
# The projection-service container stays running; only the
# alarm rows are deleted via sqlite3 exec inside the container.
# ============================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
COMPOSE_FILE="$SCRIPT_DIR/../docker-compose.prod.yml"
ENV_FILE="$SCRIPT_DIR/../../.env"

# Container name as defined in docker-compose.prod.yml
CONTAINER="station-projection"
# DB path inside the container (matches SQLITE_PROJECTION_PATH)
DB_PATH="/data/projection.db"

echo "=== ND Station Agent — Production Alarm Cleanup ==="
echo ""

# ── Check container is running ───────────────────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "[!] Container '${CONTAINER}' is not running."
    echo "    Start the stack first: ./run.sh"
    exit 1
fi

echo "[*] Connected to container: $CONTAINER"
echo ""

# ── Parse flags ──────────────────────────────────────────────────────────────
MODE="all"
DAYS=0
FORCE=false

for arg in "$@"; do
    case "$arg" in
        --active-only)   MODE="active" ;;
        --days=*)        MODE="older-than"; DAYS="${arg#--days=}" ;;
        --force|-f)      FORCE=true ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "  (no flags)        Delete ALL alarms"
            echo "  --active-only     Delete only Active (unacknowledged) alarms"
            echo "  --days=N          Delete alarms older than N days"
            echo "  --force, -f       Skip confirmation prompt"
            echo ""
            exit 0
            ;;
    esac
done

# ── Show current counts ──────────────────────────────────────────────────────
TOTAL=$(docker exec "$CONTAINER" sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM projection_alarms;" 2>/dev/null || echo "0")
ACTIVE=$(docker exec "$CONTAINER" sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM projection_alarms WHERE current_state = 'Active';" 2>/dev/null || echo "0")
ACKED=$(docker exec "$CONTAINER" sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM projection_alarms WHERE current_state = 'Acknowledged';" 2>/dev/null || echo "0")

echo "    Current alarm counts:"
echo "      Total       : $TOTAL"
echo "      Active      : $ACTIVE"
echo "      Acknowledged: $ACKED"
echo ""

# ── Build SQL ────────────────────────────────────────────────────────────────
case "$MODE" in
    all)
        SQL="DELETE FROM projection_alarms;"
        DESCRIPTION="ALL alarms ($TOTAL rows)"
        ;;
    active)
        SQL="DELETE FROM projection_alarms WHERE current_state = 'Active';"
        DESCRIPTION="Active (unacknowledged) alarms ($ACTIVE rows)"
        ;;
    older-than)
        # Use SQLite's datetime() so we don't rely on host date format
        SQL="DELETE FROM projection_alarms WHERE created_at < datetime('now', '-${DAYS} days');"
        DESCRIPTION="Alarms older than $DAYS days"
        ;;
esac

echo "[!] About to delete: $DESCRIPTION"
echo ""

if [ "$FORCE" = false ]; then
    read -r -p "    Proceed? [y/N] " confirm
    case "$confirm" in
        [yY][eE][sS]|[yY]) ;;
        *)
            echo "[x] Aborted — no data was deleted."
            exit 0
            ;;
    esac
fi

# ── Execute inside container ─────────────────────────────────────────────────
echo ""
echo "[*] Running cleanup inside container '$CONTAINER'..."
docker exec "$CONTAINER" sqlite3 "$DB_PATH" "$SQL"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "[!] sqlite3 returned error code $EXIT_CODE. Check the container logs."
    exit $EXIT_CODE
fi

AFTER=$(docker exec "$CONTAINER" sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM projection_alarms;" 2>/dev/null || echo "?")
echo "[+] Done. Remaining alarm rows: $AFTER"
echo ""
echo "    Note: The projection-service container is still running."
echo "          The Alarm Center UI will reflect the change on next page refresh."
