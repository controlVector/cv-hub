import { db } from '../db';
import { auditLogs } from '../db/schema';
import { logger } from '../utils/logger';

export type AuditAction =
  // User authentication
  | 'user.register'
  | 'user.login'
  | 'user.login.mfa_required'
  | 'user.login.mfa_totp'
  | 'user.login.mfa_passkey'
  | 'user.login.mfa_backupCode'
  | 'user.logout'
  | 'user.password_reset_request'
  | 'user.password_reset_complete'
  | 'user.email_verify'
  | 'user.session_revoke'
  | 'user.sessions_revoke_all'
  // MFA
  | 'mfa.totp.setup_initiated'
  | 'mfa.totp.setup_completed'
  | 'mfa.totp.disabled'
  | 'mfa.totp.verified'
  | 'mfa.passkey.registered'
  | 'mfa.passkey.deleted'
  | 'mfa.passkey.verified'
  | 'mfa.backup_codes.regenerated'
  | 'mfa.backup_code.used'
  // OAuth
  | 'oauth.authorize'
  | 'oauth.authorize.denied'
  | 'oauth.token.issued'
  | 'oauth.token.refreshed'
  | 'oauth.token.revoked'
  | 'oauth.token.invalid_client'
  | 'oauth.token.invalid_code'
  | 'oauth.token.invalid_refresh'
  | 'oauth.client.create'
  | 'oauth.client.update'
  | 'oauth.client.delete'
  | 'oauth.client.secret_rotated'
  | 'oauth.authorization.revoked'
  // API Keys
  | 'api_key.created'
  | 'api_key.updated'
  | 'api_key.deleted';

interface AuditLogParams {
  userId?: string;
  action: AuditAction;
  resource?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failure';
  errorMessage?: string;
}

export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: params.userId,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      details: params.details,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      status: params.status,
      errorMessage: params.errorMessage,
    });
  } catch (error) {
    // Don't fail the request if audit logging fails
    logger.error('auth', 'Audit log failed', error as Error);
  }
}
