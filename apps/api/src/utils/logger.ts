/**
 * Structured logging utility with debug flags
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.debug('auth', 'Session validated', { userId: '123' });
 *   logger.info('oauth', 'Token issued', { clientId: 'abc' });
 *   logger.error('db', 'Query failed', error);
 *
 * Enable debug logging via environment variables:
 *   DEBUG_AUTH=true     - Auth/session debugging
 *   DEBUG_OAUTH=true    - OAuth flow debugging
 *   DEBUG_DB=true       - Database query debugging
 *   DEBUG_ALL=true      - All debug logging
 */

import { env } from '../config/env';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogCategory = 'auth' | 'oauth' | 'db' | 'mfa' | 'api' | 'general' | 'ci';

interface LogContext {
  [key: string]: unknown;
}

// Check if debug is enabled for a category
function isDebugEnabled(category: LogCategory): boolean {
  // Check for DEBUG_ALL first
  if (process.env.DEBUG_ALL === 'true') return true;

  // Check category-specific flag
  const envKey = `DEBUG_${category.toUpperCase()}`;
  return process.env[envKey] === 'true';
}

// Format log message
function formatMessage(
  level: LogLevel,
  category: LogCategory,
  message: string,
  context?: LogContext | Error
): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${category}]`;

  if (context instanceof Error) {
    return `${prefix} ${message}: ${context.message}`;
  }

  if (context && Object.keys(context).length > 0) {
    // Redact sensitive fields
    const safeContext = redactSensitive(context);
    return `${prefix} ${message} ${JSON.stringify(safeContext)}`;
  }

  return `${prefix} ${message}`;
}

// Redact sensitive information from logs
function redactSensitive(obj: LogContext): LogContext {
  const sensitiveKeys = [
    'password', 'secret', 'token', 'accessToken', 'refreshToken',
    'clientSecret', 'code', 'authorization', 'cookie'
  ];

  const redacted: LogContext = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      if (typeof value === 'string' && value.length > 8) {
        redacted[key] = `${value.slice(0, 8)}...[REDACTED]`;
      } else {
        redacted[key] = '[REDACTED]';
      }
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitive(value as LogContext);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

export const logger = {
  /**
   * Debug level - only logs if debug is enabled for the category
   */
  debug(category: LogCategory, message: string, context?: LogContext | Error): void {
    if (isDebugEnabled(category)) {
      console.log(formatMessage('debug', category, message, context));
    }
  },

  /**
   * Info level - always logs in development, configurable in production
   */
  info(category: LogCategory, message: string, context?: LogContext): void {
    if (env.NODE_ENV !== 'production' || process.env.LOG_LEVEL !== 'error') {
      console.log(formatMessage('info', category, message, context));
    }
  },

  /**
   * Warning level - always logs
   */
  warn(category: LogCategory, message: string, context?: LogContext | Error): void {
    console.warn(formatMessage('warn', category, message, context));
  },

  /**
   * Error level - always logs
   */
  error(category: LogCategory, message: string, context?: LogContext | Error): void {
    console.error(formatMessage('error', category, message, context));
    if (context instanceof Error && context.stack) {
      console.error(context.stack);
    }
  },

  /**
   * Create a child logger with preset category
   */
  child(category: LogCategory) {
    return {
      debug: (message: string, context?: LogContext | Error) =>
        logger.debug(category, message, context),
      info: (message: string, context?: LogContext) =>
        logger.info(category, message, context),
      warn: (message: string, context?: LogContext | Error) =>
        logger.warn(category, message, context),
      error: (message: string, context?: LogContext | Error) =>
        logger.error(category, message, context),
    };
  },
};

// Pre-configured loggers for common use cases
export const authLogger = logger.child('auth');
export const oauthLogger = logger.child('oauth');
export const dbLogger = logger.child('db');
export const mfaLogger = logger.child('mfa');
