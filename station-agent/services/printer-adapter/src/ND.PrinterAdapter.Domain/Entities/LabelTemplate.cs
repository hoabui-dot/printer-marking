using ND.SharedKernel.Primitives;

namespace ND.PrinterAdapter.Domain.Entities;

/// <summary>
/// A label template stored as JSON. Never stores generated ZPL.
/// Each save increments the Version. Historical versions are preserved in LabelTemplateVersion.
/// Table: label_templates
/// </summary>
public sealed class LabelTemplate : Entity
{
    public string Name { get; private set; } = default!;
    public string? Description { get; private set; }
    public int Dpi { get; private set; } = 203;
    public double LabelWidth { get; private set; }   // mm
    public double LabelHeight { get; private set; }  // mm
    public string TemplateJson { get; private set; } = default!;
    public int Version { get; private set; } = 1;
    public bool IsActive { get; private set; } = true;
    public string UpdatedAt { get; private set; } = DateTime.UtcNow.ToString("o");

    private LabelTemplate() { }

    public static LabelTemplate Create(
        string name,
        string? description,
        int dpi,
        double labelWidth,
        double labelHeight,
        string templateJson)
    {
        return new LabelTemplate
        {
            Name = name,
            Description = description,
            Dpi = dpi,
            LabelWidth = labelWidth,
            LabelHeight = labelHeight,
            TemplateJson = templateJson,
            Version = 1,
            IsActive = true,
            UpdatedAt = DateTime.UtcNow.ToString("o")
        };
    }

    /// <summary>
    /// Updates the template JSON, bumping the version number.
    /// The caller must also snapshot a new LabelTemplateVersion before calling this.
    /// </summary>
    public void Update(string name, string? description, int dpi, double labelWidth, double labelHeight, string templateJson)
    {
        Name = name;
        Description = description;
        Dpi = dpi;
        LabelWidth = labelWidth;
        LabelHeight = labelHeight;
        TemplateJson = templateJson;
        Version += 1;
        UpdatedAt = DateTime.UtcNow.ToString("o");
    }

    public void Deactivate() => IsActive = false;
    public void Activate() => IsActive = true;
}
