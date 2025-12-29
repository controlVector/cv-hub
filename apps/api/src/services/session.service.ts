import { eq, lt, and, gt } from 'drizzle-orm';
import { db } from '../db';
import { sessions } from '../db/schema';
import { generateSecureToken, hashToken } from '../utils/crypto';
import { getRefreshTokenExpiry } from './token.service';

export interface CreateSessionParams {
  userId: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionWithToken {
  sessionId: string;
  refreshToken: string;
}

export async function createSession(params: CreateSessionParams): Promise<SessionWithToken> {
  const refreshToken = generateSecureToken(32);
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshTokenExpiry();

  const [session] = await db.insert(sessions).values({
    userId: params.userId,
    refreshTokenHash,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    expiresAt,
  }).returning({ id: sessions.id });

  return {
    sessionId: session.id,
    refreshToken,
  };
}

export async function validateRefreshToken(
  sessionId: string,
  refreshToken: string
): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(refreshToken);

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session || session.refreshTokenHash !== tokenHash || session.expiresAt < new Date()) {
    return null;
  }

  // Update last active
  await db
    .update(sessions)
    .set({ lastActiveAt: new Date() })
    .where(eq(sessions.id, sessionId));

  return { userId: session.userId };
}

export async function rotateRefreshToken(sessionId: string): Promise<string> {
  const newToken = generateSecureToken(32);
  const newHash = hashToken(newToken);
  const expiresAt = getRefreshTokenExpiry();

  await db
    .update(sessions)
    .set({
      refreshTokenHash: newHash,
      expiresAt,
      lastActiveAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));

  return newToken;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function getUserSessions(userId: string) {
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      createdAt: sessions.createdAt,
      lastActiveAt: sessions.lastActiveAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sessions.lastActiveAt);
}

export async function cleanupExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

// Get user ID from session (for cookie-based auth without refresh token)
export async function getSessionUser(sessionId: string): Promise<{ userId: string } | null> {
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      gt(sessions.expiresAt, new Date()),
    ),
  });

  if (!session) return null;

  return { userId: session.userId };
}
