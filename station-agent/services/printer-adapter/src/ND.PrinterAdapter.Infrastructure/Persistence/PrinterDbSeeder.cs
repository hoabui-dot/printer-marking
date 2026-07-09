using Microsoft.EntityFrameworkCore;
using ND.PrinterAdapter.Domain.Entities;

namespace ND.PrinterAdapter.Infrastructure.Persistence;

public static class PrinterDbSeeder
{
    public static async Task SeedAsync(PrinterDbContext db, string host, int port)
    {
        // ── Printers ─────────────────────────────────────────────────────────
        if (!await db.Printers.AnyAsync())
        {
            var p1 = Printer.Create("Printer-01", "Zebra Industrial A", "localhost", 9100, "ZPL", "ZEBRA", driverType: "simulation");
            p1.SetOnline();
            await db.Printers.AddAsync(p1);

            var p2 = Printer.Create("Printer-02", "Zebra Industrial B", "localhost", 9101, "ZPL", "ZEBRA", driverType: "simulation");
            p2.SetOnline();
            await db.Printers.AddAsync(p2);

            var p3 = Printer.Create("Printer-03", "Zebra Desktop C", "localhost", 9102, "ZPL", "ZEBRA", driverType: "simulation");
            p3.SetOnline();
            await db.Printers.AddAsync(p3);

            var pLegacy = Printer.Create("printer-01", "Zebra Kiosk Printer (Legacy)", "localhost", 9100, "ZPL", "ZEBRA", driverType: "simulation");
            pLegacy.SetOnline();
            await db.Printers.AddAsync(pLegacy);

            var cupsQueue = Environment.GetEnvironmentVariable("CUPS_QUEUE") ?? "Zebra_Technologies_ZTC_GK420t";
            var pCups = Printer.Create("Zebra-GK420t-CUPS", "Zebra GK420t (Physical)", "localhost", 631, "ZPL", "ZEBRA",
                driverType: "cups", cupsQueueName: cupsQueue);
            await db.Printers.AddAsync(pCups);

            await db.SaveChangesAsync();
        }
        else
        {
            var cupsCode = "Zebra-GK420t-CUPS";
            if (!await db.Printers.AnyAsync(p => p.PrinterCode == cupsCode))
            {
                var cupsQueue = Environment.GetEnvironmentVariable("CUPS_QUEUE") ?? "Zebra_Technologies_ZTC_GK420t";
                var pCups = Printer.Create(cupsCode, "Zebra GK420t (Physical)", "localhost", 631, "ZPL", "ZEBRA",
                    driverType: "cups", cupsQueueName: cupsQueue);
                await db.Printers.AddAsync(pCups);
                await db.SaveChangesAsync();
            }
        }

        // ── Industrial Label Templates ────────────────────────────────────────
        // Idempotent: check by TemplateCode before inserting.
        await SeedTemplatesAsync(db);
    }

    private static async Task SeedTemplatesAsync(PrinterDbContext db)
    {
        var definitions = GetIndustrialTemplateDefinitions();

        foreach (var def in definitions)
        {
            // Idempotent: skip if already exists by templateCode
            var exists = await db.LabelTemplates.AnyAsync(t => t.TemplateCode == def.Code);
            if (exists) continue;

            var tmpl = LabelTemplate.Create(
                name: def.Name,
                description: def.Description,
                dpi: def.Dpi,
                labelWidth: def.WidthMm,
                labelHeight: def.HeightMm,
                templateJson: def.TemplateJson,
                status: "published",
                createdBy: "system",
                templateCode: def.Code,
                category: def.Category,
                orientation: def.Orientation,
                revision: "A",
                supportedBarcodeTypes: def.BarcodeTypes,
                supportedPrinterModels: def.PrinterModels,
                compatibleStationTypes: def.StationTypes
            );

            if (def.IsDefault)
                tmpl.SetAsDefault();

            await db.LabelTemplates.AddAsync(tmpl);
        }

        await db.SaveChangesAsync();
    }

    // ── Template Definitions ─────────────────────────────────────────────────

    private record TemplateDefinition(
        string Code, string Name, string Description, string Category,
        int Dpi, double WidthMm, double HeightMm, string Orientation,
        string BarcodeTypes, string PrinterModels, string StationTypes,
        string TemplateJson, bool IsDefault = false);

