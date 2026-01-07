# CV-Hub Errata & Future Improvements

**Last Updated:** 2026-01-06
**Analysis Performed By:** Claude Code via cv-git explore
**Status:** Active Development

---

## Summary Metrics

| Metric | Count |
|--------|-------|
| Total TypeScript Files | 231 (78 API + 67 Web) |
| Test Coverage | ~3% (7 test files) |
| Type Safety Issues (`any`) | 246 instances |
| Critical TODOs/FIXMEs | 16 |
| High-Priority TODOs | 6 |
| Incomplete Features | 8 major |

---

## CRITICAL ISSUES (Fix Immediately)

### 1. API Key Encryption Not Implemented

**Location:** `apps/api/src/services/embedding.service.ts:220-232`

```typescript
function decryptApiKey(encrypted: string): string {
  // TODO: Implement proper encryption with env.MFA_ENCRYPTION_KEY
  // For now, just return as-is
  return encrypted;
}
```

**Impact:** API keys stored in plaintext. Database compromise exposes all user credentials.

**Also affects:** `apps/api/src/services/api-keys.service.ts`

**Fix Required:**
- Implement AES-256-GCM encryption
- Use proper key derivation (HKDF, not string concatenation)
- Rotate encryption keys periodically

---

### 2. Missing Authorization Checks

**Locations:**
- `apps/api/src/routes/app-store.ts:42-45` - `requireAdmin()` allows any authenticated user
- `apps/api/src/services/issue.service.ts:326` - `updateIssue` lacks permission check
- `apps/api/src/services/issue.service.ts:405` - `deleteIssue` lacks admin check
- `apps/api/src/services/issue.service.ts:515` - close/reopen lacks repo admin check
- `apps/api/src/services/pr.service.ts:310` - `updatePullRequest` lacks permission check
- `apps/api/src/services/pr.service.ts:551` - `dismissReview` lacks permission check
- `apps/api/src/routes/app-store.ts:555` - publish allows any authenticated user

**Impact:** Any authenticated user can modify issues, PRs, dismiss reviews, and publish apps.

**Fix Required:**
- Implement role-based access control (RBAC)
- Add `checkPermission(userId, resource, action)` middleware
- Define permission levels: owner, admin, maintainer, contributor, viewer

---

### 3. Incomplete Git Authentication

**Location:** `apps/api/src/routes/git.ts:100-102, 181-183`

```typescript
// TODO: Validate credentials (API key or user:password)
// For now, we'll require session auth
```

**Impact:** Git CLI operations (clone, push) can't authenticate with API keys, only session auth works.

**Fix Required:**
- Implement Basic Auth credential validation
- Support personal access tokens
- Add SSH key authentication

---

### 4. PR Merge Doesn't Actually Merge Code

**Location:** `apps/api/src/services/pr.service.ts:396-398`

```typescript
// TODO: Implement actual git merge via git backend
// For now, just update the PR state
```

**Impact:** UI shows merge succeeded but code is never actually merged.

**Fix Required:**
- Implement git merge via backend
- Handle merge conflicts
- Create merge commits with proper metadata

---

## HIGH PRIORITY (Fix This Sprint)

### 5. Pagination Count Bug

**Location:** `apps/api/src/routes/repositories.ts:92`

```typescript
total: repos.length, // TODO: implement proper count
```

**Impact:** Pagination metadata is wrong. UI shows incorrect page counts.

**Fix:** Execute `COUNT(*)` query before fetching paginated results.

---

### 6. Branch Loading Missing

**Location:** `apps/web/src/pages/CommitHistoryPage.tsx:96`

```typescript
branches={[]} // TODO: Load branches
```

**Impact:** Users can't switch branches in commit history view.

**Fix:** Fetch branches from `/api/v1/repos/:owner/:repo/branches` and populate selector.

---

### 7. Graph Sync Button Non-Functional

**Location:** `apps/web/src/pages/RepositoryDetail.tsx:106`

```typescript
const handleSyncGraph = async () => {
  // TODO: Implement graph sync trigger
  console.log('Triggering graph sync...');
};
```

**Impact:** No way to manually refresh knowledge graph.

**Fix:** Call `POST /api/v1/repos/:owner/:repo/graph/sync` endpoint.

---

## MEDIUM PRIORITY (Plan For)

### 8. Type Safety Issues (246 Instances)

**Pattern:** Excessive use of `any` type throughout codebase.

**Examples:**
- `catch (error: any)` - 50+ instances
- `function getRequestMeta(c: any)` - middleware helpers
- `z.record(z.any())` - unvalidated schemas

**Fix:**
- Replace `error: any` with `error: unknown` and proper type guards
- Type Hono context properly: `c: Context<AppEnv>`
- Define schemas for dynamic parameters

---

### 9. No API Service Tests (0% Coverage)

**Critical untested services:**
- `repository.service.ts`
- `pr.service.ts`
- `issue.service.ts`
- `embedding.service.ts`
- `oauth.service.ts`

**Fix:**
- Add unit tests for all service functions
- Add integration tests for API routes
- Target 80% coverage on critical paths

---

### 10. Excessive Console Logging

**Count:** 122 instances of `console.log/error/warn` in API

**Issues:**
- No structured logging
- Fire-and-forget error logging
- No correlation IDs

**Fix:**
- Use logger service consistently
- Add request correlation IDs
- Send errors to monitoring service

---

### 11. Mock Data in Production UI

