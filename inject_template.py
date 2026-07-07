import sqlite3
import os
import json
import uuid
from datetime import datetime

# Define the relative database paths to update
DB_PATHS = [
    "./station-agent/sqlite-databases/printer.db",
    "./station-agent/services/printer-adapter/src/ND.PrinterAdapter.Api/data/printer.db"
]

# The template definition
TEMPLATE_NAME = "Industrial Product QR Label"
TEMPLATE_DESCRIPTION = "Won Seal Tech Co., Ltd. 50x30mm Professional QR Code manufacturing label."
TEMPLATE_DPI = 203
TEMPLATE_WIDTH = 50.0
TEMPLATE_HEIGHT = 30.0

TEMPLATE_JSON = {
  "width": 50,
  "height": 30,
  "dpi": 203,
  "elements": [
    { "type": "text", "x": 15, "y": 20, "fontSize": 14, "text": "WON SEAL TECH CO., LTD." },
    { "type": "text", "x": 15, "y": 55, "fontSize": 11, "binding": "product_name", "defaultValue": "Bearing Seal" },
    { "type": "text", "x": 15, "y": 95, "fontSize": 9, "text": "Product:" },
    { "type": "text", "x": 100, "y": 95, "fontSize": 10, "binding": "product_code", "defaultValue": "BEARING-SEAL-01" },
    { "type": "text", "x": 15, "y": 135, "fontSize": 9, "text": "Serial:" },
    { "type": "text", "x": 100, "y": 135, "fontSize": 10, "binding": "serial_number", "defaultValue": "SN-PO-2026-0001-000001" },
    { "type": "text", "x": 15, "y": 175, "fontSize": 9, "text": "Batch:" },
    { "type": "text", "x": 80, "y": 175, "fontSize": 9, "binding": "batch_number", "defaultValue": "BATCH-01" },
    { "type": "text", "x": 170, "y": 175, "fontSize": 9, "text": "Rev:" },
    { "type": "text", "x": 215, "y": 175, "fontSize": 9, "binding": "revision", "defaultValue": "A" },
    { "type": "text", "x": 15, "y": 210, "fontSize": 9, "text": "Date:" },
    { "type": "text", "x": 100, "y": 210, "fontSize": 9, "binding": "production_date", "defaultValue": "2026-07-07" },
    {
      "type": "qr",
      "x": 270,
      "y": 70,
      "magnification": 4,
      "payloadTemplate": '{"serial":"{serial_number}","product":"{product_code}","revision":"{revision}","batch":"{batch_number}"}'
    }
  ]
}

def migrate_and_inject(db_path):
    print(f"Checking database: {db_path}...")
    if not os.path.exists(db_path):
        print(f"Database file {db_path} does not exist. Skipping.")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 1. Safely create label_templates table if not exists
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS label_templates (
        id TEXT NOT NULL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        dpi INTEGER NOT NULL,
        label_width REAL NOT NULL,
        label_height REAL NOT NULL,
        template_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        is_active INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'published',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        updated_by TEXT
    );
    """)

    # 2. Safely create label_template_versions table if not exists
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS label_template_versions (
        id TEXT NOT NULL PRIMARY KEY,
        template_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        template_json TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL
    );
    """)

    # 3. Safely add columns if they don't exist
    columns_to_add = [
        ("label_templates", "status", "TEXT NOT NULL DEFAULT 'published'"),
        ("label_templates", "is_default", "INTEGER NOT NULL DEFAULT 0"),
        ("label_templates", "created_by", "TEXT"),
        ("label_templates", "updated_by", "TEXT"),
    ]

    for table, col, col_type in columns_to_add:
        try:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type};")
            print(f"  Added column '{col}' to table '{table}'.")
        except sqlite3.OperationalError:
            # Column already exists
            pass

    # 4. Safely create printer_template_assignments table if not exists
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS printer_template_assignments (
        id TEXT PRIMARY KEY,
        printer_code TEXT NOT NULL UNIQUE,
        template_id TEXT NOT NULL,
        template_name TEXT,
        assigned_by TEXT,
        assigned_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    """)

    # 5. Check if template exists
    cursor.execute("SELECT id, version FROM label_templates WHERE name = ?;", (TEMPLATE_NAME,))
    row = cursor.fetchone()

    now_str = datetime.utcnow().isoformat() + "Z"
    json_str = json.dumps(TEMPLATE_JSON)

    if row:
        template_id, current_version = row
        new_version = current_version + 1
        print(f"  Found existing template '{TEMPLATE_NAME}' (ID: {template_id}, v{current_version}). Updating to v{new_version}...")
        
        # Insert a version snapshot of current state
        cursor.execute("SELECT template_json FROM label_templates WHERE id = ?;", (template_id,))
        old_json = cursor.fetchone()[0]
        snapshot_id = str(uuid.uuid4())
        cursor.execute("""
        INSERT INTO label_template_versions (id, template_id, version, template_json, created_at)
        VALUES (?, ?, ?, ?, ?);
        """, (snapshot_id, template_id, current_version, old_json, now_str))

        # Clear default flag on others if setting this one as default
        cursor.execute("UPDATE label_templates SET is_default = 0;")

        # Update active template
        cursor.execute("""
        UPDATE label_templates
        SET description = ?, dpi = ?, label_width = ?, label_height = ?, template_json = ?, version = ?, is_default = 1, status = 'published', updated_at = ?
        WHERE id = ?;
        """, (TEMPLATE_DESCRIPTION, TEMPLATE_DPI, TEMPLATE_WIDTH, TEMPLATE_HEIGHT, json_str, new_version, now_str, template_id))
    else:
        template_id = str(uuid.uuid4())
        print(f"  No template named '{TEMPLATE_NAME}' found. Creating new with ID {template_id}...")
        
        # Clear default flag on others
        cursor.execute("UPDATE label_templates SET is_default = 0;")

        # Insert new
        cursor.execute("""
        INSERT INTO label_templates (id, name, description, dpi, label_width, label_height, template_json, version, is_active, status, is_default, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 'published', 1, 'system', 'system', ?, ?);
        """, (template_id, TEMPLATE_NAME, TEMPLATE_DESCRIPTION, TEMPLATE_DPI, TEMPLATE_WIDTH, TEMPLATE_HEIGHT, json_str, now_str, now_str))

    conn.commit()
    conn.close()
    print(f"Successfully updated/injected template in {db_path}!\n")

if __name__ == "__main__":
    for path in DB_PATHS:
        migrate_and_inject(path)
    print("All template injections completed successfully.")
