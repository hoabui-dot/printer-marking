using Microsoft.EntityFrameworkCore;
using ND.PrinterAdapter.Domain.Entities;

namespace ND.PrinterAdapter.Infrastructure.Persistence;

public static class PrinterDbSeeder
{
    public static async Task SeedAsync(PrinterDbContext db, string host, int port)
    {
        if (!await db.Printers.AnyAsync())
        {
            var printer = Printer.Create("printer-01", "Zebra Kiosk Printer", host, port, "ZPL", "ZEBRA");
            printer.SetOnline();
            await db.Printers.AddAsync(printer);
            await db.SaveChangesAsync();
        }
    }
}
