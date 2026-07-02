# MES Platform — Architecture Document

This document outlines the architectural patterns, layers, communication, and design choices of the MES Platform.

## 1. Architectural Style: Modular Monolith

To support clean domain boundaries and prepare the system for eventual scaling into microservices, we implement a **Modular Monolith** pattern. 

### Key Properties
1. **Module Independence**: Every business capability is encapsulated in a dedicated module directory under `/modules/`.
2. **Database Isolation**: No module is allowed to query the database tables of another module. Cross-module data dependencies are resolved through **Application-level aggregation** (queries) or **Asynchronous Events** (mutations).
3. **Internal Interface boundaries**: Modules interact internally via public service methods or published RabbitMQ events.

```
+-------------------------------------------------------------------+
|                        MES Platform Monolith                      |
|                                                                   |
|  +------------------+   +------------------+   +---------------+  |
|  |     Identity     |   |    Workforce     |   |   Planning    |  |
|  |                  |   |                  |   |               |  |
|  | - Users, Auth    |   | - Workers, Skills|   | - Shifts      |  |
|  +------------------+   +------------------+   +---------------+  |
|           |                      ^                     ^          |
|           +---[Domain Events]----+---------------------+          |
|                                                                   |
+-------------------------------------------------------------------+
```

---

## 2. Decoupled Communication: Event-Driven Architecture

MES communicates with the edge computing system (**Station Agent**) and coordinate internal module actions using **Event-Driven Architecture (EDA)**.

- **Broker**: RabbitMQ
- **Routing exchange**: `mes.events` (Topic Exchange) for MES internal/external events.
- **Station exchange**: `station.events` (Topic Exchange) for Edge Station Agent events.
- **Guaranteed Delivery**: To prevent lost events due to network crashes, we use the **Transactional Outbox Pattern** (see Section 4).

---

## 3. Modular Directory Structure (DDD Layering)

Every module implements **Domain Driven Design (DDD)** layers to isolate business models from execution frameworks:

```
modules/<module_name>/
├── domain/
│   ├── entity/      # Aggregates, Entities, Value Objects, Domain Events
│   └── repository/  # Repository interfaces (ports)
├── application/
│   ├── service/     # Use case services (orchestrators)
│   └── dto/         # Request/Response Data Transfer Objects
├── infrastructure/
│   ├── persistence/ # GORM Repository implementations (adapters)
│   ├── model/       # GORM physical models
│   └── rbac/        # Module-specific security (e.g. Casbin setup)
└── presentation/
    ├── handler/     # HTTP Controller handlers
    └── route/       # Gin router registration
```

---

## 4. Transactional Outbox Pattern

To ensure database writes and message publishing are atomic, we avoid publishing directly to RabbitMQ inside business transactions.

### Workflow
1. **Write Transaction**: The application service mutates business aggregates. Domain events are recorded. The service persists the aggregates AND inserts the serialized events into the local `<module>_outbox_events` table within a single PostgreSQL database transaction.
2. **Asynchronous Polling**: A background `OutboxWorker` queries the outbox table for `pending` or `failed` events (under 5 retries).
3. **Dispatch**: The worker publishes the event to RabbitMQ.
4. **Mark Published**: Upon successful publish, the worker marks the event as `published` with a timestamp.

```
Service -> DB Transaction [ Save Business Data + Save Outbox Event ]
                              ↓
Background Worker -> Read Pending Events -> Publish to RabbitMQ -> Mark Published
```

---

## 5. Command Query Responsibility Segregation (CQRS)

While keeping a unified database per module, we segregate read and write concerns where performance is critical.

- **Commands (Writes)**: Processed by Application Services which mutate domain entities and persist via GORM.
- **Queries (Reads)**: Fetch thin DTOs or project records using raw SQL or lightweight database mappings (GORM preloads) directly, bypassing complex domain rules.

---

## 6. Technology Stack & Key Libraries

- **Go 1.24+**: Main programming language.
- **Gin**: High-performance HTTP web framework.
- **GORM**: Object Relational Mapper for PostgreSQL.
- **Redis**: Caching, Rate Limiting, Idempotency, Session management.
- **RabbitMQ**: AMQP message broker.
- **Casbin**: Permission-based Attribute/Role-Based Access Control (RBAC).
- **Zap**: Structured logging.
- **Viper**: Configuration loading.
- **golang-migrate**: Database migrations version control.
- **Testcontainers**: Isolated Docker dependencies for integration tests.
