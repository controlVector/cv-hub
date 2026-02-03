---
id: FEAT-030
title: RAG Optimization for AI Assistant
priority: medium
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: [FEAT-029]
blocks: []
---

# RAG Optimization for AI Assistant

## Problem

The AI assistant retrieves context via vector similarity search, but there's no optimization for context window management, relevance scoring, or result deduplication. This leads to suboptimal responses when the context is too large or irrelevant.

## Solution

Implement intelligent context assembly that combines vector search results with graph relationships to build optimized prompts.

## Acceptance Criteria

- [ ] Service: `assembleContext(query, repoId, maxTokens)` - build optimized context
- [ ] Combine vector search results with knowledge graph relationships
- [ ] Re-rank results by relevance (not just vector distance)
- [ ] Deduplicate overlapping code snippets
- [ ] Token counting for context window management
- [ ] Include file-level context (imports, exports, class hierarchy)
- [ ] Prioritize: exact matches > semantic matches > structural relationships
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Files to modify:**
- `apps/api/src/services/assistant.service.ts` - Context assembly
- `apps/api/src/services/vector.service.ts` - Enhanced retrieval
- `apps/api/src/services/graph.service.ts` - Relationship queries

**Key considerations:**
- Use tiktoken for accurate token counting
- Max context size configurable per model
- Consider sliding window for large files
- Cache assembled contexts for repeated queries
- A/B test different ranking strategies
