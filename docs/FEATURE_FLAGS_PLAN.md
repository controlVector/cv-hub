# Feature Flags System

## Overview

A feature flag system for CV-Hub that enables gradual rollouts, A/B testing, and kill switches. Integrates with the existing config management and CI/CD systems.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Flag** | A named toggle with key, type (boolean, string, number, JSON), and default value |
| **Environment** | Flags can have different states per environment (dev, staging, prod) |
| **Targeting Rule** | Conditions determining flag value (user attributes, percentage, segments) |
| **Segment** | Reusable user groups (beta testers, enterprise, internal) |
| **Context** | User/request attributes passed during evaluation (userId, email, plan, etc.) |

## Database Schema

### Tables (6 total)

**`feature_flags`** - Flag definitions
- Organization-scoped
- Key (unique per org), name, description
- Type: boolean, string, number, json
- Default value (serialized)
- Tags for organization
- Archived status

**`feature_flag_environments`** - Flag state per environment
- Links flag to environment
- Enabled/disabled toggle
- Override value (if different from default)
- Rollout percentage (0-100)

**`feature_flag_rules`** - Targeting rules
- Linked to flag + environment
- Priority order
- Conditions (JSON): attribute, operator, values
- Serve value when matched
- Percentage for gradual rollout

**`feature_flag_segments`** - User segments
- Organization-scoped
- Name, description
- Rule logic (AND/OR conditions)

**`feature_flag_segment_rules`** - Segment membership rules
- Attribute, operator, values
- Supports: equals, contains, startsWith, endsWith, regex, in, gt, lt, gte, lte

**`feature_flag_history`** - Audit trail
- Flag changes with before/after
- User who made change
- Timestamp

## API Endpoints

### Flag Management
```
POST   /api/flags                    - Create flag
GET    /api/flags                    - List flags (with filters)
GET    /api/flags/:key               - Get flag details
PUT    /api/flags/:key               - Update flag
DELETE /api/flags/:key               - Archive flag
POST   /api/flags/:key/restore       - Restore archived flag
```

### Environment Configuration
```
GET    /api/flags/:key/environments           - Get all environment configs
PUT    /api/flags/:key/environments/:env      - Update environment config
POST   /api/flags/:key/environments/:env/rules - Add targeting rule
PUT    /api/flags/:key/environments/:env/rules/:id - Update rule
DELETE /api/flags/:key/environments/:env/rules/:id - Delete rule
```

### Segments
```
POST   /api/flags/segments           - Create segment
GET    /api/flags/segments           - List segments
GET    /api/flags/segments/:id       - Get segment
PUT    /api/flags/segments/:id       - Update segment
DELETE /api/flags/segments/:id       - Delete segment
```

### Evaluation (for SDKs)
```
GET    /api/flags/evaluate/:key      - Evaluate single flag
POST   /api/flags/evaluate           - Bulk evaluate flags
GET    /api/flags/sdk/init           - Get all flags for SDK initialization
```

### History
```
GET    /api/flags/:key/history       - Get flag change history
```

## Evaluation Logic

```
1. Check if flag exists and is not archived
2. Get environment config (or use default)
3. If environment disabled → return default value
4. For each rule (by priority):
   a. Check if context matches all conditions
   b. If rule has segment, check segment membership
   c. If percentage set, hash(flagKey + userId) % 100 < percentage
   d. If matched → return rule's serve value
5. Apply environment rollout percentage
6. Return environment value or default
```

## Rule Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equals | `plan eq "enterprise"` |
| `neq` | Not equals | `country neq "US"` |
| `in` | In list | `userId in ["123", "456"]` |
| `notIn` | Not in list | `email notIn ["test@test.com"]` |
| `contains` | String contains | `email contains "@acme.com"` |
| `startsWith` | String starts with | `email startsWith "admin"` |
| `endsWith` | String ends with | `email endsWith ".gov"` |
| `matches` | Regex match | `version matches "^2\\."` |
| `gt`, `gte`, `lt`, `lte` | Numeric comparisons | `age gte 18` |
| `exists` | Attribute exists | `betaOptIn exists` |
| `semverGt`, `semverLt` | Semver comparison | `appVersion semverGt "2.0.0"` |

## Files to Create

### Backend
| File | Purpose |
|------|---------|
| `apps/api/src/db/schema/feature-flags.ts` | Drizzle schema |
| `apps/api/src/services/feature-flags.service.ts` | Core CRUD and evaluation |
| `apps/api/src/services/feature-flags-evaluator.ts` | Evaluation engine |
| `apps/api/src/routes/feature-flags.ts` | API routes |

### Frontend
| File | Purpose |
|------|---------|
| `apps/web/src/pages/flags/FlagList.tsx` | List all flags |
| `apps/web/src/pages/flags/FlagEditor.tsx` | Create/edit flag |
| `apps/web/src/pages/flags/SegmentList.tsx` | Manage segments |
| `apps/web/src/components/flags/RuleBuilder.tsx` | Visual rule builder |
| `apps/web/src/components/flags/TargetingPanel.tsx` | Environment targeting |

### Shared
| File | Purpose |
|------|---------|
| `packages/shared/src/types/feature-flags.ts` | TypeScript types |

### Migration
| File | Purpose |
|------|---------|
| `apps/api/drizzle/0028_feature_flags.sql` | Database migration |

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/app.ts` | Register feature-flags routes |
| `apps/web/src/App.tsx` | Add flag routes |
| `apps/web/src/components/Layout.tsx` | Add "Feature Flags" nav item |
| `apps/api/src/db/schema/index.ts` | Export feature-flags schema |
| `packages/shared/src/types/index.ts` | Export feature-flags types |

## Pricing Integration

| Feature | Starter | Pro | Enterprise |
|---------|---------|-----|------------|
| Flags | 5 | 50 | Unlimited |
| Segments | 0 | 10 | Unlimited |
| Environments | 1 | 3 | Unlimited |
| History (days) | 7 | 30 | 365 |
| API requests/mo | 10K | 100K | Unlimited |

## SDK Integration

JavaScript SDK example:
```typescript
import { FeatureFlags } from '@cv-hub/flags';

const flags = new FeatureFlags({
  apiKey: 'ff_xxx',
  environment: 'production',
});

// Initialize with user context
await flags.identify({
  userId: 'user-123',
  email: 'user@example.com',
  plan: 'pro',
  customAttributes: {
    company: 'Acme Inc',
    signupDate: '2024-01-15',
  },
});

// Evaluate flags
if (flags.isEnabled('new-checkout-flow')) {
  // Show new checkout
}

const variant = flags.getString('button-color', 'blue');
const limit = flags.getNumber('rate-limit', 100);
```

## CI/CD Integration

New step type for pipelines:
```yaml
steps:
  - uses: feature-flags@v1
    with:
      action: enable  # enable, disable, set-percentage
      flag: new-feature
      environment: production
      percentage: 50  # gradual rollout
```
