#!/usr/bin/env python3
"""
inject_template.py
------------------
Injects all industrial label templates into the printer-adapter SQLite database.
Idempotent: checks by template_code. Existing templates are version-snapshotted
then updated. New metadata columns are added safely.

Usage:
    python inject_template.py               # auto-detect: local or docker
    python inject_template.py --docker      # force run inside Docker container
    python inject_template.py --local       # force run against local file paths
"""

import sqlite3
import os
import sys
import json
import uuid
import subprocess
from datetime import datetime

# ── Database paths ─────────────────────────────────────────────────────────────
DB_PATHS = [
    "./station-agent/sqlite-databases/printer.db",
    "./station-agent/services/printer-adapter/src/ND.PrinterAdapter.Api/data/printer.db"
]

# ── Template definitions ───────────────────────────────────────────────────────
# Each entry is a dict with all required fields.
# is_default = True for exactly ONE template (the system default for print jobs).

TEMPLATES = [
    {
        "template_code": "LBL-PRODUCT-50x30",
        "name": "Industrial Product QR Label",
        "description": "Won Seal Tech Co., Ltd. — 50×30mm standard product label with QR code and serial number.",
        "category": "PRODUCT",
        "dpi": 203,
        "label_width": 50.0,
        "label_height": 30.0,
        "orientation": "LANDSCAPE",
        "revision": "A",
        "supported_barcode_types": json.dumps(["QR"]),
        "supported_printer_models": json.dumps(["GK420t", "ZT230", "ZT410"]),
        "compatible_station_types": json.dumps(["PRINT_STATION", "MARK_STATION"]),
        "is_default": True,
        "template_json": {
            "width": 50, "height": 30, "dpi": 203,
            "elements": [
                {"type": "text", "x": 10, "y": 15, "fontSize": 11, "text": "WON SEAL TECH CO., LTD."},
                {"type": "text", "x": 10, "y": 50, "fontSize": 10, "binding": "product_name", "defaultValue": "Bearing Seal"},
                {"type": "text", "x": 10, "y": 85, "fontSize": 8, "text": "Product:"},
                {"type": "text", "x": 90, "y": 85, "fontSize": 9, "binding": "product_code", "defaultValue": "BEARING-SEAL-01"},
                {"type": "text", "x": 10, "y": 115, "fontSize": 8, "text": "Serial:"},
                {"type": "text", "x": 90, "y": 115, "fontSize": 9, "binding": "serial_number", "defaultValue": "SN-000001"},
                {"type": "text", "x": 10, "y": 145, "fontSize": 7, "binding": "batch_number", "defaultValue": "BATCH-01"},
                {"type": "text", "x": 150, "y": 145, "fontSize": 7, "text": "Rev:"},
                {"type": "text", "x": 185, "y": 145, "fontSize": 7, "binding": "revision", "defaultValue": "A"},
                {"type": "text", "x": 10, "y": 170, "fontSize": 7, "binding": "production_date", "defaultValue": "2026-07-09"},
                {
                    "type": "qr", "x": 280, "y": 50, "magnification": 4,
                    "payloadTemplate": '{"sn":"{serial_number}","prod":"{product_code}","rev":"{revision}","batch":"{batch_number}"}'
                }
            ]
        }
    },
    {
        "template_code": "LBL-SHELF-50x30",
        "name": "Shelf / Rack Location Label",
        "description": "Warehouse location identification. 50×30mm with QR and Code128.",
        "category": "SHELF",
        "dpi": 203,
        "label_width": 50.0,
        "label_height": 30.0,
        "orientation": "LANDSCAPE",
        "revision": "A",
        "supported_barcode_types": json.dumps(["CODE128", "QR"]),
        "supported_printer_models": json.dumps(["GK420t", "ZD420", "ZT230"]),
        "compatible_station_types": json.dumps(["WAREHOUSE", "PRINT_STATION"]),
        "is_default": False,
        "template_json": {
            "width": 50, "height": 30, "dpi": 203,
            "elements": [
                {"type": "text", "x": 10, "y": 12, "fontSize": 9, "text": "LOCATION"},
                {"type": "text", "x": 10, "y": 45, "fontSize": 18, "binding": "location_code", "defaultValue": "A-01-03"},
                {"type": "text", "x": 10, "y": 100, "fontSize": 7, "binding": "zone", "defaultValue": "Zone A - Row 1"},
                {"type": "barcode", "x": 10, "y": 125, "height": 50, "symbology": "CODE128", "barWidth": 2,
                 "binding": "location_code", "defaultValue": "A-01-03"},
                {"type": "qr", "x": 300, "y": 30, "magnification": 3, "binding": "location_code", "defaultValue": "A-01-03"}
            ]
        }
    },
    {
        "template_code": "LBL-INSP-100x60",
        "name": "Inspection / Supervisor Label",
        "description": "QC inspection records, supervisor sign-off. 100×60mm, Code128.",
        "category": "INSPECTION",
        "dpi": 203,
        "label_width": 100.0,
        "label_height": 60.0,
        "orientation": "LANDSCAPE",
        "revision": "A",
        "supported_barcode_types": json.dumps(["CODE128"]),
        "supported_printer_models": json.dumps(["GK420t", "ZT230", "ZT410"]),
        "compatible_station_types": json.dumps(["QC_STATION", "PRINT_STATION"]),
        "is_default": False,
        "template_json": {
            "width": 100, "height": 60, "dpi": 203,
            "elements": [
                {"type": "rect", "x": 5, "y": 5, "width": 790, "height": 470, "strokeWidth": 3},
                {"type": "text", "x": 15, "y": 20, "fontSize": 16, "text": "INSPECTION RECORD"},
                {"type": "line", "x": 5, "y": 65, "width": 790, "height": 2},
                {"type": "text", "x": 15, "y": 80, "fontSize": 9, "text": "Job No:"},
                {"type": "text", "x": 120, "y": 80, "fontSize": 10, "binding": "production_order", "defaultValue": "PO-2026-001"},
                {"type": "text", "x": 15, "y": 120, "fontSize": 9, "text": "Product:"},
                {"type": "text", "x": 120, "y": 120, "fontSize": 10, "binding": "product_code", "defaultValue": "BEARING-SEAL-01"},
                {"type": "text", "x": 15, "y": 160, "fontSize": 9, "text": "Serial:"},
                {"type": "text", "x": 120, "y": 160, "fontSize": 10, "binding": "serial_number", "defaultValue": "SN-000001"},
                {"type": "text", "x": 15, "y": 200, "fontSize": 9, "text": "Inspector:"},
                {"type": "text", "x": 120, "y": 200, "fontSize": 10, "binding": "operator", "defaultValue": "Inspector A"},
                {"type": "text", "x": 15, "y": 240, "fontSize": 9, "text": "Date:"},
                {"type": "text", "x": 120, "y": 240, "fontSize": 9, "binding": "production_date", "defaultValue": "2026-07-09"},
                {"type": "text", "x": 15, "y": 280, "fontSize": 9, "text": "Result:"},
                {"type": "text", "x": 120, "y": 280, "fontSize": 14, "binding": "inspection_result", "defaultValue": "PASS"},
                {"type": "barcode", "x": 15, "y": 320, "height": 80, "symbology": "CODE128", "barWidth": 2,
                 "binding": "serial_number", "defaultValue": "SN-000001"}
            ]
        }
    },
    {
        "template_code": "LBL-ROLL-100x80",
        "name": "Roll / Material Reel Label",
        "description": "Rubber rolls and raw material reels. 100×80mm with large Code128.",
        "category": "MATERIAL",
        "dpi": 203,
        "label_width": 100.0,
        "label_height": 80.0,
        "orientation": "PORTRAIT",
        "revision": "A",
        "supported_barcode_types": json.dumps(["CODE128"]),
        "supported_printer_models": json.dumps(["ZT230", "ZT410", "ZT610"]),
        "compatible_station_types": json.dumps(["WAREHOUSE", "MATERIAL_STATION"]),
        "is_default": False,
        "template_json": {
            "width": 100, "height": 80, "dpi": 203,
            "elements": [
                {"type": "text", "x": 15, "y": 15, "fontSize": 13, "text": "MATERIAL REEL"},
                {"type": "line", "x": 5, "y": 55, "width": 790, "height": 2},
                {"type": "text", "x": 15, "y": 70, "fontSize": 9, "text": "Material:"},
                {"type": "text", "x": 130, "y": 70, "fontSize": 11, "binding": "material", "defaultValue": "NBR-70 Rubber"},
                {"type": "text", "x": 15, "y": 110, "fontSize": 9, "text": "Lot No:"},
                {"type": "text", "x": 130, "y": 110, "fontSize": 11, "binding": "lot_number", "defaultValue": "LOT-2026-07-A"},
                {"type": "text", "x": 15, "y": 150, "fontSize": 9, "text": "Roll ID:"},
                {"type": "text", "x": 130, "y": 150, "fontSize": 11, "binding": "serial_number", "defaultValue": "ROLL-001"},
                {"type": "text", "x": 15, "y": 190, "fontSize": 9, "text": "Weight (kg):"},
                {"type": "text", "x": 200, "y": 190, "fontSize": 11, "binding": "weight", "defaultValue": "25.0"},
                {"type": "text", "x": 15, "y": 230, "fontSize": 9, "text": "MFG Date:"},
                {"type": "text", "x": 130, "y": 230, "fontSize": 9, "binding": "manufacture_date", "defaultValue": "2026-07-09"},
                {"type": "barcode", "x": 15, "y": 280, "height": 130, "symbology": "CODE128", "barWidth": 3,
                 "binding": "serial_number", "defaultValue": "ROLL-001"},
                {"type": "text", "x": 15, "y": 420, "fontSize": 7, "binding": "lot_number", "defaultValue": "LOT-2026-07-A"}
            ]
        }
    },
    {
        "template_code": "LBL-PALLET-100x150",
        "name": "Pallet Label",
        "description": "Shipping, warehouse and forklift scanning pallet label. 100×150mm with large QR and Code128.",
        "category": "PALLET",
        "dpi": 203,
        "label_width": 100.0,
        "label_height": 150.0,
        "orientation": "PORTRAIT",
        "revision": "A",
        "supported_barcode_types": json.dumps(["CODE128", "QR"]),
        "supported_printer_models": json.dumps(["ZT410", "ZT610", "ZT620"]),
        "compatible_station_types": json.dumps(["WAREHOUSE", "SHIPPING_STATION"]),
        "is_default": False,
        "template_json": {
            "width": 100, "height": 150, "dpi": 203,
            "elements": [
                {"type": "rect", "x": 5, "y": 5, "width": 790, "height": 1190, "strokeWidth": 4},
                {"type": "text", "x": 20, "y": 20, "fontSize": 18, "text": "PALLET"},
                {"type": "line", "x": 5, "y": 75, "width": 790, "height": 3},
                {
                    "type": "qr", "x": 30, "y": 90, "magnification": 8,
                    "payloadTemplate": '{"pallet":"{serial_number}","po":"{production_order}","prod":"{product_code}"}'
                },
                {"type": "text", "x": 430, "y": 90, "fontSize": 8, "text": "Order:"},
                {"type": "text", "x": 430, "y": 120, "fontSize": 11, "binding": "production_order", "defaultValue": "PO-2026-001"},
                {"type": "text", "x": 430, "y": 160, "fontSize": 8, "text": "Product:"},
                {"type": "text", "x": 430, "y": 190, "fontSize": 10, "binding": "product_code", "defaultValue": "BEARING-SEAL-01"},
                {"type": "text", "x": 430, "y": 230, "fontSize": 8, "text": "Pallet ID:"},
                {"type": "text", "x": 430, "y": 260, "fontSize": 10, "binding": "serial_number", "defaultValue": "PLT-001"},
                {"type": "text", "x": 430, "y": 300, "fontSize": 8, "text": "Qty:"},
                {"type": "text", "x": 430, "y": 330, "fontSize": 14, "binding": "quantity", "defaultValue": "100"},
                {"type": "text", "x": 430, "y": 380, "fontSize": 8, "text": "Destination:"},
                {"type": "text", "x": 430, "y": 410, "fontSize": 9, "binding": "destination", "defaultValue": "WAREHOUSE A"},
                {"type": "line", "x": 5, "y": 490, "width": 790, "height": 3},
                {"type": "text", "x": 20, "y": 510, "fontSize": 8, "text": "Shipper:"},
                {"type": "text", "x": 130, "y": 510, "fontSize": 9, "binding": "customer", "defaultValue": "Won Seal Tech"},
                {"type": "text", "x": 20, "y": 550, "fontSize": 8, "text": "Date:"},
                {"type": "text", "x": 130, "y": 550, "fontSize": 9, "binding": "manufacture_date", "defaultValue": "2026-07-09"},
                {"type": "barcode", "x": 20, "y": 600, "height": 150, "symbology": "CODE128", "barWidth": 4,
                 "binding": "serial_number", "defaultValue": "PLT-001"},
                {"type": "text", "x": 20, "y": 760, "fontSize": 7, "binding": "serial_number", "defaultValue": "PLT-001"}
            ]
        }
    },
    {
        "template_code": "LBL-SHEET-P-80x50",
        "name": "Parent Rubber Sheet Label",
        "description": "Parent sheet identification for rubber sheet tracking. 80×50mm with QR.",
        "category": "SHEET",
        "dpi": 203,
        "label_width": 80.0,
        "label_height": 50.0,
        "orientation": "LANDSCAPE",
        "revision": "A",
        "supported_barcode_types": json.dumps(["QR"]),
        "supported_printer_models": json.dumps(["GK420t", "ZT230"]),
        "compatible_station_types": json.dumps(["MATERIAL_STATION", "PRINT_STATION"]),
        "is_default": False,
        "template_json": {
            "width": 80, "height": 50, "dpi": 203,
            "elements": [
                {"type": "text", "x": 10, "y": 12, "fontSize": 11, "text": "PARENT SHEET"},
                {"type": "line", "x": 5, "y": 45, "width": 530, "height": 2},
                {"type": "text", "x": 10, "y": 60, "fontSize": 9, "text": "Sheet ID:"},
                {"type": "text", "x": 120, "y": 60, "fontSize": 11, "binding": "serial_number", "defaultValue": "SHEET-P-001"},
                {"type": "text", "x": 10, "y": 100, "fontSize": 9, "text": "Material:"},
                {"type": "text", "x": 120, "y": 100, "fontSize": 10, "binding": "material", "defaultValue": "NBR-70"},
                {"type": "text", "x": 10, "y": 140, "fontSize": 9, "text": "Lot:"},
                {"type": "text", "x": 80, "y": 140, "fontSize": 9, "binding": "lot_number", "defaultValue": "LOT-2026-07-A"},
                {"type": "text", "x": 10, "y": 180, "fontSize": 9, "text": "Size:"},
                {"type": "text", "x": 80, "y": 180, "fontSize": 9, "binding": "sheet_size", "defaultValue": "1200x600mm"},
                {"type": "text", "x": 10, "y": 220, "fontSize": 8, "binding": "manufacture_date", "defaultValue": "2026-07-09"},
                {
                    "type": "qr", "x": 570, "y": 40, "magnification": 6,
                    "payloadTemplate": '{"sheet":"{serial_number}","lot":"{lot_number}","mat":"{material}"}'
                }
            ]
        }
    },
    {
        "template_code": "LBL-SHEET-C-50x30",
        "name": "Child Rubber Sheet Label",
        "description": "Individual child sheet tracking cut from parent. 50×30mm compact QR.",
        "category": "SHEET",
        "dpi": 203,
        "label_width": 50.0,
        "label_height": 30.0,
        "orientation": "LANDSCAPE",
        "revision": "A",
        "supported_barcode_types": json.dumps(["QR"]),
        "supported_printer_models": json.dumps(["GK420t", "ZD420"]),
        "compatible_station_types": json.dumps(["MATERIAL_STATION", "PRINT_STATION"]),
        "is_default": False,
        "template_json": {
            "width": 50, "height": 30, "dpi": 203,
            "elements": [
                {"type": "text", "x": 8, "y": 10, "fontSize": 9, "text": "CHILD SHEET"},
                {"type": "text", "x": 8, "y": 40, "fontSize": 8, "binding": "serial_number", "defaultValue": "SHEET-C-001"},
                {"type": "text", "x": 8, "y": 70, "fontSize": 7, "binding": "lot_number", "defaultValue": "LOT-2026-07-A"},
                {"type": "text", "x": 8, "y": 100, "fontSize": 7, "text": "Parent:"},
                {"type": "text", "x": 90, "y": 100, "fontSize": 7, "binding": "parent_id", "defaultValue": "SHEET-P-001"},
                {"type": "text", "x": 8, "y": 130, "fontSize": 7, "binding": "manufacture_date", "defaultValue": "2026-07-09"},
                {"type": "qr", "x": 270, "y": 30, "magnification": 3, "binding": "serial_number", "defaultValue": "SHEET-C-001"}
            ]
        }
    },
    {
        "template_code": "LBL-WIP-60x40",
        "name": "Semi-Finished Product (WIP) Label",
        "description": "MES and operation tracking for work-in-progress items. 60×40mm with QR.",
        "category": "WIP",
        "dpi": 203,
        "label_width": 60.0,
        "label_height": 40.0,
        "orientation": "LANDSCAPE",
        "revision": "A",
        "supported_barcode_types": json.dumps(["QR"]),
        "supported_printer_models": json.dumps(["GK420t", "ZD420", "ZT230"]),
        "compatible_station_types": json.dumps(["PRINT_STATION", "MARK_STATION", "WIP_STATION"]),
        "is_default": False,
        "template_json": {
            "width": 60, "height": 40, "dpi": 203,
            "elements": [
                {"type": "text", "x": 8, "y": 10, "fontSize": 11, "text": "WIP"},
                {"type": "line", "x": 5, "y": 40, "width": 470, "height": 2},
                {"type": "text", "x": 8, "y": 55, "fontSize": 9, "text": "Serial:"},
                {"type": "text", "x": 95, "y": 55, "fontSize": 10, "binding": "serial_number", "defaultValue": "SN-000001"},
                {"type": "text", "x": 8, "y": 90, "fontSize": 9, "text": "Product:"},
                {"type": "text", "x": 95, "y": 90, "fontSize": 9, "binding": "product_code", "defaultValue": "BEARING-SEAL-01"},
                {"type": "text", "x": 8, "y": 125, "fontSize": 9, "text": "Op:"},
                {"type": "text", "x": 65, "y": 125, "fontSize": 9, "binding": "operation", "defaultValue": "LASER_MARK"},
                {"type": "text", "x": 8, "y": 160, "fontSize": 8, "text": "Station:"},
                {"type": "text", "x": 95, "y": 160, "fontSize": 8, "binding": "station", "defaultValue": "STATION-01"},
                {"type": "text", "x": 8, "y": 190, "fontSize": 7, "binding": "production_date", "defaultValue": "2026-07-09"},
                {
                    "type": "qr", "x": 500, "y": 25, "magnification": 5,
                    "payloadTemplate": '{"sn":"{serial_number}","op":"{operation}","prod":"{product_code}"}'
                }
            ]
        }
    },
    {
        "template_code": "LBL-ISSUE-100x60",
        "name": "Material Issue Label",
        "description": "Warehouse to MES material issuance tracking. 100×60mm with QR and Code128.",
        "category": "ISSUE",
        "dpi": 203,
        "label_width": 100.0,
        "label_height": 60.0,
        "orientation": "LANDSCAPE",
        "revision": "A",
        "supported_barcode_types": json.dumps(["CODE128", "QR"]),
        "supported_printer_models": json.dumps(["GK420t", "ZT230", "ZT410"]),
        "compatible_station_types": json.dumps(["WAREHOUSE", "MATERIAL_STATION"]),
        "is_default": False,
        "template_json": {
            "width": 100, "height": 60, "dpi": 203,
            "elements": [
                {"type": "text", "x": 15, "y": 15, "fontSize": 13, "text": "MATERIAL ISSUE"},
                {"type": "line", "x": 5, "y": 55, "width": 790, "height": 2},
                {"type": "text", "x": 15, "y": 70, "fontSize": 9, "text": "Material:"},
                {"type": "text", "x": 130, "y": 70, "fontSize": 11, "binding": "material", "defaultValue": "NBR-70 Rubber"},
                {"type": "text", "x": 15, "y": 110, "fontSize": 9, "text": "Issue No:"},
                {"type": "text", "x": 130, "y": 110, "fontSize": 10, "binding": "serial_number", "defaultValue": "ISSUE-001"},
                {"type": "text", "x": 15, "y": 150, "fontSize": 9, "text": "From:"},
                {"type": "text", "x": 100, "y": 150, "fontSize": 9, "binding": "source_location", "defaultValue": "WAREHOUSE-A"},
                {"type": "text", "x": 15, "y": 185, "fontSize": 9, "text": "To:"},
                {"type": "text", "x": 60, "y": 185, "fontSize": 9, "binding": "destination", "defaultValue": "PRODUCTION-01"},
                {"type": "text", "x": 15, "y": 220, "fontSize": 9, "text": "Qty:"},
                {"type": "text", "x": 75, "y": 220, "fontSize": 11, "binding": "quantity", "defaultValue": "50"},
                {"type": "text", "x": 200, "y": 220, "fontSize": 8, "binding": "manufacture_date", "defaultValue": "2026-07-09"},
                {"type": "barcode", "x": 15, "y": 260, "height": 80, "symbology": "CODE128", "barWidth": 2,
                 "binding": "serial_number", "defaultValue": "ISSUE-001"},
                {
                    "type": "qr", "x": 620, "y": 60, "magnification": 5,
                    "payloadTemplate": '{"issue":"{serial_number}","mat":"{material}","qty":"{quantity}"}'
                }
            ]
        }
    },
]


