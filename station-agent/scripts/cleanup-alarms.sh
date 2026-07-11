#!/bin/bash

# ============================================================
# cleanup-alarms.sh — ND Station Agent (dev/local)
# Cleans projection_alarms table in the local SQLite database.
# Services do NOT need to be stopped; the table is cleared
# surgically so schema and other data are untouched.
# ============================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Default: projection service DB path (matches SQLITE_PROJECTION_PATH env)
DB_SEARCH_PATH="$ROOT_DIR/sqlite-databases"
FALLBACK_PATH="$ROOT_DIR/services/projection-service"

echo "=== ND Station Agent — Alarm Data Cleanup ==="
echo ""

# ── Locate the database ──────────────────────────────────────────────────────
DB_FILE=$(find "$DB_SEARCH_PATH" "$FALLBACK_PATH" -name "projection.db" 2>/dev/null | head -1)

if [ -z "$DB_FILE" ]; then
    echo "[!] Could not find projection.db under:"
    echo "      $DB_SEARCH_PATH"
    echo "      $FALLBACK_PATH"
    echo "    Start the service at least once to create the database."
    exit 1
fi

echo "[*] Found database: $DB_FILE"
echo ""

# ── Confirm before deleting ──────────────────────────────────────────────────
TOTAL=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM projection_alarms;" 2>/dev/null || echo "0")
ACTIVE=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM projection_alarms WHERE current_state = 'Active';" 2>/dev/null || echo "0")
ACKED=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM projection_alarms WHERE current_state = 'Acknowledged';" 2>/dev/null || echo "0")

echo "    Current alarm counts:"
echo "      Total      : $TOTAL"
echo "      Active     : $ACTIVE"
echo "      Acknowledged: $ACKED"
echo ""

# ── Parse flags ──────────────────────────────────────────────────────────────
MODE="all"       # all | active | older-than
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
        CUTOFF=$(date -v -${DAYS}d '+%Y-%m-%d' 2>/dev/null || date -d "-${DAYS} days" '+%Y-%m-%d' 2>/dev/null)
        SQL="DELETE FROM projection_alarms WHERE created_at < '${CUTOFF}';"
        DESCRIPTION="Alarms older than $DAYS days (before $CUTOFF)"
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

# ── Execute ──────────────────────────────────────────────────────────────────
echo ""
echo "[*] Running cleanup..."
sqlite3 "$DB_FILE" "$SQL"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "[!] sqlite3 returned error code $EXIT_CODE."
    exit $EXIT_CODE
fi

AFTER=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM projection_alarms;" 2>/dev/null || echo "?")
echo "[+] Done. Remaining alarm rows: $AFTER"
echo ""
echo "    Note: Services do not need to be restarted."
echo "          The alarm banner and Alarm Center UI will update on next poll."
