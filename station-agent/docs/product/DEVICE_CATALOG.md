# Device Catalog — Print-Marking Edge Station

> **AI RULE**: When implementing any adapter service, use only the protocols and communication patterns documented here. Do not invent new device communication protocols.

---

## Overview

The station communicates with four categories of physical devices:

| Device | Adapter Service | Primary Protocol |
|---|---|---|
| Label Printer | `printer-adapter` | TCP 9100 (ZPL/EPL) |
| Laser Marker | `laser-adapter` | TCP / Vendor SDK |
| Vision System | `vision-service` | TCP / REST / USB |
| PLC | `plc-adapter` | Modbus TCP / Digital I/O |

---

## Device 1: Label Printer

### Description

Industrial thermal transfer label printer attached to the production line. Receives print commands and produces adhesive labels applied to products.

### Common Brands

- Zebra Technologies (ZT Series, ZD Series)
- Honeywell (PX Series)
- SATO
- Datamax

### Communication Protocol

| Parameter | Value |
|---|---|
| Protocol | TCP/IP |
| Port | **9100** (raw print port) |
| Language | ZPL (Zebra Programming Language) or EPL (Eltron Programming Language) |
| Connection | Persistent or per-job |
| Timeout | 10 seconds per print job |

### ZPL Command Example

```
^XA
^FO50,50^BQN,2,10^FDLA,https://trace.example.com/product/SN-001234^FS
^FO50,200^ADN,36,20^FDLot: 2026-BATCH-A^FS
^FO50,250^ADN,36,20^FDMfg: 2026-06-16^FS
^FO50,300^ADN,36,20^FDExp: 2028-06-16^FS
^XZ
```

### Adapter Responsibilities

```
✅ Open TCP connection to printer IP:9100
✅ Send ZPL/EPL content as raw bytes
✅ Wait for printer status response
✅ Detect paper out, head error, ribbon error
✅ Report print SUCCESS or FAILURE with error code
✅ Log every print attempt with timestamp
✅ Support health check (CheckHealthAsync)
```

### Error Codes

| Error | Meaning | Recovery |
|---|---|---|
| Connection refused | Printer offline or wrong IP | Retry → alert operator |
| Timeout | Printer busy or jammed | Retry → alert operator |
| Status error | Hardware fault | Alert operator, pause line |

### Adapter Interface

```csharp
Task<bool> PrintAsync(string ipAddress, int port, string zplContent, CancellationToken ct);
Task<bool> CheckHealthAsync(string ipAddress, int port, CancellationToken ct);
```

---

## Device 2: Laser Marker

### Description

CO2 or fiber laser machine that permanently marks information directly onto product surfaces or packaging. Used for high-permanence traceability codes.

### Common Brands

- TRUMPF
- Coherent / II-VI
- KEYENCE (MD Series)
- Telesis
- Han's Laser

### Communication Protocol

| Parameter | Value |
|---|---|
| Protocol | TCP/IP (vendor-specific command set) or Vendor SDK (DLL/shared library) |
| Port | Vendor-defined (typically 5000–9999) |
| Language | Vendor command set or SDK API |
| Connection | Persistent session |
| Timeout | 30 seconds per marking operation |

### Responsibilities

```
✅ Establish connection to laser controller
✅ Load marking template / content
✅ Trigger marking execution
✅ Wait for marking completion signal
✅ Read execution result (OK / FAULT)
✅ Report laser faults (no beam, overheating, safety interlock)
✅ Support health check
```

### Marking Content Format

The marking content is sent as a structured command:

```json
{
  "marking_type": "LASER_ETCHING",
  "content": {
    "serial": "SN-0001234",
    "lot": "2026-BATCH-A",
    "date_code": "260616"
  },
  "template_id": "TMPL-001"
}
```

### Error Handling

| Fault | Meaning | Recovery |
|---|---|---|
| Connection timeout | Machine offline | Retry → pause line |
| Safety interlock | Door open / E-stop | Alert operator immediately |
| Marking fault | Beam failure | Alert operator |
| Overheating | Thermal protection | Wait for cooldown, retry |

### Adapter Interface

```csharp
Task<bool> MarkAsync(string ipAddress, int port, LaserMarkCommand command, CancellationToken ct);
Task<bool> CheckHealthAsync(string ipAddress, int port, CancellationToken ct);
```

---

## Device 3: Vision System

### Description

Industrial camera and image processing system used to verify printed labels and laser marks. Can perform OCR, barcode scanning, QR scanning, and visual inspection.

### Common Types