**Pages with mock data:**
| Page | Mock Data | Backend Required |
|------|-----------|------------------|
| Dashboard.tsx | stats, recentRepos, aiInsights | Aggregation API |
| PullRequests.tsx | mockPRs, mockAIReviewIssues | PR service + AI review |
| KnowledgeGraph.tsx | mockNodes, mockEdges | FalkorDB integration |
| Search.tsx | mockResults | Qdrant vector search |
| AIAssistant.tsx | mockMessages | LLM integration |

**Fix:** Replace mock data with real API calls as backends are completed.

---

### 12. Inconsistent Error Handling

**Patterns found:**
```typescript
// Pattern 1: Untyped
} catch (error: any) { throw new Error(error.message); }

// Pattern 2: Silent failure
.catch(() => null)

// Pattern 3: Empty body on failure
const body = await c.req.json().catch(() => ({}));
```

**Fix:**
- Standardize error handling pattern
- Never silently swallow errors
- Log all caught errors with context

---

### 13. Weak Encryption Key Derivation

**Location:** `apps/api/src/services/api-keys.service.ts:35-38`

```typescript
function getEncryptionKey(userId: string): string {
  return `${env.MFA_ENCRYPTION_KEY}:${userId}`;
}
```

**Issue:** String concatenation is not cryptographically secure.

**Fix:** Use HKDF (HMAC-based Key Derivation Function) with proper salt.

---

## LOW PRIORITY (Backlog)

### 14. Accessibility Gaps

**Issues:**
- Only 5 instances of ARIA attributes in entire frontend
- No alt text for images/icons
- Limited keyboard navigation
- Graph visualization has no accessibility support

**Fix:**
- Add ARIA labels to interactive components
- Implement keyboard navigation for modals/menus
- Add screen reader support for data tables

---

### 15. Missing Documentation

**Gaps:**
- No OpenAPI/Swagger documentation
- No database schema documentation
- No architecture decision records (ADRs)
- No local development setup guide
- No contribution guidelines

**Fix:**
- Generate OpenAPI spec from Zod schemas
- Document database schema with ER diagram
- Create ADRs for major decisions
- Write comprehensive README

---

### 16. Fire-and-Forget Operations

**Location:** `apps/api/src/routes/git.ts:203-207`

```typescript
processPostReceive(repoId, refs).catch((err) => {
  console.error(`[Git Push] Sync failed...`);
});
```

**Issue:** User never knows if post-receive hook failed.

**Fix:**
- Use job queue (BullMQ) for async operations
- Implement retry logic
- Add failure notifications

---

### 17. Bundle Size Concerns

**Current sizes:**
- Web node_modules: 79MB
- API node_modules: 128MB

**Potential issues:**
- Duplicate dependencies
- Unused imports
- Large optional dependencies

**Fix:**
- Analyze with `npx depcheck`
- Tree-shake unused code
- Consider lighter alternatives

---

## Security Checklist

| Item | Status | Notes |
|------|--------|-------|
| API key encryption | NOT IMPLEMENTED | Critical - plaintext storage |
| Authorization checks | INCOMPLETE | Many routes bypass checks |
| Input validation | PARTIAL | Some schemas use `z.any()` |
| SQL injection prevention | OK | Using Drizzle ORM |
| XSS prevention | MOSTLY OK | 1 dangerouslySetInnerHTML |
| CSRF protection | OK | Using cookies with SameSite |
| Rate limiting | OK | Implemented in middleware |
| Secrets in code | LOW RISK | S3 key in scripts only |

---

## Missing Routes (Broken Navigation)

| Route | Referenced From | Status |
|-------|-----------------|--------|
| `/repositories/new` | Layout, Dashboard | No component |
| `/pull-requests/new` | PullRequests.tsx | No component |
| `/pull-requests/:id` | PullRequests.tsx | No component |
| `/settings` | Layout.tsx | Only security/developer exist |
| `/repos/:owner/:repo/graph` | RepositoryDetail.tsx | No route |
| `/repos/:owner/:repo/settings` | RepositoryDetail.tsx | No route |

---

## Stubbed Functions (Console.log Only)

| Function | Location | Status |
|----------|----------|--------|
| `handleSyncGraph()` | RepositoryDetail.tsx:106 | Logs only |
| Branch loading | CommitHistoryPage.tsx:96 | Hardcoded `[]` |
| Context menu actions | Repositories.tsx:394-398 | No-op |
| Graph toolbar buttons | KnowledgeGraph.tsx:306-440 | No handlers |
| Re-run AI Review | PullRequests.tsx:520 | No onClick |

---

## Recommended Roadmap

### Week 1 - Security
1. Implement API key encryption (AES-256-GCM)
2. Add authorization checks to all services
3. Fix encryption key derivation

### Week 2 - Core Functionality
4. Complete git merge implementation
5. Implement CLI authentication
6. Fix pagination queries
7. Add branch loading

### Week 3 - Testing
8. Add unit tests for services (target 80%)
9. Add integration tests for API routes
10. Fix existing test failures

### Week 4 - Polish
11. Replace mock data with real APIs
12. Implement graph sync
13. Add structured logging
14. Reduce type safety issues

### Ongoing
- Accessibility improvements
- Documentation
- Performance optimization
- Bundle size reduction

---

## References

- `docs/WEB_STATUS.md` - Previous UI audit
- `docs/AUTHENTICATION_DESIGN.md` - Auth architecture
- `apps/api/src/routes/*.ts` - Route implementations
- `apps/api/src/services/*.ts` - Service layer
