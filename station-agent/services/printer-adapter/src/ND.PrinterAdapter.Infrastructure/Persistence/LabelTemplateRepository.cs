using Microsoft.EntityFrameworkCore;
using ND.PrinterAdapter.Application.Interfaces;
using ND.PrinterAdapter.Domain.Entities;
using ND.PrinterAdapter.Infrastructure.Persistence;

namespace ND.PrinterAdapter.Infrastructure.Persistence;

public sealed class LabelTemplateRepository : ILabelTemplateRepository
{
    private readonly PrinterDbContext _db;

    public LabelTemplateRepository(PrinterDbContext db)
    {
        _db = db;
    }

    public async Task<IList<LabelTemplate>> ListAsync(string? search = null, int? dpi = null, CancellationToken ct = default)
    {
        var query = _db.LabelTemplates.Where(t => t.IsActive);

        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(t => t.Name.Contains(search) ||
                                     (t.Description != null && t.Description.Contains(search)));

        if (dpi.HasValue)
            query = query.Where(t => t.Dpi == dpi.Value);

        return await query.OrderByDescending(t => t.UpdatedAt).ToListAsync(ct);
    }

    public async Task<LabelTemplate?> GetByIdAsync(string id, CancellationToken ct = default)
        => await _db.LabelTemplates.FirstOrDefaultAsync(t => t.Id == id && t.IsActive, ct);

    public async Task AddAsync(LabelTemplate template, CancellationToken ct = default)
        => await _db.LabelTemplates.AddAsync(template, ct);

    public Task UpdateAsync(LabelTemplate template, CancellationToken ct = default)
    {
        _db.LabelTemplates.Update(template);
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        var template = await _db.LabelTemplates.FindAsync(new object[] { id }, ct);
        if (template is not null)
        {
            template.Deactivate();
            _db.LabelTemplates.Update(template);
        }
    }

    public async Task AddVersionAsync(LabelTemplateVersion version, CancellationToken ct = default)
        => await _db.LabelTemplateVersions.AddAsync(version, ct);

    public async Task<IList<LabelTemplateVersion>> GetVersionHistoryAsync(string templateId, CancellationToken ct = default)
        => await _db.LabelTemplateVersions
            .Where(v => v.TemplateId == templateId)
            .OrderByDescending(v => v.Version)
            .ToListAsync(ct);

    public async Task<LabelTemplateVersion?> GetVersionAsync(string templateId, int version, CancellationToken ct = default)
        => await _db.LabelTemplateVersions
            .FirstOrDefaultAsync(v => v.TemplateId == templateId && v.Version == version, ct);
}
