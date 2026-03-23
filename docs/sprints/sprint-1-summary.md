# Sprint 1 — Context Prediction Engine

Prompt file for Claude Code execution on cv-git.

See the full prompt at: docs/sprints/sprint-1-context-prediction-engine.md (local)

## Summary

Three-layer predictive context injection:
- Layer 1: Workflow transition model (Markov chain + EWMA)
- Layer 2: Personalized PageRank on knowledge graph  
- Layer 3: LinUCB contextual bandit for quality learning

Combined: score(node) = PPR × phase_weight × bandit_quality × freshness_decay

## Phases

1. Understand existing code
2. Types and schema (shared/types.ts)
3. Phase detector (core/context/phase-detector.ts)
4. Transition model (core/context/transition-model.ts)
5. Personalized PageRank (core/context/personalized-pagerank.ts)
6. Contextual bandit (core/context/contextual-bandit.ts)
7. Combined scorer (core/context/context-scorer.ts)
8. Graph methods (core/graph/index.ts additions)
9. MCP tools (cv_context_score, cv_context_phases)
10. CLI commands (cv context score, cv context phases)
11. Validation

## Performance Budget

< 100ms total per scoring call.
