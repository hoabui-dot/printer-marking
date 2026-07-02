using ND.PrinterAdapter.Domain.Entities;

namespace ND.PrinterAdapter.Application.Interfaces;

/// <summary>
/// Repository for managing label templates and their version history.
/// </summary>
public interface ILabelTemplateRepository
{
    Task<IList<LabelTemplate>> ListAsync(string? search = null, int? dpi = null, CancellationToken ct = default);
    Task<LabelTemplate?> GetByIdAsync(string id, CancellationToken ct = default);
    Task AddAsync(LabelTemplate template, CancellationToken ct = default);
    Task UpdateAsync(LabelTemplate template, CancellationToken ct = default);
    Task DeleteAsync(string id, CancellationToken ct = default);

    /// <summary>Saves an immutable version snapshot before updating a template.</summary>
    Task AddVersionAsync(LabelTemplateVersion version, CancellationToken ct = default);
    Task<IList<LabelTemplateVersion>> GetVersionHistoryAsync(string templateId, CancellationToken ct = default);
    Task<LabelTemplateVersion?> GetVersionAsync(string templateId, int version, CancellationToken ct = default);
}
