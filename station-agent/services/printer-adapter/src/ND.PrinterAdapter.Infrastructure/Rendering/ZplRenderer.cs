using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using ND.PrinterAdapter.Application.Interfaces;

namespace ND.PrinterAdapter.Infrastructure.Rendering;

/// <summary>
/// ZPL (Zebra Programming Language) renderer implementation of the ILabelRenderer strategy.
/// Converts the JSON label template + runtime data into raw ZPL commands ready to send to a Zebra printer via TCP port 9100.
///
/// Supported elements:
///   - text: ^FO + ^A + ^FD
///   - barcode: ^FO + ^BC (Code128), ^B3 (Code39), ^BE (EAN-13), ^BU (UPC-A)
///   - qr: ^FO + ^BQ
///   - rect: ^FO + ^GB (box)
///   - circle: ^FO + ^GE (ellipse)
///   - line: ^FO + ^GD (diagonal) or ^GB (horizontal/vertical)
///   - image: ^GFA (base64 raster, requires conversion)
/// </summary>
public sealed class ZplRenderer : ILabelRenderer
{
    private readonly ILogger<ZplRenderer> _logger;

    public string RendererType => "ZPL";

    public ZplRenderer(ILogger<ZplRenderer> logger)
    {
        _logger = logger;
    }

    public string Render(string templateJson, IDictionary<string, string> data)
    {
        _logger.LogDebug("ZplRenderer: rendering template with {Count} binding fields", data.Count);

        JsonElement root;
        try
        {
            root = JsonDocument.Parse(templateJson).RootElement;
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "ZplRenderer: invalid template JSON");
            throw new InvalidOperationException("Label template JSON is invalid.", ex);
        }

        var dpi = root.TryGetProperty("dpi", out var dpiProp) ? dpiProp.GetInt32() : 203;
        var sb = new StringBuilder();
        sb.AppendLine("^XA"); // Start label

        // Set label dimensions if provided
        if (root.TryGetProperty("width", out var wProp) && root.TryGetProperty("height", out var hProp))
        {
            var widthDots = MmToDots(wProp.GetDouble(), dpi);
            var heightDots = MmToDots(hProp.GetDouble(), dpi);
            sb.AppendLine($"^PW{widthDots}"); // Print width
            sb.AppendLine($"^LL{heightDots}"); // Label length
        }

        if (!root.TryGetProperty("elements", out var elements))
        {
            sb.AppendLine("^XZ");
            return sb.ToString();
        }

        foreach (var el in elements.EnumerateArray())
        {
            var type = el.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : null;
            if (string.IsNullOrWhiteSpace(type)) continue;

            try
            {
                var elementZpl = type.ToLowerInvariant() switch
                {
                    "text"       => RenderText(el, data, dpi),
                    "barcode"    => RenderBarcode(el, data, dpi),
                    "qr"         => RenderQrCode(el, data, dpi),
                    "datamatrix" => RenderDataMatrix(el, data, dpi),
                    "rect"       => RenderRect(el, dpi),
                    "circle"     => RenderCircle(el, dpi),
                    "line"       => RenderLine(el, dpi),
                    _            => null
                };

                if (elementZpl is not null)
                    sb.Append(elementZpl);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ZplRenderer: failed to render element of type '{Type}' — skipping", type);
            }
        }

