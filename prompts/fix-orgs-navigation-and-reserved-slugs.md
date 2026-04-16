# Agent Dispatch Prompt — Fix /orgs/new Navigation Bug + Reserved Slug Validation

> **Issue:** controlvector/cv-hub#27
> **Dispatched:** 2026-04-16
> **Estimated effort:** 2–4 hours (one branch, one PR, tests included)
> **Deploy target:** hub.controlvector.io (production)
> **Priority:** High

---

## Task

You are fixing a routing bug in the CV-Hub web app and closing a related latent foot-gun in the org-slug validator. The full bug writeup is in **issue #27** (`controlvector/cv-hub`) — read it first before doing anything else.

There are **two bugs bundled here** because they share the same root blast radius (the `/orgs/` namespace) and shipping the nav fix without the validator fix leaves a known permanent foot-gun open:

- **Bug A:** In-app navigation in `apps/web/src/pages/orgs/` targets the unprefixed `/orgs/*` tree instead of the `/dashboard/orgs/*` tree. This makes "Create Organization" buttons land users in the public storefront route with `slug="new"`, producing 404s and no form.
- **Bug B:** The org slug validator accepts reserved words (`new`, `admin`, `api`, `settings`, etc.) as legal slugs. First time someone creates an org with `slug: "new"`, the public `/orgs/new` URL is permanently shadowed.

## Before you do anything

