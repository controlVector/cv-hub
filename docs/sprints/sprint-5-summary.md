# Sprint 5 — Integration + Feedback Loops

Prompt file for Claude Code execution on cv-git + cv-hub + cv-agent.

## Summary

Wire all four layers together. Bandit learns from task outcomes. Deploy events flow through task stream. Scorer feeds task dispatch. CLAUDE.md reflects deploy status. Transition model learns from all sessions (local + remote).

## Phases

1. Understand Sprints 1-4 output
2. Bandit feedback from task outcomes (cv-hub + cv-git)
3. Deploy events → task stream (cv-git + cv-hub)
4. Deploy outcomes → context manifold (cv-git)
5. Context scorer → task dispatch (cv-hub)
6. Cross-session transition learning (cv-git)
7. CLAUDE.md includes deploy status (cv-git)
8. cv deploy --report posts to CV-Hub (cv-git)
9. End-to-end integration verification script
10. Final validation

## Key Integration Points

- Task completes → bandit learns which context helped
- Deploy succeeds → Decision node created, CLAUDE.md updated
- Deploy fails → scorer learns to inject debug runbooks
- New task → scorer predicts context from all prior history
- "What's deployed?" → CLAUDE.md has the answer from the graph

## Depends On

Sprints 1-4 (all complete).
