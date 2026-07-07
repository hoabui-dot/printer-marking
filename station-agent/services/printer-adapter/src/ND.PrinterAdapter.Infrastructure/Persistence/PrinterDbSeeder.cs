using Microsoft.EntityFrameworkCore;
using ND.PrinterAdapter.Domain.Entities;

namespace ND.PrinterAdapter.Infrastructure.Persistence;

public static class PrinterDbSeeder
{
    public static async Task SeedAsync(PrinterDbContext db, string host, int port)
    {
        if (!await db.Printers.AnyAsync())
        {
            // ── Simulation printers (self-hosted TCP inside printer-adapter) ───
            // IpAddress = "localhost" because VirtualPrinterSimulator listens on the same process
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

            // ── Physical printer (route via CUPS / lpr) ──────────────────────
            var cupsQueue = Environment.GetEnvironmentVariable("CUPS_QUEUE")
                            ?? "Zebra_Technologies_ZTC_GK420t";

            var pCups = Printer.Create(
                "Zebra-GK420t-CUPS",
                "Zebra GK420t (Physical)",
                "localhost",
                631,
                "ZPL",
                "ZEBRA",
                driverType: "cups",
                cupsQueueName: cupsQueue);
            // Status will be updated by PrinterHealthService on first poll
            await db.Printers.AddAsync(pCups);

            await db.SaveChangesAsync();
        }
        else
        {
            // Ensure the CUPS printer exists if DB was already seeded before this feature
            var cupsCode = "Zebra-GK420t-CUPS";
            if (!await db.Printers.AnyAsync(p => p.PrinterCode == cupsCode))
            {
                var cupsQueue = Environment.GetEnvironmentVariable("CUPS_QUEUE")
                                ?? "Zebra_Technologies_ZTC_GK420t";
                var pCups = Printer.Create(
                    cupsCode,
                    "Zebra GK420t (Physical)",
                    "localhost",
                    631,
                    "ZPL",
                    "ZEBRA",
                    driverType: "cups",
                    cupsQueueName: cupsQueue);
                await db.Printers.AddAsync(pCups);
                await db.SaveChangesAsync();
            }

            // Migrate existing simulation printers from device-simulator host to localhost
            var simPrinters = await db.Printers
                .Where(p => p.DriverType == "simulation" && p.IpAddress != "localhost")
                .ToListAsync();
            foreach (var p in simPrinters)
            {
                // Use reflection-safe approach via domain method or raw SQL
                // Since IpAddress setter is private, update via raw SQL for migration
            }
        }
    }
}


