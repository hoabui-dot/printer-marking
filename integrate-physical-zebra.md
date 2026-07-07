# Feature: Integrate Physical Zebra GK420t Printer (macOS + CUPS)

Before writing any code, analyze the current Station Agent architecture, especially:

- Device Simulator
- MQTT Adapter
- Job Engine
- Print Adapter Service
- Projection Service
- Kiosk UI
- Existing ZPL Generator
- RabbitMQ topology

The implementation must integrate a real Zebra GK420t printer connected via USB on macOS using the native CUPS subsystem, while preserving the current Event-Driven Architecture.

---

# Architecture Constraints

The following rules are mandatory.

## DO NOT

- Do not let Job Engine communicate directly with CUPS.
- Do not let Device Simulator invoke lp/lpr commands.
- Do not embed printer-specific logic inside Job Engine.
- Do not break Database-per-Service.
- Do not bypass RabbitMQ.

The only service allowed to communicate with CUPS is

Print Adapter Service.

---

# Current Flow

Current flow is

Device Simulator

↓

RabbitMQ

↓

Job Engine

↓

Print Adapter

↓

Projection

↓

SignalR

↓

Kiosk UI

Maintain this architecture.

---

# New Printing Flow

The physical printer should replace only the final printing layer.

Business flow becomes

Production Order

↓

Job Engine

↓

Print Job

↓

RabbitMQ

↓

Print Adapter

↓

Generate ZPL

↓

CUPS

↓

USB

↓

Zebra GK420t

↓

Printer Status

↓

Projection

↓

Kiosk UI

Nothing above Print Adapter should know whether the printer is simulated or physical.

---

# Printer Driver Layer

Inside Print Adapter create a Printer Driver abstraction.

Example

IPrinterDriver

```
Connect()

Print()

GetStatus()

Discover()

HealthCheck()

Disconnect()
```

Implement

SimulationPrinterDriver

(current implementation)

and

CupsPrinterDriver

(new implementation)

Both drivers implement the same interface.

The Job Engine must not know which driver is currently active.

---

# Printer Configuration

Printer configuration should be stored centrally.

Example

```
Printing

Driver

Simulation

or

CUPS

QueueName

Zebra_GK420t

DefaultDpi

203

Darkness

20

Speed

4

Copies

1

```

Switching from Simulation to Physical Printer should require only configuration.

No source code changes.

---

# CUPS Integration

Implement a new

CupsPrinterDriver

Responsibilities

- Discover printers
- Verify printer availability
- Send raw ZPL
- Read printer status
- Handle failures

---

# Printer Discovery

Use

```
lpstat -p -d
```

to enumerate printers.

Example

```
printer Zebra_GK420t is idle.
system default destination: Zebra_GK420t
```

Expose

```
GET /api/printers
```

Return

```
[
{
id,
name,
queueName,
driver,
status,
isDefault
}
]
```

---

# Print Execution

The Print Adapter should execute

```
lpr

-o raw

-P Zebra_GK420t

label.zpl
```

or

pipe directly

```
echo "^XA...^XZ"

|

lpr

-o raw

-P Zebra_GK420t
```

Never rasterize.

Always send raw ZPL.

---

# Temporary File Handling

Do not permanently store ZPL files.

Generate

```
Temp

↓

Send

↓

Delete
```

Support in-memory piping whenever possible.

---

# Print Job Pipeline

When Print Adapter receives

PrintJob

↓

Generate ZPL

↓

Validate ZPL

↓

Send to CUPS

↓

Receive OS response

↓

Publish

PrintStarted

↓

Publish

PrintCompleted

or

PrintFailed

Projection updates UI.

---

# Error Handling

Detect

Printer Offline

Queue Missing

USB Disconnected

Paper Out

Ribbon Out

CUPS Timeout

Permission Denied

Invalid Queue

Invalid ZPL

Each error should publish

PrintFailed

with

```
ErrorCode

ErrorMessage

Recoverable

Retryable
```

---

# Retry Policy

Recoverable

Retry automatically.

Examples

Printer Busy

USB Reconnect

Temporary CUPS failure

Non Recoverable

Require operator intervention.

Examples

Queue Missing

Invalid Printer

Corrupted ZPL

---

# Health Check

Every 15 seconds

Print Adapter checks

```
lpstat

```

Status

Idle

Printing

Stopped

Offline

Disconnected

Publish

PrinterHealthChanged

Projection updates Dashboard.

---

# Dashboard

Dashboard should display

Printer

Online

Offline

Printing

Queue Length

Last Print

Current Job

Temperature (future)

Ribbon Status (future)

Paper Status (future)

---

# Print History

Store

Printer Name

Queue Name

Driver

Print Time

Execution Time

ZPL Version

Result

Operator

Machine

Serial Number

Barcode

---

# Device Simulator

Device Simulator behavior must remain unchanged.

It still publishes

Print Request

through RabbitMQ.

The simulator must never know whether

Print Adapter

is

Simulation

or

Physical.

---

# Local Development

Support two modes

Simulation

(default)

Physical Printer

(configuration only)

Example

```
PRINT_DRIVER=simulation

```

or

```
PRINT_DRIVER=cups

CUPS_QUEUE=Zebra_GK420t
```

No recompilation required.

---

# Logging

Every print operation must be logged.

Example

```
Print Request Received

↓

ZPL Generated

↓

Printer Queue Selected

↓

Sent to CUPS

↓

CUPS Accepted

↓

Completed

```

Log the execution duration.

---

# Testing

Verify

✓ Printer discovered

✓ Queue detected

✓ Raw ZPL accepted

✓ Barcode printed correctly

✓ QR printed correctly

✓ Long text wraps correctly

✓ UTF-8 handled correctly

✓ Print failure handled

✓ USB unplug handled

✓ Queue missing handled

✓ Dashboard updates

✓ Projection updates

✓ Print history stored

✓ Retry works

✓ Simulation mode still works

---

# Deliverables

Implement

- CupsPrinterDriver
- Printer Driver abstraction
- Physical printer configuration
- Printer discovery API
- Health Check Service
- CUPS raw printing
- Error handling
- Retry policy
- Dashboard printer status
- Projection updates
- Print history enhancements
- Unit tests
- Integration tests
- Update AI_DOCUMENT.md
- Update PRODUCT_DOCUMENT.md

The final implementation must allow the Station Agent to switch between the existing simulated printer and a real Zebra GK420t connected via USB on macOS by changing configuration only, without modifying any business logic.
