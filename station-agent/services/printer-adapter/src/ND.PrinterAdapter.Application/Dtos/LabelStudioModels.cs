using System.Collections.Generic;

namespace ND.PrinterAdapter.Application.DTOs;

public record CreateTemplateRequest(
    string Name,
    string? Description,
    string? Note,
    int Dpi,
    double LabelWidth,
    double LabelHeight,
    string TemplateJson,
    string? TemplateCode = null,
    string? Category = null,
    string? Orientation = "PORTRAIT",
    string? Revision = "A",
    string? SupportedBarcodeTypes = null,
    string? SupportedPrinterModels = null,
    string? CompatibleStationTypes = null);

public record UpdateTemplateRequest(
    string Name,
    string? Description,
    string? Note,
    int Dpi,
    double LabelWidth,
    double LabelHeight,
    string TemplateJson,
    string? TemplateCode = null,
    string? Category = null,
    string? Orientation = null,
    string? Revision = null,
    string? SupportedBarcodeTypes = null,
    string? SupportedPrinterModels = null,
    string? CompatibleStationTypes = null);

public record RenderRequest(
    string TemplateJson,
    IDictionary<string, string>? Data);

public record RenderWithDataRequest(
    IDictionary<string, string>? Data);

public record PrintTestRequest(
    IDictionary<string, string>? Data,
    string? PrinterCode,
    string? CorrelationId);
