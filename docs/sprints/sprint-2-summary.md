# Sprint 2 — Context Manifold + Versioning

Prompt file for Claude Code execution on cv-git + cv-hub.

## Summary

CLAUDE.md becomes an auto-generated output from the FalkorDB context graph. Decisions, goals, constraints, architecture are graph nodes. Context is version-controlled alongside code. Sprint 1's scorer queries the manifold.

## Phases

1. Understand existing code (Sprint 1 output + cv-hub patterns)
2. New context types (shared/types.ts)
3. Graph methods for context nodes (core/graph)
4. CLAUDE.md generator (core/context/claudemd-generator.ts)
5. Context version snapshots (core/context/context-versioning.ts)
6. CLI commands (cv context add/query/export/diff/history/snapshot)
7. MCP tools (cv_context_add, cv_context_query, cv_context_export, cv_context_diff, cv_context_history)
8. Wire cv sync to include context manifold
9. Integrate manifold nodes into Sprint 1 context scorer
10. cv-hub context_versions table + API endpoints
11. Validation

## Key Design Decision

CLAUDE.md is an OUTPUT, not an input. The graph is the source of truth.

## Depends On

Sprint 1 (Context Prediction Engine) — complete.