# ── Database migration + injection ─────────────────────────────────────────────

def migrate_schema(cursor):
    """Ensure label_templates table exists and has all required columns."""

    # Create table if not exists (base schema)
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
        is_active INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'published',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        updated_by TEXT,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    """)

    # Create version history table
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

    # Create printer template assignments table
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

    # Add new metadata columns (idempotent via try/except)
    new_columns = [
        ("template_code", "TEXT"),
        ("category",      "TEXT"),
        ("orientation",   "TEXT NOT NULL DEFAULT 'PORTRAIT'"),
        ("revision",      "TEXT NOT NULL DEFAULT 'A'"),
        ("supported_barcode_types",    "TEXT"),
        ("supported_printer_models",   "TEXT"),
        ("compatible_station_types",   "TEXT"),
    ]
    for col, col_type in new_columns:
        try:
            cursor.execute(f"ALTER TABLE label_templates ADD COLUMN {col} {col_type};")
            print(f"  ✚ Added column '{col}'")
        except Exception:
            pass  # Column already exists

    # Create unique index on template_code (nullable-safe)
    try:
        cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_label_templates_template_code
            ON label_templates (template_code)
            WHERE template_code IS NOT NULL;
        """)
    except Exception:
        pass


def inject_templates(cursor, templates):
    """Insert or update each template. Keyed on template_code."""
    now = datetime.utcnow().isoformat() + "Z"
    inserted = 0
    updated = 0

    for t in templates:
        json_str = json.dumps(t["template_json"])
        code = t["template_code"]
        is_default = 1 if t.get("is_default") else 0

        # Check existing by template_code
        cursor.execute("SELECT id, version, template_json FROM label_templates WHERE template_code = ?;", (code,))
        row = cursor.fetchone()

        if row:
            # Update existing — snapshot old version first
            existing_id, current_version, old_json = row
            new_version = current_version + 1

            # Snapshot
            cursor.execute("""
            INSERT INTO label_template_versions (id, template_id, version, template_json, created_by, created_at)
            VALUES (?, ?, ?, ?, 'system', ?);
            """, (str(uuid.uuid4()), existing_id, current_version, old_json, now))

            # Clear is_default on all others if this one is being set as default
            if is_default:
                cursor.execute("UPDATE label_templates SET is_default = 0;")

            cursor.execute("""
            UPDATE label_templates SET
                name = ?, description = ?, category = ?, orientation = ?, revision = ?,
                supported_barcode_types = ?, supported_printer_models = ?, compatible_station_types = ?,
                dpi = ?, label_width = ?, label_height = ?,
                template_json = ?, version = ?, is_default = ?,
                status = 'published', is_active = 1,
                updated_by = 'system', updated_at = ?
            WHERE template_code = ?;
            """, (
                t["name"], t["description"], t["category"], t["orientation"], t["revision"],
                t["supported_barcode_types"], t["supported_printer_models"], t["compatible_station_types"],
                t["dpi"], t["label_width"], t["label_height"],
                json_str, new_version, is_default, now,
                code
            ))
            print(f"  ↻ Updated  [{code}] '{t['name']}' → v{new_version}")
            updated += 1

        else:
            # Insert new
            new_id = str(uuid.uuid4())

            if is_default:
                cursor.execute("UPDATE label_templates SET is_default = 0;")

            cursor.execute("""
            INSERT INTO label_templates (
                id, name, description, template_code, category,
                dpi, label_width, label_height, orientation, revision,
                supported_barcode_types, supported_printer_models, compatible_station_types,
                template_json, version, is_active, status, is_default,
                created_by, updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'published', ?, 'system', 'system', ?, ?);
            """, (
                new_id, t["name"], t["description"], code, t["category"],
                t["dpi"], t["label_width"], t["label_height"], t["orientation"], t["revision"],
                t["supported_barcode_types"], t["supported_printer_models"], t["compatible_station_types"],
                json_str, is_default,
                now, now
            ))
            print(f"  ✚ Inserted [{code}] '{t['name']}' (is_default={bool(is_default)})")
            inserted += 1

    return inserted, updated


