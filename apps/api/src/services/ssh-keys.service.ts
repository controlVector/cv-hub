/**
 * SSH Keys Service
 * Manages SSH public keys for git authentication
 */

import { createHash } from 'crypto';
import { db } from '../db';
import { sshKeys, users, type SshKey, type NewSshKey } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '../utils/errors';

// ============================================================================
// Types
// ============================================================================

export interface KeyValidationResult {
  valid: boolean;
  type?: string;
  fingerprint?: string;
  comment?: string;
  error?: string;
}

export interface SshKeyWithUser extends SshKey {
  user: {
    id: string;
    username: string;
    email: string;
  };
}

// ============================================================================
// Key Validation
// ============================================================================

const SUPPORTED_KEY_TYPES = ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'];

/**
 * Validate and parse an SSH public key
 */
export function validateKeyFormat(publicKey: string): KeyValidationResult {
  const trimmedKey = publicKey.trim();

  // Basic format validation: type base64data [comment]
  const parts = trimmedKey.split(/\s+/);
  if (parts.length < 2) {
    return { valid: false, error: 'Invalid key format. Expected: type base64data [comment]' };
  }

  const [keyType, keyData, ...commentParts] = parts;
  const comment = commentParts.join(' ') || undefined;

  // Validate key type
  if (!SUPPORTED_KEY_TYPES.includes(keyType)) {
    return {
      valid: false,
      error: `Unsupported key type: ${keyType}. Supported types: ${SUPPORTED_KEY_TYPES.join(', ')}`,
    };
  }

  // Validate base64 data
  try {
    const decoded = Buffer.from(keyData, 'base64');
    if (decoded.length < 32) {
      return { valid: false, error: 'Key data too short' };
    }

    // Verify the key data starts with the key type
    // SSH key format: uint32 length + type string + key data
    const typeLength = decoded.readUInt32BE(0);
    const embeddedType = decoded.slice(4, 4 + typeLength).toString('utf-8');
    if (embeddedType !== keyType) {
      return { valid: false, error: 'Key type mismatch in key data' };
    }
  } catch {
    return { valid: false, error: 'Invalid base64 key data' };
  }

  // Calculate fingerprint (SHA256)
  const fingerprint = calculateFingerprint(keyData);

  return {
    valid: true,
    type: keyType,
    fingerprint,
    comment,
  };
}

/**
 * Calculate SHA256 fingerprint of an SSH key
 */
export function calculateFingerprint(keyData: string): string {
  const decoded = Buffer.from(keyData, 'base64');
  const hash = createHash('sha256').update(decoded).digest('base64');
  // Remove padding and format as SHA256:base64
  return `SHA256:${hash.replace(/=+$/, '')}`;
}

/**
 * Get short key type name
 */
function getShortKeyType(fullType: string): string {
  const typeMap: Record<string, string> = {
    'ssh-ed25519': 'ed25519',
    'ssh-rsa': 'rsa',
    'ecdsa-sha2-nistp256': 'ecdsa',
    'ecdsa-sha2-nistp384': 'ecdsa',
    'ecdsa-sha2-nistp521': 'ecdsa',
  };
  return typeMap[fullType] || fullType;
}

// ============================================================================
// Key Management
// ============================================================================

/**
 * Add a new SSH key for a user
 */
export async function addKey(
  userId: string,
  title: string,
  publicKey: string
): Promise<SshKey> {
  // Validate key format
  const validation = validateKeyFormat(publicKey);
  if (!validation.valid) {
    throw new ValidationError(validation.error || 'Invalid SSH key');
  }

  // Check if key already exists (by fingerprint)
  const existingKey = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.fingerprint, validation.fingerprint!),
  });

  if (existingKey) {
    if (existingKey.userId === userId) {
      throw new ValidationError('This key has already been added to your account');
    } else {
      throw new ValidationError('This key is already in use by another account');
    }
  }

  // Insert the key
  const [key] = await db.insert(sshKeys).values({
    userId,
    title: title.trim(),
    publicKey: publicKey.trim(),
    fingerprint: validation.fingerprint!,
    keyType: getShortKeyType(validation.type!),
  }).returning();

  return key;
}

/**
 * Remove an SSH key
 */
export async function removeKey(userId: string, keyId: string): Promise<void> {
  const result = await db.delete(sshKeys)
    .where(and(
      eq(sshKeys.id, keyId),
      eq(sshKeys.userId, userId)
    ))
    .returning();

  if (result.length === 0) {
    throw new NotFoundError('SSH key not found');
  }
}

/**
 * List all SSH keys for a user
 */
export async function listKeys(userId: string): Promise<SshKey[]> {
  return db.query.sshKeys.findMany({
    where: eq(sshKeys.userId, userId),
    orderBy: (keys, { desc }) => [desc(keys.createdAt)],
  });
}

/**
 * Get a single SSH key by ID
 */
export async function getKey(keyId: string): Promise<SshKey | null> {
  const key = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.id, keyId),
  });
  return key || null;
}

/**
 * Find user by SSH public key
 * Used during SSH authentication
 */
export async function findUserByPublicKey(publicKey: string): Promise<SshKeyWithUser | null> {
  // Validate and get fingerprint
  const validation = validateKeyFormat(publicKey);
  if (!validation.valid) {
    return null;
  }

  return findUserByFingerprint(validation.fingerprint!);
}

/**
 * Find user by SSH key fingerprint
 * Used during SSH authentication
 */
export async function findUserByFingerprint(fingerprint: string): Promise<SshKeyWithUser | null> {
  const key = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.fingerprint, fingerprint),
    with: {
      user: true,
    },
  });

  if (!key) {
    return null;
  }

  return {
    ...key,
    user: {
      id: key.user.id,
      username: key.user.username,
      email: key.user.email,
    },
  };
}

/**
 * Update last used timestamp for a key
 */
export async function updateLastUsed(keyId: string): Promise<void> {
  await db.update(sshKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(sshKeys.id, keyId));
}

/**
 * Check if a user has any SSH keys
 */
export async function userHasKeys(userId: string): Promise<boolean> {
  const key = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.userId, userId),
  });
  return !!key;
}

/**
 * Get key count for a user
 */
export async function getKeyCount(userId: string): Promise<number> {
  const keys = await db.query.sshKeys.findMany({
    where: eq(sshKeys.userId, userId),
    columns: { id: true },
  });
  return keys.length;
}
