# CV-Hub Errata - Known Issues & Future Work

> Last updated: 2026-02-06

This document tracks known bugs, missing features, and technical debt in the CV-Hub platform.

---

## Critical Issues

### Authentication & Security
- [ ] **MFA recovery flow incomplete** - If user loses all MFA methods, no admin recovery path exists
- [ ] **Session invalidation on password change** - Other active sessions should be invalidated when password is changed

### CI/CD Pipeline
- [ ] **Worker crash recovery** - Worker processes don't automatically recover from Redis disconnections
- [ ] **Pipeline timeout handling** - Long-running jobs may hang without proper cleanup

---

## High Priority

### Frontend
- [ ] **Notification system placeholder** - Notification bell shows hardcoded data, no real notification backend
- [ ] **Repository file navigation** - Large repositories may have performance issues with file tree
- [ ] **Mobile responsiveness** - Settings and profile pages need mobile layout improvements

### Backend
- [ ] **Rate limiting per-user** - Current rate limiting is IP-based only
- [ ] **Audit log pagination** - Audit logs grow unbounded, needs pagination and archival
- [ ] **Graph sync reliability** - Knowledge graph sync can fail silently on large repos

### Infrastructure
- [ ] **Database connection pooling** - May need PgBouncer for production scale
- [ ] **Redis failover** - Single Redis instance, no cluster/sentinel setup
- [ ] **S3 lifecycle policies** - No cleanup of old artifacts/uploads

---

## Medium Priority

### Features Not Yet Implemented
- [ ] **Pull request reviews** - PR tab shows "coming soon"
- [ ] **Issues** - Issues tab shows "coming soon"
- [ ] **Repository settings page** - Settings tab in repo detail not implemented
- [ ] **Notifications page** - `/dashboard/notifications` route not created
- [ ] **Team/Organization billing** - No billing integration
- [ ] **Repository transfer** - Cannot transfer repos between users/orgs
- [ ] **Repository archive** - No archive functionality
- [ ] **Branch protection rules** - Basic structure exists but UI missing

### API
- [ ] **Webhook retry logic** - Failed webhooks are not retried
- [ ] **API versioning** - No versioning strategy for public API
- [ ] **OpenAPI spec** - No auto-generated API documentation

### Developer Experience
- [ ] **CLI tool** - No command-line interface for cv-hub
- [ ] **VS Code extension** - No IDE integration
- [ ] **GitHub App migration** - Manual token connection only

---

## Low Priority / Nice to Have

- [ ] **Dark/light theme toggle** - Currently dark-only
- [ ] **Keyboard shortcuts** - Limited keyboard navigation
- [ ] **Repository templates** - Cannot create repos from templates
- [ ] **Gist-like snippets** - No snippet sharing feature
- [ ] **Activity feed** - No global activity dashboard
- [ ] **Email notifications** - Transactional emails only, no notification preferences
- [ ] **i18n/localization** - English only

---

## Technical Debt

### Code Quality
- [ ] **Test coverage** - API tests exist but frontend tests minimal
- [ ] **E2E tests** - No Playwright/Cypress tests
- [ ] **Storybook** - No component documentation

### Dependencies
- [ ] **Node.js 20** - Currently running on Node 18, should upgrade
- [ ] **pnpm 10** - Running pnpm 9, newer version available
- [ ] **MUI v6** - Consider upgrading when stable

### Performance
- [ ] **Code splitting** - Bundle is 1.8MB, needs splitting
- [ ] **API response caching** - No cache headers on API responses
- [ ] **Image optimization** - No image CDN/optimization

---

## Recently Fixed

### 2026-02-06
- [x] ~~MFA infinite recursion bug~~ - Fixed `getUserId` calling itself
- [x] ~~Repository navigation blank page~~ - Fixed paths to use `/dashboard/repositories/...`
- [x] ~~Missing settings index page~~ - Added `/dashboard/settings` route
- [x] ~~Missing profile page~~ - Added `/dashboard/profile` route
- [x] ~~Notification bell not clickable~~ - Added dropdown menu

### 2026-02-05
- [x] ~~RDS SSL connection failure~~ - Added `rejectUnauthorized: false` for AWS RDS
- [x] ~~Redis TLS connection failure~~ - Added TLS options for ElastiCache
- [x] ~~Database credentials in code~~ - Moved to AWS Secrets Manager

---

## Reporting Issues

Internal team members can add issues directly to this document. External contributors should use the GitHub issues tracker (when available).