def process_database_local(db_path):
    """Run injection directly against a local SQLite file."""
    print(f"\n{chr(8212)*60}")
    print(f"Database: {db_path}")
    if not os.path.exists(db_path):
        print(f"  warning  File not found -- skipping.")
        return False
    if not os.access(db_path, os.W_OK):
        print(f"  error  No write permission (owned by Docker container user).")
        return False
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        print("  Migrating schema...")
        migrate_schema(cursor)
        print("  Injecting templates...")
        inserted, updated = inject_templates(cursor, TEMPLATES)
        conn.commit()
        conn.close()
        conn2 = sqlite3.connect(db_path)
        row = conn2.execute(
            "SELECT COUNT(*), SUM(is_default) FROM label_templates WHERE status='published' AND is_active=1;"
        ).fetchone()
        conn2.close()
        total, defaults = row[0], (row[1] or 0)
        print(f"\n  ok Done -- {inserted} inserted, {updated} updated")
        print(f"  ok Total published templates in DB: {total}  (default: {defaults})")
        return True
    except sqlite3.OperationalError as e:
        print(f"  error  SQLite error: {e}")
        return False


def find_printer_adapter_container():
    """Return the running printer-adapter container name, or None."""
    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}\t{{.Image}}"],
            capture_output=True, text=True, timeout=10
        )
        for line in result.stdout.strip().splitlines():
            parts = line.split("\t")
            name  = parts[0].lower()
            image = parts[1].lower() if len(parts) > 1 else ""
            if "printer" in name and "adapter" in name:
                return parts[0]
            if "printer" in image and "adapter" in image:
                return parts[0]
    except Exception as e:
        print(f"  warning  docker ps error: {e}")
    return None


