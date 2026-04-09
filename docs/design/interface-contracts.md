# CV-Hub: Interface Contracts — Cross-System Schema Integrity

## Problem Statement

When multiple AI agents work across different repositories, interface contracts
between systems are described in prose in separate task prompts. Each agent
implements its own interpretation, leading to schema mismatch at integration
boundaries. This was observed on 2026-04-09 when nyx-edge (KV260) and NyxForge
(Z840 dashboard) had identical top-level JSON keys but the dashboard failed to
recognize every telemetry message because it checked for a field path that
didn't match the actual serialization.

## Proposed Solution

Interface contracts become first-class entities in CV-Hub:

1. **Contract Registry** — machine-readable schemas (JSON Schema, protobuf,
   OpenAPI) registered with producer and consumer annotations
2. **Task-Time Injection** — when dispatching a task that touches a contract
   participant, CV-Hub injects the schema into the task context automatically
3. **Post-Task Validation** — after a task modifies a producer, CV-Hub compares
   the new code against the registered schema and flags drift
4. **Consumer Notification** — when a contract version bumps, all consumers
   are notified (issue created, or task auto-dispatched)
5. **Graph-Based Drift Detection** — the knowledge graph tracks serialization
   boundaries (serde::Serialize in Rust, JSON.parse in TypeScript) and detects
   mismatches without explicit registration

## Data Model

```sql
CREATE TABLE interface_contracts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    schema_format TEXT NOT NULL,       -- json-schema, protobuf, openapi
    schema_content TEXT NOT NULL,
    version TEXT NOT NULL,
    transport TEXT,                    -- websocket, http, grpc, mqtt
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contract_participants (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES interface_contracts(id),
    role TEXT NOT NULL,                -- producer, consumer
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    file_path TEXT,
    symbol_name TEXT,
    notes TEXT
);
```

## MCP Tools

- `cv_register_contract` — register or update a contract schema
- `cv_check_contract` — validate a file against its contract(s)
- `cv_list_contracts` — list contracts a file or repo participates in

## Implementation Priority

1. Contract table + API endpoints (1 week)
2. Task-time injection into create_task pipeline (1 week)
3. Post-task validation in git safety net (1 week)
4. Graph-based drift detection (2 weeks)

## Context Manifold Paper Reference

This is Section 4.3 — "Cross-Repository Semantic Integrity." The contract
registry is the storage layer, the knowledge graph is the detection layer,
and task injection is the enforcement layer.
