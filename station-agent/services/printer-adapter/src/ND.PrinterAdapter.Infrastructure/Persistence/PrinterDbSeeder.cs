using Microsoft.EntityFrameworkCore;
using ND.PrinterAdapter.Domain.Entities;

namespace ND.PrinterAdapter.Infrastructure.Persistence;

public static class PrinterDbSeeder
{
    public static async Task SeedAsync(PrinterDbContext db, string host, int port)
    {
        if (!await db.Printers.AnyAsync())
        {
            // ── Simulation printers (route to Device Simulator via TCP) ──────
            var p1 = Printer.Create("Printer-01", "Zebra Industrial A", host, 9100, "ZPL", "ZEBRA", driverType: "simulation");
            p1.SetOnline();
            await db.Printers.AddAsync(p1);

            var p2 = Printer.Create("Printer-02", "Zebra Industrial B", host, 9101, "ZPL", "ZEBRA", driverType: "simulation");
            p2.SetOnline();
            await db.Printers.AddAsync(p2);

            var p3 = Printer.Create("Printer-03", "Zebra Desktop C", host, 9102, "ZPL", "ZEBRA", driverType: "simulation");
            p3.SetOnline();
            await db.Printers.AddAsync(p3);

            var pLegacy = Printer.Create("printer-01", "Zebra Kiosk Printer (Legacy)", host, 9100, "ZPL", "ZEBRA", driverType: "simulation");
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
        }
    }
}