def process_database_docker(container):
    """Copy this script into the container and run it in --local mode."""
    script_path  = os.path.abspath(__file__)
    container_script = "/tmp/inject_template_run.py"
    container_db     = "/app/data/printer.db"

    print(f"\n{chr(8212)*60}")
    print(f"Container: {container}  ->  {container_db}")

    cp = subprocess.run(
        ["docker", "cp", script_path, f"{container}:{container_script}"],
        capture_output=True, text=True
    )
    if cp.returncode != 0:
        print(f"  error  docker cp failed: {cp.stderr.strip()}")
        return False

    result = subprocess.run(
        ["docker", "exec", container,
         "python3", container_script, "--local", "--single-db", container_db],
        capture_output=True, text=True
    )
    for line in (result.stdout + result.stderr).strip().splitlines():
        print(f"  {line}")

    if result.returncode != 0:
        print(f"  error  Container execution failed (exit {result.returncode})")
        return False
    return True


# -- Entry point ----------------------------------------------------------------

if __name__ == "__main__":
    args = sys.argv[1:]
    force_docker = "--docker"  in args
    force_local  = "--local"   in args
    dry_run      = "--dry-run" in args

    # --single-db used internally when exec'd inside Docker
    single_db = None
    if "--single-db" in args:
        idx = args.index("--single-db")
        single_db = args[idx + 1] if idx + 1 < len(args) else None

    print(f"Label Template Injector -- {len(TEMPLATES)} templates")

    if dry_run:
        print("\n[DRY RUN] Templates that would be injected:")
        for t in TEMPLATES:
            flag = "  DEFAULT" if t.get("is_default") else ""
            print(f"  [{t['template_code']}] {t['name']}  "
                  f"{t['label_width']}x{t['label_height']}mm  {t['category']}{flag}")
        sys.exit(0)

    if single_db:
        ok = process_database_local(single_db)
        sys.exit(0 if ok else 1)

    if force_docker:
        container = find_printer_adapter_container()
        if not container:
            print("\n  error  No printer-adapter container found.")
            print("     Is it running?  Try: docker ps | grep printer")
            sys.exit(1)
        ok = process_database_docker(container)
        sys.exit(0 if ok else 1)

    # Auto-detect: try local first, fall back to Docker
    any_success = False
    for db_path in DB_PATHS:
        ok = process_database_local(db_path)
        if ok:
            any_success = True
        elif not any_success:
            print(f"\n  -> Local write failed. Trying Docker exec...")
            container = find_printer_adapter_container()
            if container:
                ok2 = process_database_docker(container)
                if ok2:
                    any_success = True
                    break
            else:
                print(f"  warning  No printer-adapter container running.")
                print(f"     Start the stack first, then re-run.")

    print(f"\n{chr(8212)*60}")
    if any_success:
        print("ok  Injection complete.")
    else:
        print("error  No databases were updated.\n")
        print("  Hints:")
        print("   Services running in Docker?  ->  python inject_template.py --docker")
        print("   Preview only?               ->  python inject_template.py --dry-run")
        sys.exit(1)
