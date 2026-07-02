using System.Collections.Generic;

namespace ND.PrinterAdapter.Application.DTOs;

public record CreateTemplateRequest(
    string Name,
    string? Description,
    int Dpi,
    double LabelWidth,
    double LabelHeight,
    string TemplateJson);

public record UpdateTemplateRequest(
    string Name,
    string? Description,
    int Dpi,
    double LabelWidth,
    double LabelHeight,
    string TemplateJson);

public record RenderRequest(
    string TemplateJson,
    IDictionary<string, string>? Data);

public record RenderWithDataRequest(
    IDictionary<string, string>? Data);

public record PrintTestRequest(
    IDictionary<string, string>? Data,
    string? PrinterCode,
    string? CorrelationId);
