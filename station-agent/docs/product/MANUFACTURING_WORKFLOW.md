# Manufacturing Workflow — Print-Marking Edge Station

> **AI RULE**: All code implementing production logic must follow the exact workflows described here. Do not invent new flows.

---

## Overview

The station supports three primary operational modes:

| Mode | Operation Type | Devices Used |
|---|---|---|
| **Print Only** | `PRINT_ONLY` | Printer → Vision |
| **Laser Only** | `MARK_ONLY` | Laser → Vision |
| **Combined** | `PRINT_AND_MARK` | Printer → Laser → Vision |
| **Verify Only** | `VERIFY_ONLY` | Vision |
| **Rework** | `REWORK` | Depends on rework type |

---

## Workflow 1: Print Only (`PRINT_ONLY`)

Used when only a label needs to be printed and verified.

```
Factory Gateway
    │
    │ MQTT: UnifiedEvent { operation.type = "PRINT_ONLY" }
    ▼
MQTT Adapter
    │ Parse and validate payload
    │ Emit internal InboundMessageReceived event
    ▼
Job Engine
    │ Create Job (status=CREATED)
    │ Create JobAttempt (status=RUNNING)
    │ Determine print content (from recipe/payload)
    ▼
Printer Adapter
    │ Connect to printer (TCP 9100)
    │ Send ZPL/EPL content
    │ Wait for printer acknowledgement
    │ Return: SUCCESS / FAILURE
    ▼
Job Engine
    │ If FAILURE → mark attempt FAILED → retry or escalate
    │ If SUCCESS → continue to verification
    ▼
Vision Service
    │ Trigger camera scan
    │ Read barcode/QR/text
    │ Compare with expected content
    │ Return: VERIFIED_PASS / VERIFIED_FAIL / VERIFIED_RETRY
    ▼
Job Engine
    │ If VERIFIED_FAIL → retry scan (up to max retries)
    │ If VERIFIED_RETRY → wait and rescan
    │ If VERIFIED_PASS → mark Job COMPLETED
    ▼
Local SQLite Database
    │ Persist Job, JobAttempt, JobStep records
    │ Record verification result
    ▼
Sync Agent (MQTT Outbox)
    │ Publish result to Factory Gateway
    │ { event_type: "PRINT_COMPLETED", result: "PASS" }
    ▼
Factory Gateway
    └ Acknowledge receipt
```

### Error Paths

| Scenario | Action |
|---|---|
| Printer unreachable | Retry 3x → mark Job FAILED → alert operator |
| Print acknowledged but vision fails | Retry scan 3x → require operator intervention |
| Vision system offline | Mark verification as BYPASSED (only if configured) |
| Sync to Gateway fails | MQTT outbox retries indefinitely until ACK received |

---

## Workflow 2: Laser Only (`MARK_ONLY`)

Used when product marking is done directly on packaging without label printing.

```
Factory Gateway
    │
    │ MQTT: UnifiedEvent { operation.type = "MARK_ONLY" }
    ▼
MQTT Adapter
    │ Parse and validate payload
    │ Emit internal InboundMessageReceived event
    ▼
Job Engine
    │ Create Job (status=CREATED)
    │ Create JobAttempt (status=RUNNING)
    │ Determine marking content and type
    │   (marking.type = LASER_ETCHING / LASER_DOT_PEEN / etc.)
    ▼
Laser Adapter
    │ Connect to laser machine (TCP/SDK)
    │ Send marking command with content
    │ Wait for machine execution confirmation
    │ Return: SUCCESS / FAILURE
    ▼
Job Engine
    │ If FAILURE → retry → escalate
    │ If SUCCESS → continue to verification
    ▼
Vision Service
    │ Trigger camera scan over marked area
    │ OCR or barcode decode
    │ Compare against expected mark content
    │ Return: VERIFIED_PASS / VERIFIED_FAIL
    ▼
Job Engine
    │ Update Job status
    ▼
Local SQLite Database
    │ Persist all records
    ▼
Sync Agent
    │ Publish result: MARK_COMPLETED or MARK_FAILED
    ▼
Factory Gateway
```