| Type | Example | Protocol |
|---|---|---|
| Smart Camera | KEYENCE IV Series, Cognex In-Sight | TCP / REST |
| USB Camera + PC | Allied Vision, Basler | USB / GigE SDK |
| Embedded Scanner | Zebra DS Series | USB / Serial |
| OCR Engine | ABBYY, Tesseract (embedded) | Local SDK |

### Communication Protocols

| Protocol | Use Case |
|---|---|
| TCP/IP | Sending trigger command, receiving result |
| REST HTTP | Modern vision controllers with web API |
| USB | Direct connected cameras |
| SDK (DLL) | Embedded vision libraries |

### Responsibilities

```
✅ Trigger image capture on demand
✅ Perform OCR on specified region
✅ Decode barcode/QR code from image
✅ Compare decoded result against expected content
✅ Return structured verification result
✅ Report camera faults (no image, timeout)
✅ Support health check
```

### Verification Result Format

```csharp
public record VisionResult(
    string JobId,
    string CameraId,
    string ExpectedContent,
    string? DecodedContent,
    string Status,         // VERIFIED_PASS | VERIFIED_FAIL | VERIFIED_RETRY
    string? ErrorMessage,
    DateTime ScannedAt
);
```

### Error Handling

| Fault | Meaning | Recovery |
|---|---|---|
| Timeout | Camera not responding | Retry 3x |
| No decode | Content unreadable | VERIFIED_RETRY or VERIFIED_FAIL |
| Content mismatch | Wrong text decoded | VERIFIED_FAIL → operator decision |
| Camera offline | Hardware fault | Alert operator, skip vision if configured |

### Adapter Interface

```csharp
Task<VisionResult> VerifyAsync(string cameraId, string expectedContent, CancellationToken ct);
Task<bool> CheckHealthAsync(string cameraId, CancellationToken ct);
```

---

## Device 4: PLC (Programmable Logic Controller)

### Description

PLC controls the production line machinery and provides electrical signals to the station. It reports line status and can trigger job creation based on product detection sensors.

### Common Brands

- Siemens (S7 Series)
- Allen-Bradley (CompactLogix)
- Mitsubishi (MELSEC)
- Omron (NX Series)
- Schneider Electric (Modicon)

### Communication Protocol

| Parameter | Value |
|---|---|
| Protocol | **Modbus TCP** (standard) or Digital I/O |
| Port | 502 (Modbus standard) |
| Registers | Configurable per installation |
| Polling interval | Configurable (default 100ms) |

### PLC Data Tags (Standard)

| Tag | Type | Meaning |
|---|---|---|
| `line.state` | Enum | LINE_IDLE / LINE_RUNNING / LINE_PAUSED / LINE_STOPPED |
| `sensor.product_detected` | Bool | Product in position |
| `sensor.conveyor_running` | Bool | Conveyor belt active |
| `machine.fault` | Bool | Any machine fault |
| `machine.fault_code` | Int | Specific fault code |

### Responsibilities

```
✅ Poll PLC registers at configured interval
✅ Detect state changes (line state, sensor state)
✅ Publish state change events to Job Engine
✅ Optionally trigger job creation on product detection
✅ Report PLC connection failures
```

### Robot Pick Events

The PLC also reports robot arm pick events in multi-station lines:

```csharp
public record PlcRobotPickEvent(
    string JobId,
    string PlcId,
    string PickStation,
    DateTime PickedAt
);
```

### Error Handling

| Fault | Meaning | Recovery |
|---|---|---|
| Modbus timeout | PLC offline or wrong IP | Retry → alert operator |
| Register read error | Configuration error | Log and skip |
| Line fault signal | Machine E-stop | Alert operator immediately |

### Adapter Interface

```csharp
Task<PlcState> GetStateAsync(string plcId, CancellationToken ct);
Task<bool> CheckHealthAsync(string plcId, CancellationToken ct);
```

---

## Multi-Device Coordination

When multiple devices are used in a single job:

```
Job Engine coordinates ALL devices in sequence.
No device communicates with another device directly.
All device results flow back through the Job Engine.
```

**Principle:** The station is the central coordinator. Devices are dumb executors.

---

## Device Configuration

Each device is registered in the local database with:

```json
{
  "device_id": "PRINTER-01",
  "device_type": "LABEL_PRINTER",
  "ip_address": "192.168.1.101",
  "port": 9100,
  "protocol": "ZPL",
  "location": "Line-03-Station-A",
  "is_active": true
}
```

Device configuration is managed through the Kiosk UI or imported from Factory Gateway.
