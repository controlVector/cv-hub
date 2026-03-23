# Sprint 4 — CV-Deploy

Prompt file for Claude Code execution on cv-git.

## Summary

Tagged deployment configurations where targets are graph nodes with YAML configs. `cv deploy push <target>` runs the right provider adapter. Four providers: DOKS, SSH, Fly.io, Docker Compose. Full lifecycle: preflight → build → push → deploy → health check → rollback.

## Phases

1. Understand existing code
2. Deploy types (shared/types.ts)
3. Config loader (YAML parsing + validation)
4. Provider interface + base class
5. DOKS provider (DigitalOcean Kubernetes)
6. SSH provider (rsync + systemctl)
7. Fly.io provider (flyctl)
8. Docker Compose provider
9. Deploy orchestrator (ties it all together + manifold recording)
10. CLI commands (cv deploy list/push/rollback/status/diff/init)
11. MCP tools (cv_deploy_list/push/rollback/status)
12. Sample deploy configs (hub-production, kv260-uav, tastytrade-mcp, local-dev)
13. Validation

## Depends On

Sprint 2 (DeployTarget context nodes) — complete.
