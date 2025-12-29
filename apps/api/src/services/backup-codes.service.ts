import { randomBytes } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { backupCodes, mfaMethods, users } from '../db/schema';
import { hashToken } from '../utils/crypto';

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;  // 8 characters per code

// Generate a single backup code (human-readable format: XXXX-XXXX)
function generateBackupCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // No I, O, 0, 1 to avoid confusion
  let code = '';

  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    const randomIndex = randomBytes(1)[0] % chars.length;
    code += chars[randomIndex];
    if (i === 3) code += '-';  // Add dash in the middle
  }

  return code;
}

export interface BackupCodesResult {
  codes: string[];  // Plain text codes (only shown once)
}

// Generate new backup codes for a user (invalidates existing codes)
export async function generateBackupCodes(userId: string): Promise<BackupCodesResult> {
  const codes: string[] = [];
  const hashedCodes: { userId: string; codeHash: string }[] = [];

  // Generate codes
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = generateBackupCode();
    codes.push(code);
    hashedCodes.push({
      userId,
      codeHash: hashToken(code.replace('-', '')),  // Hash without the dash
    });
  }

  await db.transaction(async (tx) => {
    // Delete existing backup codes for this user
    await tx.delete(backupCodes)
      .where(eq(backupCodes.userId, userId));

    // Insert new codes
    await tx.insert(backupCodes).values(hashedCodes);

    // Ensure MFA method entry exists
    await tx.insert(mfaMethods)
      .values({
        userId,
        type: 'backup_codes',
        enabled: true,
        primary: false,
      })
      .onConflictDoNothing();
  });

  return { codes };
}

// Verify and consume a backup code
export async function verifyBackupCode(userId: string, code: string): Promise<boolean> {
  const normalizedCode = code.replace('-', '').toUpperCase();
  const codeHash = hashToken(normalizedCode);

  // Find matching unused code
  const matchingCode = await db.query.backupCodes.findFirst({
    where: and(
      eq(backupCodes.userId, userId),
      eq(backupCodes.codeHash, codeHash),
      eq(backupCodes.used, false),
    ),
  });

  if (!matchingCode) {
    return false;
  }

  // Mark code as used
  await db.update(backupCodes)
    .set({
      used: true,
      usedAt: new Date(),
    })
    .where(eq(backupCodes.id, matchingCode.id));

  // Update last used timestamp for the method
  await db.update(mfaMethods)
    .set({ lastUsedAt: new Date() })
    .where(and(
      eq(mfaMethods.userId, userId),
      eq(mfaMethods.type, 'backup_codes'),
    ));

  return true;
}

// Get remaining backup codes count
export async function getRemainingCodesCount(userId: string): Promise<number> {
  const unusedCodes = await db.query.backupCodes.findMany({
    where: and(
      eq(backupCodes.userId, userId),
      eq(backupCodes.used, false),
    ),
    columns: { id: true },
  });

  return unusedCodes.length;
}

// Check if user has backup codes
export async function hasBackupCodes(userId: string): Promise<boolean> {
  const count = await getRemainingCodesCount(userId);
  return count > 0;
}

// Revoke all backup codes for a user
export async function revokeBackupCodes(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Delete all backup codes
    await tx.delete(backupCodes)
      .where(eq(backupCodes.userId, userId));

    // Delete MFA method entry
    await tx.delete(mfaMethods)
      .where(and(
        eq(mfaMethods.userId, userId),
        eq(mfaMethods.type, 'backup_codes'),
      ));

    // Check if user has any other MFA methods
    const otherMethods = await tx.query.mfaMethods.findFirst({
      where: eq(mfaMethods.userId, userId),
    });

    // If no other methods, disable MFA on user
    if (!otherMethods) {
      await tx.update(users)
        .set({ mfaEnabled: false, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
  });
}
