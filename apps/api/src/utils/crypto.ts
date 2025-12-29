import { randomBytes, createHash, createCipheriv, createDecipheriv, scryptSync } from 'crypto';

export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Derive a 256-bit key from a password/secret
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

// AES-256-GCM encryption
export function encrypt(plaintext: string, secret: string): { encrypted: string; iv: string } {
  const iv = randomBytes(12);  // 96-bit IV for GCM
  const salt = randomBytes(16);
  const key = deriveKey(secret, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine salt + authTag + encrypted data
  const combined = Buffer.concat([salt, authTag, encrypted]);

  return {
    encrypted: combined.toString('base64'),
    iv: iv.toString('base64'),
  };
}

// AES-256-GCM decryption
export function decrypt(encryptedData: string, iv: string, secret: string): string {
  const ivBuffer = Buffer.from(iv, 'base64');
  const combined = Buffer.from(encryptedData, 'base64');

  // Extract salt (16 bytes), authTag (16 bytes), and encrypted data
  const salt = combined.subarray(0, 16);
  const authTag = combined.subarray(16, 32);
  const encrypted = combined.subarray(32);

  const key = deriveKey(secret, salt);

  const decipher = createDecipheriv('aes-256-gcm', key, ivBuffer);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}