1. **Read issue #27 in full.** `CV-Hub:get_issue(owner="controlvector", repo="cv-hub", number=27)`. The issue has line-by-line diagnosis, the full reserved-slugs list, and acceptance criteria. Do not deviate from the acceptance criteria without discussing first.
2. **Read the key files** (don't re-derive them):
   - `apps/web/src/App.tsx` — routing structure, understand why the split exists
   - `apps/web/src/pages/orgs/OrganizationList.tsx` — two bad `navigate()` calls
   - `apps/web/src/pages/orgs/CreateOrganization.tsx` — two bad `navigate()` calls + slug sanitizer that needs reserved-words check
   - `apps/web/src/pages/orgs/OrganizationStorefront.tsx` — needs reserved-slug redirect guard
   - `apps/web/src/components/Layout.tsx` — grep for any `/orgs` nav target
   - `apps/api/src/routes/organizations.ts` — `createOrgSchema` validator needs reserved-words refinement
   - `apps/api/src/services/organization.service.ts` — `createOrganization` needs belt-and-suspenders check
3. **Check for a shared package:** look at `packages/shared/` structure. If there's a natural home for a `RESERVED_SLUGS` constant that both API and web can import, use it. If not, duplicate with a `// KEEP IN SYNC WITH <path>` comment in both copies. Don't over-engineer a shared package just for this.

## Discovery phase (do this before writing code)

Run this audit and report findings before making changes:

1. **Grep the entire `apps/web/src/` tree** for `/orgs` navigation targets:
   - `navigate('/orgs`
   - `to="/orgs`
   - `href="/orgs`
   - `Link to="/orgs`
   
   Classify each hit as:
   - **Correct, targets public storefront** (`/orgs/:slug` for a specific org the user is viewing publicly) — leave alone
   - **Incorrect, should be `/dashboard/orgs/*`** (any `navigate()` from an already-authenticated page that jumps out of the dashboard) — fix
   
   Post the audit results as a comment on issue #27 before proceeding.

2. **Database check (staging first, then production):**
   ```sql
   SELECT id, slug, name, created_at FROM organizations
   WHERE slug IN ('new', 'create', 'edit', 'settings', 'admin', 'api', 'auth',
                  'login', 'logout', 'register', 'dashboard', 'apps', 'orgs',
                  'me', 'my', 'profile', 'root', 'support', 'help', 'docs',
                  'www', 'mail', 'ftp', 'static', 'assets', 'public');
   ```
   
   If any rows come back, **stop and report on issue #27 before deploying the validator change**. Those orgs need to be renamed first (or the validator needs a grandfather exception). Shipping the validator with pre-existing reserved-slug orgs in the DB will not break them (the validator only runs on create), but it's a red flag worth human review.

## Fix scope

### Client-side changes

**File: `apps/web/src/pages/orgs/OrganizationList.tsx`**

Change both `navigate('/orgs/new')` calls (header button around line 64 and empty-state button around line 108) to `navigate('/dashboard/orgs/new')`.

Leave `navigate(\`/orgs/${org.slug}\`)` on the org card click unchanged — it's intentionally targeting the public storefront, per issue #27's acceptance-criteria discussion. Add an inline comment clarifying this is deliberate:
```tsx
// Intentional: card click takes members to the public storefront view.
// If you want an authenticated org home, add a /dashboard/orgs/:slug route.
```

**File: `apps/web/src/pages/orgs/CreateOrganization.tsx`**

1. Change both `navigate('/orgs')` calls (Back button around line 81, Cancel button around line 172) to `navigate('/dashboard/orgs')`.
2. Leave `navigate(\`/orgs/${org.slug}\`)` on successful create unchanged (same intentional-storefront pattern). Add same inline comment.
3. Import the shared `RESERVED_SLUGS` set (location depends on your discovery-phase decision).
4. Extend `handleSlugChange` so typing a reserved slug sets `slugError` to `'This slug is reserved and cannot be used'`. The submit button's existing `disabled={!!slugError}` logic will handle disable automatically — confirm.
5. Add a unit or component test that typing `new` into the slug field produces the error and disables submit.

**File: `apps/web/src/pages/orgs/OrganizationStorefront.tsx`**

Add a redirect guard near the top of the component:

```tsx
import { Navigate, useParams } from 'react-router-dom';
import { RESERVED_ORG_SLUGS } from '<shared path>';

const { slug } = useParams();
if (slug && RESERVED_ORG_SLUGS.has(slug)) {
  return <Navigate to={`/dashboard/orgs/${slug}`} replace />;
}
```

This ensures that even if the nav links are wrong (e.g., someone copies the URL), the 404-storm pattern can't happen.

**File: `apps/web/src/components/Layout.tsx`** (and anywhere else discovery turned up)

Fix any `/orgs` nav targets that should be `/dashboard/orgs`. The sidebar Organizations entry is the most likely hit.

### Server-side changes

**File: `apps/api/src/routes/organizations.ts`**

Extend `createOrgSchema` with a reserved-words refinement:

```ts
import { RESERVED_SLUGS } from '../services/reserved-slugs'; // or shared package path

const createOrgSchema = z.object({
  slug: z.string()
    .min(2).max(64)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens')
    .refine((s) => !RESERVED_SLUGS.has(s), 'This slug is reserved and cannot be used')
    .refine((s) => !s.startsWith('-') && !s.endsWith('-'), 'Slug cannot start or end with a hyphen'),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  logoUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
  isPublic: z.boolean().optional(),
});
```

The hyphen-boundary check is a free add while you're there — the current regex allows `-foo` and `foo-` which is ugly.

**File: `apps/api/src/services/organization.service.ts`**

Add a belt-and-suspenders check in `createOrganization`:

```ts
export async function createOrganization(
  input: NewOrganization,
  creatorUserId: string,
): Promise<Organization> {
  if (RESERVED_SLUGS.has(input.slug)) {
    throw new ConflictError('This slug is reserved and cannot be used');
  }
  // ... existing code
}
```

Rationale: defense in depth. Route validation is today's only entry point, but future code that calls the service directly (batch imports, admin tools, agents) should also be blocked.

**New file: `apps/api/src/services/reserved-slugs.ts`** (or shared package location)

```ts
/**
 * Slugs reserved for platform routes. Creating an org with any of these
 * slugs would shadow a real app route at /orgs/:slug.
 *
 * KEEP IN SYNC WITH apps/web/src/<location>/reserved-slugs.ts
 */
export const RESERVED_SLUGS = new Set<string>([
  // Route verbs
  'new', 'create', 'edit', 'settings', 'delete',
  // Auth paths
  'admin', 'auth', 'login', 'logout', 'register',
  // App tree paths
  'dashboard', 'apps', 'orgs',
  // Self-reference
  'me', 'my', 'profile',
  // Common reserved
  'root', 'support', 'help', 'docs',
  // Infra subdomains we'd never want to collide with
  'www', 'mail', 'ftp', 'static', 'assets', 'public', 'api',
]);
```

## Testing requirements

1. **API validator test** (`apps/api/src/routes/organizations.test.ts` or similar): every entry in `RESERVED_SLUGS` rejected with the expected error message; a few valid slugs accepted.
2. **API service test**: `createOrganization` with a reserved slug throws `ConflictError` without touching the DB.
3. **API integration test**: `POST /api/v1/orgs` with `slug: "new"` returns 400, no row in `organizations`, no row in `organization_members`, no credits seeded.
4. **Web component test** for `CreateOrganization`: typing `new` into the slug field sets the error and disables the submit button. Typing a valid slug clears the error and enables submit.
5. **Web component test** for `OrganizationStorefront`: rendering at `/orgs/new` produces a redirect element to `/dashboard/orgs/new` (not a fetch).
6. **E2E test if the project has Playwright/Cypress** (check — don't add a new framework for this): smoke test that clicking the "Create Organization" button from `/dashboard/orgs` lands on `/dashboard/orgs/new`.

## Out of scope for this PR

Do NOT expand scope into these even if tempted — file separate issues:

- Unifying the `/orgs/*` and `/dashboard/orgs/*` route trees (architectural question, deserves its own discussion)
- Building a `/dashboard/orgs/:slug` authenticated org home page (UX work, separate design conversation)
- Admin tools for renaming/reclaiming existing org slugs (only needed if your DB audit turns up hits)
- Org-scoped PAT management via MCP (related, but separate — see issue #26)
- Any changes to `OrganizationSettings.tsx` beyond the navigation audit

If your discovery phase turns up other `/orgs` navigation bugs outside the files listed above, include them in this PR — they're in-scope.

## Deliverable

1. One branch: `fix/orgs-navigation-and-reserved-slugs`
2. One PR against `main` in `controlvector/cv-hub` with:
   - The discovery-phase audit results posted as a PR description section
   - The code changes described above
   - All tests described in "Testing requirements"
   - A checklist matching the acceptance criteria from issue #27
   - PR description links to issue #27 and closes it on merge (`Closes #27`)
3. A DB check confirmation comment on the PR: "Staging: 0 orgs with reserved slugs. Production: <N> orgs with reserved slugs: [list if any]."
4. A deploy plan in the PR description:
   - Deploy order: API first, then web (so the validator is live before any client-side change might prompt a retry)
   - Smoke test steps to run against production post-deploy
   - Rollback command if the deploy goes wrong

## Deploy

After PR merges and CI passes:

1. Deploy API first (API change is strictly additive — new validation rejects invalid input, doesn't change existing behavior for valid input)
2. Deploy web after API is confirmed healthy
3. Run post-deploy smoke checks:
   - Load `hub.controlvector.io/dashboard/orgs`, click "Create Organization", confirm form renders at `/dashboard/orgs/new` with no 404s in the network tab
   - Attempt to submit with slug `new`, confirm inline error
   - Attempt `curl -X POST https://api.hub.controlvector.io/api/v1/orgs -d '{"slug":"new","name":"Test"}'` with a valid auth token, confirm 400 response
   - Load `hub.controlvector.io/orgs/new` directly in a browser, confirm clean redirect to `/dashboard/orgs/new`
4. Post deploy confirmation on issue #27 and close it

## Constraints

- **Do not** add a new shared package just for `RESERVED_SLUGS`. If `packages/shared/` exists and is set up for this, use it. Otherwise duplicate with a sync comment.
- **Do not** rename or repath `/dashboard/orgs/new` — that's the correct URL, don't change it.
- **Do not** change the storefront's public behavior beyond the reserved-slug redirect.
- **Do not** touch `OrganizationSettings.tsx` logic beyond navigation fixes.
- **Do not** "fix" the `/orgs/:slug` public storefront route to require auth. It's intentionally public.
- If any reserved-slug orgs already exist in prod, **stop and escalate to @schmotz** before shipping the validator change. Don't attempt auto-rename.

## If you get stuck

Common failure modes and how to handle them:

- **Grep turns up more `/orgs` nav bugs than expected:** fix them all in this PR, document in the audit section of the PR description.
- **`packages/shared/` doesn't have a clean pattern for plain constants:** duplicate, don't over-engineer.
- **A test framework isn't installed for web component tests:** write tests in whatever framework `apps/web/` already uses (check `package.json` for `vitest`/`jest`). Do not install a new test framework.
- **DB audit query fails (no prod DB access from your agent context):** request credentials or have @schmotz run the query. Don't deploy the validator without the audit result.
- **You discover the `/orgs/${slug}` post-create redirect is actively broken for members (not just suspicious):** add a third bug section to the PR, don't expand this ticket silently.