    private static IReadOnlyList<TemplateDefinition> GetIndustrialTemplateDefinitions()
    {
        return new List<TemplateDefinition>
        {
            // ── 1. Product QR Label (DEFAULT) — 50×30mm ───────────────────────
            new(
                Code: "LBL-PRODUCT-50x30",
                Name: "Industrial Product QR Label",
                Description: "Won Seal Tech Co., Ltd. — 50×30mm standard product label with QR code and serial number.",
                Category: "PRODUCT",
                Dpi: 203, WidthMm: 50, HeightMm: 30, Orientation: "LANDSCAPE",
                BarcodeTypes: "[\"QR\"]",
                PrinterModels: "[\"GK420t\",\"ZT230\",\"ZT410\"]",
                StationTypes: "[\"PRINT_STATION\",\"MARK_STATION\"]",
                IsDefault: true,
                TemplateJson: """
                {
                  "width": 50, "height": 30, "dpi": 203,
                  "elements": [
                    { "type": "text", "x": 10, "y": 15, "fontSize": 11, "text": "WON SEAL TECH CO., LTD." },
                    { "type": "text", "x": 10, "y": 50, "fontSize": 10, "binding": "product_name", "defaultValue": "Bearing Seal" },
                    { "type": "text", "x": 10, "y": 85, "fontSize": 8, "text": "Product:" },
                    { "type": "text", "x": 90, "y": 85, "fontSize": 9, "binding": "product_code", "defaultValue": "BEARING-SEAL-01" },
                    { "type": "text", "x": 10, "y": 115, "fontSize": 8, "text": "Serial:" },
                    { "type": "text", "x": 90, "y": 115, "fontSize": 9, "binding": "serial_number", "defaultValue": "SN-000001" },
                    { "type": "text", "x": 10, "y": 145, "fontSize": 7, "binding": "batch_number", "defaultValue": "BATCH-01" },
                    { "type": "text", "x": 150, "y": 145, "fontSize": 7, "text": "Rev:" },
                    { "type": "text", "x": 185, "y": 145, "fontSize": 7, "binding": "revision", "defaultValue": "A" },
                    { "type": "text", "x": 10, "y": 170, "fontSize": 7, "binding": "production_date", "defaultValue": "2026-07-09" },
                    {
                      "type": "qr", "x": 280, "y": 50, "magnification": 4,
                      "payloadTemplate": "{\"sn\":\"{serial_number}\",\"prod\":\"{product_code}\",\"rev\":\"{revision}\",\"batch\":\"{batch_number}\"}"
                    }
                  ]
                }
                """),

            // ── 2. Shelf/Rack/Storage Label — 50×30mm ────────────────────────
            new(
                Code: "LBL-SHELF-50x30",
                Name: "Shelf / Rack Location Label",
                Description: "Warehouse location identification. 50×30mm with QR and Code128.",
                Category: "SHELF",
                Dpi: 203, WidthMm: 50, HeightMm: 30, Orientation: "LANDSCAPE",
                BarcodeTypes: "[\"CODE128\",\"QR\"]",
                PrinterModels: "[\"GK420t\",\"ZD420\",\"ZT230\"]",
                StationTypes: "[\"WAREHOUSE\",\"PRINT_STATION\"]",
                TemplateJson: """
                {
                  "width": 50, "height": 30, "dpi": 203,
                  "elements": [
                    { "type": "text", "x": 10, "y": 12, "fontSize": 9, "text": "LOCATION" },
                    { "type": "text", "x": 10, "y": 45, "fontSize": 18, "binding": "location_code", "defaultValue": "A-01-03" },
                    { "type": "text", "x": 10, "y": 100, "fontSize": 7, "binding": "zone", "defaultValue": "Zone A - Row 1" },
                    { "type": "barcode", "x": 10, "y": 125, "height": 50, "symbology": "CODE128", "barWidth": 2, "binding": "location_code", "defaultValue": "A-01-03" },
                    { "type": "qr", "x": 300, "y": 30, "magnification": 3, "binding": "location_code", "defaultValue": "A-01-03" }
                  ]
                }
                """),

            // ── 3. Inspection/Supervisor Label — 100×60mm ─────────────────────
            new(
                Code: "LBL-INSP-100x60",
                Name: "Inspection / Supervisor Label",
                Description: "QC inspection records, supervisor sign-off. 100×60mm, Code128.",
                Category: "INSPECTION",
                Dpi: 203, WidthMm: 100, HeightMm: 60, Orientation: "LANDSCAPE",
                BarcodeTypes: "[\"CODE128\"]",
                PrinterModels: "[\"GK420t\",\"ZT230\",\"ZT410\"]",
                StationTypes: "[\"QC_STATION\",\"PRINT_STATION\"]",
                TemplateJson: """
                {
                  "width": 100, "height": 60, "dpi": 203,
                  "elements": [
                    { "type": "rect", "x": 5, "y": 5, "width": 790, "height": 470, "strokeWidth": 3 },
                    { "type": "text", "x": 15, "y": 20, "fontSize": 16, "text": "INSPECTION RECORD" },
                    { "type": "line", "x": 5, "y": 65, "width": 790, "height": 2 },
                    { "type": "text", "x": 15, "y": 80, "fontSize": 9, "text": "Job No:" },
                    { "type": "text", "x": 120, "y": 80, "fontSize": 10, "binding": "production_order", "defaultValue": "PO-2026-001" },
                    { "type": "text", "x": 15, "y": 120, "fontSize": 9, "text": "Product:" },
                    { "type": "text", "x": 120, "y": 120, "fontSize": 10, "binding": "product_code", "defaultValue": "BEARING-SEAL-01" },
                    { "type": "text", "x": 15, "y": 160, "fontSize": 9, "text": "Serial:" },
                    { "type": "text", "x": 120, "y": 160, "fontSize": 10, "binding": "serial_number", "defaultValue": "SN-000001" },
                    { "type": "text", "x": 15, "y": 200, "fontSize": 9, "text": "Inspector:" },
                    { "type": "text", "x": 120, "y": 200, "fontSize": 10, "binding": "operator", "defaultValue": "Inspector A" },
                    { "type": "text", "x": 15, "y": 240, "fontSize": 9, "text": "Date:" },
                    { "type": "text", "x": 120, "y": 240, "fontSize": 9, "binding": "production_date", "defaultValue": "2026-07-09" },
                    { "type": "text", "x": 15, "y": 280, "fontSize": 9, "text": "Result:" },
                    { "type": "text", "x": 120, "y": 280, "fontSize": 14, "binding": "inspection_result", "defaultValue": "PASS" },
                    { "type": "barcode", "x": 15, "y": 320, "height": 80, "symbology": "CODE128", "barWidth": 2, "binding": "serial_number", "defaultValue": "SN-000001" }
                  ]
                }
                """),

            // ── 4. Roll/Material Reel Label — 100×80mm ───────────────────────
            new(
                Code: "LBL-ROLL-100x80",
                Name: "Roll / Material Reel Label",
                Description: "Rubber rolls and raw material reels. 100×80mm with large Code128.",
                Category: "MATERIAL",
                Dpi: 203, WidthMm: 100, HeightMm: 80, Orientation: "PORTRAIT",
                BarcodeTypes: "[\"CODE128\"]",
                PrinterModels: "[\"ZT230\",\"ZT410\",\"ZT610\"]",
                StationTypes: "[\"WAREHOUSE\",\"MATERIAL_STATION\"]",
                TemplateJson: """
                {
                  "width": 100, "height": 80, "dpi": 203,
                  "elements": [
                    { "type": "text", "x": 15, "y": 15, "fontSize": 13, "text": "MATERIAL REEL" },
                    { "type": "line", "x": 5, "y": 55, "width": 790, "height": 2 },
                    { "type": "text", "x": 15, "y": 70, "fontSize": 9, "text": "Material:" },
                    { "type": "text", "x": 130, "y": 70, "fontSize": 11, "binding": "material", "defaultValue": "NBR-70 Rubber" },
                    { "type": "text", "x": 15, "y": 110, "fontSize": 9, "text": "Lot No:" },
                    { "type": "text", "x": 130, "y": 110, "fontSize": 11, "binding": "lot_number", "defaultValue": "LOT-2026-07-A" },
                    { "type": "text", "x": 15, "y": 150, "fontSize": 9, "text": "Roll ID:" },
                    { "type": "text", "x": 130, "y": 150, "fontSize": 11, "binding": "serial_number", "defaultValue": "ROLL-001" },
                    { "type": "text", "x": 15, "y": 190, "fontSize": 9, "text": "Weight (kg):" },
                    { "type": "text", "x": 200, "y": 190, "fontSize": 11, "binding": "weight", "defaultValue": "25.0" },
                    { "type": "text", "x": 15, "y": 230, "fontSize": 9, "text": "MFG Date:" },
                    { "type": "text", "x": 130, "y": 230, "fontSize": 9, "binding": "manufacture_date", "defaultValue": "2026-07-09" },
                    { "type": "barcode", "x": 15, "y": 280, "height": 130, "symbology": "CODE128", "barWidth": 3,
                      "binding": "serial_number", "defaultValue": "ROLL-001" },
                    { "type": "text", "x": 15, "y": 420, "fontSize": 7, "binding": "lot_number", "defaultValue": "LOT-2026-07-A" }
                  ]
                }
                """),

            // ── 5. Pallet Label — 100×150mm ──────────────────────────────────
            new(
                Code: "LBL-PALLET-100x150",
                Name: "Pallet Label",
                Description: "Shipping, warehouse and forklift scanning pallet label. 100×150mm with large QR and Code128.",
                Category: "PALLET",
                Dpi: 203, WidthMm: 100, HeightMm: 150, Orientation: "PORTRAIT",
                BarcodeTypes: "[\"CODE128\",\"QR\"]",
                PrinterModels: "[\"ZT410\",\"ZT610\",\"ZT620\"]",
                StationTypes: "[\"WAREHOUSE\",\"SHIPPING_STATION\"]",
                TemplateJson: """
                {
                  "width": 100, "height": 150, "dpi": 203,
                  "elements": [
                    { "type": "rect", "x": 5, "y": 5, "width": 790, "height": 1190, "strokeWidth": 4 },
                    { "type": "text", "x": 20, "y": 20, "fontSize": 18, "text": "PALLET" },
                    { "type": "line", "x": 5, "y": 75, "width": 790, "height": 3 },
                    { "type": "qr", "x": 30, "y": 90, "magnification": 8,
                      "payloadTemplate": "{\"pallet\":\"{serial_number}\",\"po\":\"{production_order}\",\"prod\":\"{product_code}\"}" },
                    { "type": "text", "x": 430, "y": 90, "fontSize": 8, "text": "Order:" },
                    { "type": "text", "x": 430, "y": 120, "fontSize": 11, "binding": "production_order", "defaultValue": "PO-2026-001" },
                    { "type": "text", "x": 430, "y": 160, "fontSize": 8, "text": "Product:" },
                    { "type": "text", "x": 430, "y": 190, "fontSize": 10, "binding": "product_code", "defaultValue": "BEARING-SEAL-01" },
                    { "type": "text", "x": 430, "y": 230, "fontSize": 8, "text": "Pallet ID:" },
                    { "type": "text", "x": 430, "y": 260, "fontSize": 10, "binding": "serial_number", "defaultValue": "PLT-001" },
                    { "type": "text", "x": 430, "y": 300, "fontSize": 8, "text": "Qty:" },
                    { "type": "text", "x": 430, "y": 330, "fontSize": 14, "binding": "quantity", "defaultValue": "100" },
                    { "type": "text", "x": 430, "y": 380, "fontSize": 8, "text": "Destination:" },
                    { "type": "text", "x": 430, "y": 410, "fontSize": 9, "binding": "destination", "defaultValue": "WAREHOUSE A" },
                    { "type": "line", "x": 5, "y": 490, "width": 790, "height": 3 },
                    { "type": "text", "x": 20, "y": 510, "fontSize": 8, "text": "Shipper:" },
                    { "type": "text", "x": 130, "y": 510, "fontSize": 9, "binding": "customer", "defaultValue": "Won Seal Tech" },
                    { "type": "text", "x": 20, "y": 550, "fontSize": 8, "text": "Date:" },
                    { "type": "text", "x": 130, "y": 550, "fontSize": 9, "binding": "manufacture_date", "defaultValue": "2026-07-09" },
                    { "type": "barcode", "x": 20, "y": 600, "height": 150, "symbology": "CODE128", "barWidth": 4,
                      "binding": "serial_number", "defaultValue": "PLT-001" },
                    { "type": "text", "x": 20, "y": 760, "fontSize": 7, "binding": "serial_number", "defaultValue": "PLT-001" }
                  ]
                }
                """),

            // ── 6. Parent Rubber Sheet Label — 80×50mm ────────────────────────
            new(
                Code: "LBL-SHEET-P-80x50",
                Name: "Parent Rubber Sheet Label",
                Description: "Parent sheet identification for rubber sheet tracking. 80×50mm with QR.",
                Category: "SHEET",
                Dpi: 203, WidthMm: 80, HeightMm: 50, Orientation: "LANDSCAPE",
                BarcodeTypes: "[\"QR\"]",
                PrinterModels: "[\"GK420t\",\"ZT230\"]",
                StationTypes: "[\"MATERIAL_STATION\",\"PRINT_STATION\"]",
                TemplateJson: """
                {
                  "width": 80, "height": 50, "dpi": 203,
                  "elements": [
                    { "type": "text", "x": 10, "y": 12, "fontSize": 11, "text": "PARENT SHEET" },
                    { "type": "line", "x": 5, "y": 45, "width": 530, "height": 2 },
                    { "type": "text", "x": 10, "y": 60, "fontSize": 9, "text": "Sheet ID:" },
                    { "type": "text", "x": 120, "y": 60, "fontSize": 11, "binding": "serial_number", "defaultValue": "SHEET-P-001" },
                    { "type": "text", "x": 10, "y": 100, "fontSize": 9, "text": "Material:" },
                    { "type": "text", "x": 120, "y": 100, "fontSize": 10, "binding": "material", "defaultValue": "NBR-70" },
                    { "type": "text", "x": 10, "y": 140, "fontSize": 9, "text": "Lot:" },
                    { "type": "text", "x": 80, "y": 140, "fontSize": 9, "binding": "lot_number", "defaultValue": "LOT-2026-07-A" },
                    { "type": "text", "x": 10, "y": 180, "fontSize": 9, "text": "Size:" },
                    { "type": "text", "x": 80, "y": 180, "fontSize": 9, "binding": "sheet_size", "defaultValue": "1200x600mm" },
                    { "type": "text", "x": 10, "y": 220, "fontSize": 8, "binding": "manufacture_date", "defaultValue": "2026-07-09" },
                    {
                      "type": "qr", "x": 570, "y": 40, "magnification": 6,
                      "payloadTemplate": "{\"sheet\":\"{serial_number}\",\"lot\":\"{lot_number}\",\"mat\":\"{material}\"}"
                    }
                  ]
                }
                """),

            // ── 7. Child Rubber Sheet Label — 50×30mm ────────────────────────
            new(
                Code: "LBL-SHEET-C-50x30",
                Name: "Child Rubber Sheet Label",
                Description: "Individual child sheet tracking cut from parent. 50×30mm compact QR.",
                Category: "SHEET",
                Dpi: 203, WidthMm: 50, HeightMm: 30, Orientation: "LANDSCAPE",
                BarcodeTypes: "[\"QR\"]",
                PrinterModels: "[\"GK420t\",\"ZD420\"]",
                StationTypes: "[\"MATERIAL_STATION\",\"PRINT_STATION\"]",
                TemplateJson: """
                {
                  "width": 50, "height": 30, "dpi": 203,
                  "elements": [
                    { "type": "text", "x": 8, "y": 10, "fontSize": 9, "text": "CHILD SHEET" },
                    { "type": "text", "x": 8, "y": 40, "fontSize": 8, "binding": "serial_number", "defaultValue": "SHEET-C-001" },
                    { "type": "text", "x": 8, "y": 70, "fontSize": 7, "binding": "lot_number", "defaultValue": "LOT-2026-07-A" },
                    { "type": "text", "x": 8, "y": 100, "fontSize": 7, "text": "Parent:" },
                    { "type": "text", "x": 90, "y": 100, "fontSize": 7, "binding": "parent_id", "defaultValue": "SHEET-P-001" },
                    { "type": "text", "x": 8, "y": 130, "fontSize": 7, "binding": "manufacture_date", "defaultValue": "2026-07-09" },
                    { "type": "qr", "x": 270, "y": 30, "magnification": 3, "binding": "serial_number", "defaultValue": "SHEET-C-001" }
                  ]
                }
                """),

            // ── 8. Semi-Finished WIP Label — 60×40mm ─────────────────────────
            new(
                Code: "LBL-WIP-60x40",
                Name: "Semi-Finished Product (WIP) Label",
                Description: "MES and operation tracking for work-in-progress items. 60×40mm with QR.",
                Category: "WIP",
                Dpi: 203, WidthMm: 60, HeightMm: 40, Orientation: "LANDSCAPE",
                BarcodeTypes: "[\"QR\"]",
                PrinterModels: "[\"GK420t\",\"ZD420\",\"ZT230\"]",
                StationTypes: "[\"PRINT_STATION\",\"MARK_STATION\",\"WIP_STATION\"]",
                TemplateJson: """
                {
                  "width": 60, "height": 40, "dpi": 203,
                  "elements": [
                    { "type": "text", "x": 8, "y": 10, "fontSize": 11, "text": "WIP" },
                    { "type": "line", "x": 5, "y": 40, "width": 470, "height": 2 },
                    { "type": "text", "x": 8, "y": 55, "fontSize": 9, "text": "Serial:" },
                    { "type": "text", "x": 95, "y": 55, "fontSize": 10, "binding": "serial_number", "defaultValue": "SN-000001" },
                    { "type": "text", "x": 8, "y": 90, "fontSize": 9, "text": "Product:" },
                    { "type": "text", "x": 95, "y": 90, "fontSize": 9, "binding": "product_code", "defaultValue": "BEARING-SEAL-01" },
                    { "type": "text", "x": 8, "y": 125, "fontSize": 9, "text": "Op:" },
                    { "type": "text", "x": 65, "y": 125, "fontSize": 9, "binding": "operation", "defaultValue": "LASER_MARK" },
                    { "type": "text", "x": 8, "y": 160, "fontSize": 8, "text": "Station:" },
                    { "type": "text", "x": 95, "y": 160, "fontSize": 8, "binding": "station", "defaultValue": "STATION-01" },
                    { "type": "text", "x": 8, "y": 190, "fontSize": 7, "binding": "production_date", "defaultValue": "2026-07-09" },
                    {
                      "type": "qr", "x": 500, "y": 25, "magnification": 5,
                      "payloadTemplate": "{\"sn\":\"{serial_number}\",\"op\":\"{operation}\",\"prod\":\"{product_code}\"}"
                    }
                  ]
                }
                """),

            // ── 9. Material Issue Label — 100×60mm ────────────────────────────
            new(
                Code: "LBL-ISSUE-100x60",
                Name: "Material Issue Label",
                Description: "Warehouse to MES material issuance tracking. 100×60mm with QR and Code128.",
                Category: "ISSUE",
                Dpi: 203, WidthMm: 100, HeightMm: 60, Orientation: "LANDSCAPE",
                BarcodeTypes: "[\"CODE128\",\"QR\"]",
                PrinterModels: "[\"GK420t\",\"ZT230\",\"ZT410\"]",
                StationTypes: "[\"WAREHOUSE\",\"MATERIAL_STATION\"]",
                TemplateJson: """
                {
                  "width": 100, "height": 60, "dpi": 203,
                  "elements": [
                    { "type": "text", "x": 15, "y": 15, "fontSize": 13, "text": "MATERIAL ISSUE" },
                    { "type": "line", "x": 5, "y": 55, "width": 790, "height": 2 },
                    { "type": "text", "x": 15, "y": 70, "fontSize": 9, "text": "Material:" },
                    { "type": "text", "x": 130, "y": 70, "fontSize": 11, "binding": "material", "defaultValue": "NBR-70 Rubber" },
                    { "type": "text", "x": 15, "y": 110, "fontSize": 9, "text": "Issue No:" },
                    { "type": "text", "x": 130, "y": 110, "fontSize": 10, "binding": "serial_number", "defaultValue": "ISSUE-001" },
                    { "type": "text", "x": 15, "y": 150, "fontSize": 9, "text": "From:" },
                    { "type": "text", "x": 100, "y": 150, "fontSize": 9, "binding": "source_location", "defaultValue": "WAREHOUSE-A" },
                    { "type": "text", "x": 15, "y": 185, "fontSize": 9, "text": "To:" },
                    { "type": "text", "x": 60, "y": 185, "fontSize": 9, "binding": "destination", "defaultValue": "PRODUCTION-01" },
                    { "type": "text", "x": 15, "y": 220, "fontSize": 9, "text": "Qty:" },
                    { "type": "text", "x": 75, "y": 220, "fontSize": 11, "binding": "quantity", "defaultValue": "50" },
                    { "type": "text", "x": 200, "y": 220, "fontSize": 8, "binding": "manufacture_date", "defaultValue": "2026-07-09" },
                    { "type": "barcode", "x": 15, "y": 260, "height": 80, "symbology": "CODE128", "barWidth": 2,
                      "binding": "serial_number", "defaultValue": "ISSUE-001" },
                    {
                      "type": "qr", "x": 620, "y": 60, "magnification": 5,
                      "payloadTemplate": "{\"issue\":\"{serial_number}\",\"mat\":\"{material}\",\"qty\":\"{quantity}\"}"
                    }
                  ]
                }
                """)
        };
    }
}
