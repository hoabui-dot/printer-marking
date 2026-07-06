using Microsoft.EntityFrameworkCore;
using ND.PrinterAdapter.Domain.Entities;

namespace ND.PrinterAdapter.Infrastructure.Persistence;

public static class PrinterDbSeeder
{
    public static async Task SeedAsync(PrinterDbContext db, string host, int port)
    {
        if (!await db.Printers.AnyAsync())
        {
            var p1 = Printer.Create("Printer-01", "Zebra Industrial A", host, 9100, "ZPL", "ZEBRA");
            p1.SetOnline();
            await db.Printers.AddAsync(p1);

            var p2 = Printer.Create("Printer-02", "Zebra Industrial B", host, 9101, "ZPL", "ZEBRA");
            p2.SetOnline();
            await db.Printers.AddAsync(p2);

            var p3 = Printer.Create("Printer-03", "Zebra Desktop C", host, 9102, "ZPL", "ZEBRA");
            p3.SetOnline();
            await db.Printers.AddAsync(p3);

            var pLegacy = Printer.Create("printer-01", "Zebra Kiosk Printer (Legacy)", host, 9100, "ZPL", "ZEBRA");
            pLegacy.SetOnline();
            await db.Printers.AddAsync(pLegacy);

            await db.SaveChangesAsync();
        }
    }
}
