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

    /// <summary>Status: draft | published | archived</summary>
    public string Status { get; private set; } = "published";

    /// <summary>True if this is the system-wide default template.</summary>
    public bool IsDefault { get; private set; } = false;

    public string? CreatedBy { get; private set; }
    public string? UpdatedBy { get; private set; }
    public string UpdatedAt { get; private set; } = DateTime.UtcNow.ToString("o");

    private LabelTemplate() { }

    public static LabelTemplate Create(
        string name,
        string? description,
        int dpi,
        double labelWidth,
        double labelHeight,
        string templateJson,
        string status = "published",
        string? createdBy = null)
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
            Status = status,
            IsDefault = false,
            CreatedBy = createdBy,
            UpdatedBy = createdBy,
            UpdatedAt = DateTime.UtcNow.ToString("o")
        };
    }

    /// <summary>
    /// Updates the template JSON, bumping the version number.
    /// The caller must also snapshot a new LabelTemplateVersion before calling this.
    /// </summary>
    public void Update(string name, string? description, int dpi, double labelWidth, double labelHeight, string templateJson, string? updatedBy = null)
    {
        Name = name;
        Description = description;
        Dpi = dpi;
        LabelWidth = labelWidth;
        LabelHeight = labelHeight;
        TemplateJson = templateJson;
        Version += 1;
        UpdatedBy = updatedBy;
        UpdatedAt = DateTime.UtcNow.ToString("o");
    }

    public void Publish(string? updatedBy = null)
    {
        Status = "published";
        UpdatedBy = updatedBy;
        UpdatedAt = DateTime.UtcNow.ToString("o");
    }

    public void Archive(string? updatedBy = null)
    {
        Status = "archived";
        IsDefault = false;
        UpdatedBy = updatedBy;
        UpdatedAt = DateTime.UtcNow.ToString("o");
    }

    public void SetAsDefault()
    {
        IsDefault = true;
        if (Status != "published")
            Status = "published";
        UpdatedAt = DateTime.UtcNow.ToString("o");
    }

    public void UnsetDefault() => IsDefault = false;

    public void Deactivate() => IsActive = false;
    public void Activate() => IsActive = true;
}
