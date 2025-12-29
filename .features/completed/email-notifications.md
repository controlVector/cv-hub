---
id: FEAT-005
title: Email notifications system
priority: high
effort: large
area: api
status: backlog
created: 2025-12-28
updated: 2025-12-28
depends_on: []
blocks: []
---

# Email notifications system

## Problem

Currently email verification tokens and password reset tokens are only logged to console. Users need to receive actual emails to verify their accounts and reset passwords.

## Solution

Implement a proper email service with:
1. Email templating (HTML + plain text)
2. SMTP transport (configurable)
3. Queue for async sending (optional)
4. Integration with existing auth flows

## Acceptance Criteria

- [ ] Email service abstraction with configurable transport
- [ ] HTML email templates with inline CSS
- [ ] Plain text fallback for all emails
- [ ] Email verification sends actual email
- [ ] Password reset sends actual email
- [ ] New device login notification email
- [ ] Templates are customizable
- [ ] Dev mode can log emails instead of sending
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Affected files:**
- `apps/api/src/services/email.service.ts` - new email service
- `apps/api/src/templates/` - email templates directory
- `apps/api/src/services/user.service.ts` - integrate email sending
- `apps/api/src/config/env.ts` - SMTP config already exists

**Key considerations:**
- Use `nodemailer` for SMTP transport
- Consider `mjml` for responsive email templates
- Add retry logic for failed sends
- Log all sent emails for debugging

**Email types needed:**
1. `verify-email` - Verify your email address
2. `password-reset` - Reset your password
3. `new-login` - New sign-in detected
4. `mfa-enabled` - MFA has been enabled
5. `password-changed` - Password was changed
