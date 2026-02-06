# CV-Hub Release Notes

> Version history and changelog for the CV-Hub platform

---

## v0.2.0 - 2026-02-06

### Admin System
- Added global `isAdmin` flag to user accounts
- Created admin-only documentation viewer
- Added errata and release notes tracking

### Frontend Fixes
- **Settings page**: Added index page at `/dashboard/settings` with navigation to all settings
- **Profile page**: Added user profile page at `/dashboard/profile`
- **Notification bell**: Now opens a dropdown menu with placeholder notifications
- **Repository navigation**: Fixed blank page issue - all navigation now uses correct `/dashboard/repositories/...` paths

### Backend Fixes
- **MFA endpoints**: Fixed infinite recursion bug in `getUserId` helper function
- **Authentication**: Added `isAdmin` field to user type and API responses

### Infrastructure
- Added Sentry error reporting integration (API + Worker + Frontend)
- Created manual deploy script (`scripts/manual-deploy.sh`)

---

## v0.1.1 - 2026-02-05

### Infrastructure
- **Database**: Fixed RDS SSL/TLS connections with `rejectUnauthorized: false`
- **Redis**: Fixed ElastiCache TLS connections
- **Secrets**: Migrated database credentials to AWS Secrets Manager
- **CI/CD**: Fixed ECS task definitions and deployment pipeline

### Bug Fixes
- Fixed database hostname resolution (moved from internal DNS to RDS endpoint)
- Fixed PostgreSQL authentication with correct credentials
- Added missing `stripe_customer_id` column to users table

---

## v0.1.0 - 2026-02-01

### Initial Release

#### Core Features
- **Authentication**: Email/password auth with session management
- **MFA**: TOTP (authenticator apps), WebAuthn (passkeys), backup codes
- **Repositories**: Create, browse, and manage Git repositories
- **Code Browser**: File tree navigation with syntax highlighting
- **Knowledge Graph**: AI-powered code understanding and relationships

#### CI/CD Pipeline
- **Pipeline Builder**: Visual YAML editor for CI/CD workflows
- **Job Execution**: Docker-based job runner
- **GitHub Integration**: Webhook support for push/PR events

#### Organization Features
- **Organizations**: Create and manage organizations
- **Member Roles**: Owner, Admin, Member permissions
- **App Store**: Publish and discover apps/extensions

#### Developer Tools
- **API Tokens**: Personal access token management
- **OAuth Apps**: OAuth 2.0 application registration
- **Connections**: GitHub, GitLab, Bitbucket integrations

#### Infrastructure
- **AWS ECS**: Fargate-based container hosting
- **RDS PostgreSQL**: Managed database
- **ElastiCache Redis**: Session and queue storage
- **S3 + CloudFront**: Static asset hosting

---

## Versioning Policy

We use semantic versioning (SemVer):
- **Major** (1.0.0): Breaking API changes
- **Minor** (0.1.0): New features, backward compatible
- **Patch** (0.0.1): Bug fixes, no new features

---

## Upgrade Notes

### Upgrading to v0.2.0
1. Run database migration to add `is_admin` column:
   ```sql
   ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
   ```
2. Grant admin access to initial admins:
   ```sql
   UPDATE users SET is_admin = TRUE WHERE email IN ('admin@example.com');
   ```

### Upgrading to v0.1.1
- No manual steps required, infrastructure changes only

---

## Roadmap

### v0.3.0 (Planned)
- Pull request review system
- Issue tracking
- Email notification preferences
- Repository webhooks

### v0.4.0 (Planned)
- Billing integration (Stripe)
- Team plans
- Usage analytics
- API rate limiting per-user

### v1.0.0 (Target)
- Stable public API
- Full documentation
- Production SLA
