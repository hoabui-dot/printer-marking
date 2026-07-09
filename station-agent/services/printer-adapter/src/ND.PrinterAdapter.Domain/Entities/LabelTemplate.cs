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

    /// <summary>Short machine-readable code, e.g. "LBL-WIP-60x40".</summary>
    public string? TemplateCode { get; private set; }

    /// <summary>Label category: WIP | PALLET | SHELF | INSPECTION | MATERIAL | SHEET | ISSUE | PRODUCT</summary>
    public string? Category { get; private set; }

    /// <summary>Orientation: PORTRAIT | LANDSCAPE</summary>
    public string? Orientation { get; private set; } = "PORTRAIT";

    /// <summary>Letter revision: A, B, C …</summary>
    public string? Revision { get; private set; } = "A";

    /// <summary>JSON array of supported barcode symbologies, e.g. ["CODE128","QR"]</summary>
    public string? SupportedBarcodeTypes { get; private set; }

    /// <summary>JSON array of compatible printer models, e.g. ["GK420t","ZT230"]</summary>
    public string? SupportedPrinterModels { get; private set; }

    /// <summary>JSON array of compatible station types, e.g. ["PRINT_STATION","MARK_STATION"]</summary>
    public string? CompatibleStationTypes { get; private set; }

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
        string? createdBy = null,
        string? templateCode = null,
        string? category = null,
        string? orientation = "PORTRAIT",
        string? revision = "A",
        string? supportedBarcodeTypes = null,
        string? supportedPrinterModels = null,
        string? compatibleStationTypes = null)
    {
        return new LabelTemplate
        {
            Name = name,
            Description = description,
            TemplateCode = templateCode,
            Category = category,
            Orientation = orientation ?? "PORTRAIT",
            Revision = revision ?? "A",
            SupportedBarcodeTypes = supportedBarcodeTypes,
            SupportedPrinterModels = supportedPrinterModels,
            CompatibleStationTypes = compatibleStationTypes,
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
    public void Update(
        string name,
        string? description,
        int dpi,
        double labelWidth,
        double labelHeight,
        string templateJson,
        string? updatedBy = null,
        string? templateCode = null,
        string? category = null,
        string? orientation = null,
        string? revision = null,
        string? supportedBarcodeTypes = null,
        string? supportedPrinterModels = null,
        string? compatibleStationTypes = null)
    {
        Name = name;
        Description = description;
        if (templateCode is not null) TemplateCode = templateCode;
        if (category is not null) Category = category;
        if (orientation is not null) Orientation = orientation;
        if (revision is not null) Revision = revision;
        if (supportedBarcodeTypes is not null) SupportedBarcodeTypes = supportedBarcodeTypes;
        if (supportedPrinterModels is not null) SupportedPrinterModels = supportedPrinterModels;
        if (compatibleStationTypes is not null) CompatibleStationTypes = compatibleStationTypes;
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