---

## Workflow 3: Combined (`PRINT_AND_MARK`)

Used when both label printing and laser marking are required on the same product.

```
Factory Gateway
    │
    │ MQTT: UnifiedEvent { operation.type = "PRINT_AND_MARK" }
    ▼
MQTT Adapter
    │ Parse and validate full payload
    ▼
Job Engine
    │ Create Job
    │ Create JobAttempt
    │ Decompose into steps:
    │   Step 1: PRINT
    │   Step 2: LASER_MARK
    │   Step 3: VERIFY
    ▼
┌── Step 1: Printer Adapter ───────────────────────────────┐
│   Send ZPL/EPL content                                   │
│   Wait for print completion                              │
│   Return: SUCCESS / FAILURE                              │
└──────────────────────────────────────────────────────────┘
    │
    │ (continue only if Step 1 SUCCESS)
    ▼
┌── Step 2: Laser Adapter ─────────────────────────────────┐
│   Send marking command                                   │
│   Wait for laser execution                               │
│   Return: SUCCESS / FAILURE                              │
└──────────────────────────────────────────────────────────┘
    │
    │ (continue only if Step 2 SUCCESS)
    ▼
┌── Step 3: Vision Service ────────────────────────────────┐
│   Scan label (if printed)                                │
│   Scan mark (if laser)                                   │
│   Both must pass for VERIFIED_PASS                       │
└──────────────────────────────────────────────────────────┘
    │
    ▼
Job Engine
    │ If any step FAILED → handle per error path below
    │ If all PASS → mark Job COMPLETED
    ▼
Local SQLite Database → Sync Agent → Factory Gateway
```

### Step Failure Rules (Combined)

| Failed Step | Behavior |
|---|---|
| Print fails | Do NOT proceed to laser. Retry print. |
| Laser fails (print OK) | Retry laser only. Print stays. |
| Verification fails | Retry verification. If max retries → operator decision. |
| Operator approves REPRINT | Reprint only, then re-verify label |
| Operator approves RELASER | Relaser only, then re-verify mark |
| Operator approves FORCE_PASS | Record as VERIFIED_BYPASS, continue |
| Operator approves FORCE_COMPLETE | Complete job regardless of result |

---

## Workflow 4: Verify Only (`VERIFY_ONLY`)

Used for standalone quality inspection without triggering print/mark.

```
Factory Gateway → MQTT Adapter → Job Engine
    │ Create Job (VERIFY_ONLY)
    ▼
Vision Service
    │ Scan product
    │ OCR / barcode decode
    ▼
Job Engine → SQLite → Sync Agent → Factory Gateway
```

---

## Workflow 5: Rework (`REWORK`)

Used when a previously failed product is being reprocessed.

- A rework job references the original Job ID
- The system records the rework separately with `triggerType = OVERWRITE`
- Operator must be identified in the rework record
- After rework, standard verification applies

---

## PLC Integration in Workflows

The PLC communicates independently as a state reporter:

```
PLC Sensor (product detected)
    │ Digital I/O trigger
    ▼
PLC Adapter
    │ Read trigger signal
    │ Publish: PLC_TRIGGER_DETECTED event
    ▼
Job Engine (optional: auto-start job on PLC trigger)
```

PLC state machine:
```
LINE_IDLE → LINE_RUNNING → LINE_PAUSED → LINE_STOPPED
```

---

## Job Lifecycle State Machine

```
CREATED
    │
    ▼
QUEUED
    │
    ▼
PROCESSING ─────► WAIT_REWORK (operator input needed)
    │                   │
    │◄───────────────────┘
    │
    ├─► COMPLETED
    └─► FAILED
         │
         └─► CANCELLED (by operator)
```

---

## Timing and Timeouts

| Operation | Default Timeout | Retry Limit |
|---|---|---|
| Printer connection | 5 seconds | 3 |
| Printer send | 10 seconds | 3 |
| Laser execution | 30 seconds | 3 |
| Vision scan | 10 seconds | 3 |
| Gateway sync | No timeout | Infinite (outbox) |
