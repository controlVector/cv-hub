import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { mcpSessions } from '../db/schema';
import { generateSecureToken } from '../utils/crypto';
import type { MCPSessionContext } from './types';

// In-memory session state (initialized flag, etc.)
// The DB tracks persistence; this tracks ephemeral protocol state.
const sessionState = new Map<string, { initialized: boolean }>();

const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Create a new MCP session and return the session token.
 */
export async function createMCPSession(
  userId: string,
  clientId?: string,
): Promise<string> {
  const sessionToken = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);

  await db.insert(mcpSessions).values({
    sessionToken,
    userId,
    clientId: clientId || undefined,
    transport: 'streamable_http',
    status: 'active',
    expiresAt,
  });

  sessionState.set(sessionToken, { initialized: false });

  return sessionToken;
}

/**
 * Get session context from a session token.
 * Returns null if session is invalid/expired.
 */
export async function getMCPSession(
  sessionToken: string,
): Promise<MCPSessionContext | null> {
  const session = await db.query.mcpSessions.findFirst({
    where: and(
      eq(mcpSessions.sessionToken, sessionToken),
      eq(mcpSessions.status, 'active'),
    ),
  });

  if (!session) return null;

  // Check expiry
  if (session.expiresAt && session.expiresAt < new Date()) {
    await db
      .update(mcpSessions)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(mcpSessions.id, session.id));
    sessionState.delete(sessionToken);
    return null;
  }

  // Update last activity
  await db
    .update(mcpSessions)
    .set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(mcpSessions.id, session.id));

  const state = sessionState.get(sessionToken) || { initialized: false };

  return {
    sessionId: session.id,
    userId: session.userId,
    clientId: session.clientId || undefined,
    scopes: [], // Scopes come from the OAuth token, not the session
    initialized: state.initialized,
  };
}

/**
 * Mark a session as initialized (after successful initialize handshake).
 */
export function markSessionInitialized(sessionToken: string): void {
  const state = sessionState.get(sessionToken);
  if (state) {
    state.initialized = true;
  } else {
    sessionState.set(sessionToken, { initialized: true });
  }
}

/**
 * Close an MCP session.
 */
export async function closeMCPSession(sessionToken: string): Promise<void> {
  await db
    .update(mcpSessions)
    .set({ status: 'closed', updatedAt: new Date() })
    .where(eq(mcpSessions.sessionToken, sessionToken));

  sessionState.delete(sessionToken);
}