        sb.AppendLine("^XZ"); // End label
        return sb.ToString();
    }

    // ─── Element Renderers ────────────────────────────────────────────────────

    private string RenderText(JsonElement el, IDictionary<string, string> data, int dpi)
    {
        var x = GetInt(el, "x", 0);
        var y = GetInt(el, "y", 0);
        var fontSize = GetInt(el, "fontSize", 24);
        var text = ResolveBinding(el, data);

        // ^A0N: ZPL standard font. Scale height proportionally from fontSize.
        var fontHeight = (int)(fontSize * 1.4);
        var fontWidth = (int)(fontSize * 1.2);

        return $"^FO{x},{y}^A0N,{fontHeight},{fontWidth}^FD{EscapeZpl(text)}^FS\n";
    }

    private string RenderBarcode(JsonElement el, IDictionary<string, string> data, int dpi)
    {
        var x = GetInt(el, "x", 0);
        var y = GetInt(el, "y", 0);
        var height = GetInt(el, "height", 80);
        var value = ResolveBinding(el, data);
        var symbology = el.TryGetProperty("symbology", out var sym) ? sym.GetString() ?? "Code128" : "Code128";
        var barWidth = GetInt(el, "barWidth", 3);

        return symbology.ToUpperInvariant() switch
        {
            "CODE128"  => $"^FO{x},{y}^BY{barWidth}^BCN,{height},Y,N,N^FD{EscapeZpl(value)}^FS\n",
            "CODE39"   => $"^FO{x},{y}^BY{barWidth}^B3N,N,{height},Y,N^FD{EscapeZpl(value)}^FS\n",
            "EAN13"    => $"^FO{x},{y}^BY{barWidth}^BEN,{height},Y,N^FD{EscapeZpl(value)}^FS\n",
            "UPCA"     => $"^FO{x},{y}^BY{barWidth}^BUN,{height},Y,N^FD{EscapeZpl(value)}^FS\n",
            "EAN8"     => $"^FO{x},{y}^BY{barWidth}^B8N,{height},Y,N^FD{EscapeZpl(value)}^FS\n",
            "ITF"      => $"^FO{x},{y}^BY{barWidth}^BIN,{height},Y,N^FD{EscapeZpl(value)}^FS\n",
            _          => $"^FO{x},{y}^BY{barWidth}^BCN,{height},Y,N,N^FD{EscapeZpl(value)}^FS\n" // default Code128
        };
    }

    private string RenderQrCode(JsonElement el, IDictionary<string, string> data, int dpi)
    {
        var x = GetInt(el, "x", 0);
        var y = GetInt(el, "y", 0);
        var magnification = GetInt(el, "magnification", 4);
        var errorCorrection = el.TryGetProperty("errorCorrection", out var ec) ? ec.GetString() ?? "M" : "M";
        var value = ResolveQrPayload(el, data);

        // ^BQ: QR Code. Format: ^BQa,b where a=model(2=QRCode), b=magnification(1-10)
        // Then ^FD followed by error correction level + A (Auto) + data + ^FS
        return $"^FO{x},{y}^BQN,2,{magnification}^FD{errorCorrection}A,{EscapeZpl(value)}^FS\n";
    }

    private string ResolveQrPayload(JsonElement el, IDictionary<string, string> data)
    {
        if (el.TryGetProperty("payloadTemplate", out var ptProp) && !string.IsNullOrWhiteSpace(ptProp.GetString()))
        {
            var template = ptProp.GetString()!;
            var sb = new StringBuilder(template);
            foreach (var kvp in data)
            {
                sb.Replace("{" + kvp.Key + "}", kvp.Value);
            }
            return sb.ToString();
        }

        return ResolveBinding(el, data);
    }

    private string RenderDataMatrix(JsonElement el, IDictionary<string, string> data, int dpi)
    {
        var x = GetInt(el, "x", 0);
        var y = GetInt(el, "y", 0);
        var magnification = GetInt(el, "magnification", 4);
        var value = ResolveBinding(el, data);

        // ^BX: Data Matrix. ECC200 is represented by quality=200
        return $"^FO{x},{y}^BXN,{magnification},200^FD{EscapeZpl(value)}^FS\n";
    }

    private string RenderRect(JsonElement el, int dpi)
    {
        var x = GetInt(el, "x", 0);
        var y = GetInt(el, "y", 0);
        var width = GetInt(el, "width", 100);
        var height = GetInt(el, "height", 50);
        var thickness = GetInt(el, "strokeWidth", 2);

        // ^GB: Graphic Box. Format: ^GBw,h,t
        return $"^FO{x},{y}^GB{width},{height},{thickness}^FS\n";
    }

    private string RenderCircle(JsonElement el, int dpi)
    {
        var x = GetInt(el, "x", 0);
        var y = GetInt(el, "y", 0);
        var diameter = GetInt(el, "width", 60);
        var thickness = GetInt(el, "strokeWidth", 2);

        // ^GE: Graphic Ellipse. Format: ^GEw,h,t
        return $"^FO{x},{y}^GE{diameter},{diameter},{thickness}^FS\n";
    }

    private string RenderLine(JsonElement el, int dpi)
    {
        var x = GetInt(el, "x", 0);
        var y = GetInt(el, "y", 0);
        var width = GetInt(el, "width", 100);
        var height = GetInt(el, "height", 2);
        var thickness = Math.Max(height, 1);

        // ^GB: Graphic Box — use it as a line by making height == thickness
        return $"^FO{x},{y}^GB{width},{thickness},{thickness}^FS\n";
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private static string ResolveBinding(JsonElement el, IDictionary<string, string> data)
    {
        if (el.TryGetProperty("binding", out var binding) && !string.IsNullOrWhiteSpace(binding.GetString()))
        {
            var key = binding.GetString()!;
            if (data.TryGetValue(key, out var value))
                return value;
            
            // Fallback to defaultValue or static values before returning placeholder
            if (el.TryGetProperty("defaultValue", out var defVal)) return defVal.GetString() ?? "";
            if (el.TryGetProperty("value", out var val)) return val.GetString() ?? "";
            if (el.TryGetProperty("text", out var txt)) return txt.GetString() ?? "";

            return $"{{{key}}}"; // placeholder if not provided
        }

        // Fallback to static properties
        if (el.TryGetProperty("value", out var valueProp)) return valueProp.GetString() ?? "";
        if (el.TryGetProperty("text", out var textProp)) return textProp.GetString() ?? "";
        if (el.TryGetProperty("defaultValue", out var defaultProp)) return defaultProp.GetString() ?? "";
        return "";
    }

    private static string EscapeZpl(string value)
    {
        return value.Replace("^", " ").Replace("~", " ").Replace("\r", "").Replace("\n", "");
    }

    private static int GetInt(JsonElement el, string property, int defaultValue)
    {
        if (el.TryGetProperty(property, out var prop))
        {
            if (prop.ValueKind == JsonValueKind.Number)
                return prop.GetInt32();
        }

        // Fallback for nested font size e.g. font: { family: "A0", height: 30 }
        if (property == "fontSize" && el.TryGetProperty("font", out var fontProp) && fontProp.ValueKind == JsonValueKind.Object)
        {
            if (fontProp.TryGetProperty("height", out var heightProp) && heightProp.ValueKind == JsonValueKind.Number)
                return heightProp.GetInt32();
            if (fontProp.TryGetProperty("width", out var widthProp) && widthProp.ValueKind == JsonValueKind.Number)
                return widthProp.GetInt32();
        }

        return defaultValue;
    }

    private static int MmToDots(double mm, int dpi)
        => (int)Math.Round(mm / 25.4 * dpi);
}
