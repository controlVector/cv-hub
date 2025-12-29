import { eq, or } from 'drizzle-orm';
import { db } from '../db';
import { users, passwordCredentials } from '../db/schema';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateSecureToken, hashToken } from '../utils/crypto';
import { ConflictError, AuthenticationError } from '../utils/errors';
import { authLogger } from '../utils/logger';
import { sendVerificationEmail, sendPasswordResetEmail, sendPasswordChangedEmail } from './email.service';
import type { RegisterInput, AuthenticatedUser } from '@cv-hub/shared';

export async function createUser(input: RegisterInput): Promise<AuthenticatedUser> {
  // Check for existing user
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, input.email), eq(users.username, input.username)))
    .limit(1);

  if (existing.length > 0) {
    throw new ConflictError('Email or username already in use');
  }

  // Hash password
  const passwordHash = await hashPassword(input.password);

  // Generate email verification token
  const verificationToken = generateSecureToken(32);
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Create user
  const [user] = await db.insert(users).values({
    email: input.email,
    username: input.username,
    displayName: input.displayName || input.username,
    emailVerificationToken: hashToken(verificationToken),
    emailVerificationExpires: verificationExpires,
  }).returning();

  // Create password credential
  await db.insert(passwordCredentials).values({
    userId: user.id,
    passwordHash,
  });

  // Send verification email
  authLogger.debug('Verification token generated', { email: user.email, token: verificationToken });
  await sendVerificationEmail(user.email, user.username, verificationToken);

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl || '',
    emailVerified: user.emailVerified,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function authenticateUser(email: string, password: string): Promise<AuthenticatedUser> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email));

  if (!user) {
    throw new AuthenticationError('Invalid email or password');
  }

  const [credential] = await db
    .select()
    .from(passwordCredentials)
    .where(eq(passwordCredentials.userId, user.id));

  if (!credential) {
    throw new AuthenticationError('Invalid email or password');
  }

  const isValid = await verifyPassword(credential.passwordHash, password);
  if (!isValid) {
    throw new AuthenticationError('Invalid email or password');
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl || '',
    emailVerified: user.emailVerified,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function getUserById(userId: string): Promise<AuthenticatedUser | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl || '',
    emailVerified: user.emailVerified,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = hashToken(token);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.emailVerificationToken, tokenHash));

  if (!user || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
    throw new AuthenticationError('Invalid or expired verification token');
  }

  await db
    .update(users)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));
}

export async function requestPasswordReset(email: string): Promise<void> {
  const [user] = await db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(eq(users.email, email));

  if (!user) {
    // Don't reveal whether email exists
    return;
  }

  const resetToken = generateSecureToken(32);
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db
    .update(users)
    .set({
      passwordResetToken: hashToken(resetToken),
      passwordResetExpires: resetExpires,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Send password reset email
  authLogger.debug('Password reset token generated', { userId: user.id, token: resetToken });
  await sendPasswordResetEmail(user.email, user.username, resetToken);
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(token);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.passwordResetToken, tokenHash));

  if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
    throw new AuthenticationError('Invalid or expired reset token');
  }

  const passwordHash = await hashPassword(newPassword);

  // Update password
  await db
    .update(passwordCredentials)
    .set({
      passwordHash,
      updatedAt: new Date(),
    })
    .where(eq(passwordCredentials.userId, user.id));

  // Clear reset token
  await db
    .update(users)
    .set({
      passwordResetToken: null,
      passwordResetExpires: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Send password changed notification
  await sendPasswordChangedEmail(user.email, user.username);
}
