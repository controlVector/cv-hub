import { TOTP, Secret } from 'otpauth';
import * as QRCode from 'qrcode';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { totpCredentials, mfaMethods, users } from '../db/schema';
import { encrypt, decrypt } from '../utils/crypto';
import { env } from '../config/env';

const ISSUER = 'CV-Hub';
const DIGITS = 6;
const PERIOD = 30;  // 30 second time step (RFC 6238 default)
const ALGORITHM = 'SHA1';  // SHA1 is the RFC 6238 default, widely compatible

export interface TOTPSetupResult {
  secret: string;  // For manual entry (base32)
  qrCodeDataUrl: string;  // QR code as data URL
  backupUri: string;  // otpauth:// URI
}

// Generate a new TOTP secret for a user
export async function initializeTOTPSetup(userId: string, email: string): Promise<TOTPSetupResult> {
  // Generate a cryptographically secure secret
  const secret = new Secret({ size: 20 });  // 160 bits

  // Create the TOTP object
  const totp = new TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret,
  });

  // Get the otpauth URI for QR code
  const uri = totp.toString();

  // Generate QR code as data URL
  const qrCodeDataUrl = await QRCode.toDataURL(uri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 256,
  });

  // Encrypt the secret for storage
  const { encrypted, iv } = encrypt(secret.base32, env.MFA_ENCRYPTION_KEY);

  // Store the encrypted secret (unverified until user confirms with a code)
  await db.insert(totpCredentials)
    .values({
      userId,
      encryptedSecret: encrypted,
      iv,
      verified: false,
    })
    .onConflictDoUpdate({
      target: totpCredentials.userId,
      set: {
        encryptedSecret: encrypted,
        iv,
        verified: false,
      },
    });

  return {
    secret: secret.base32,
    qrCodeDataUrl,
    backupUri: uri,
  };
}

// Verify a TOTP code during setup (completes setup if valid)
export async function verifyTOTPSetup(userId: string, code: string): Promise<boolean> {
  const credential = await db.query.totpCredentials.findFirst({
    where: eq(totpCredentials.userId, userId),
  });

  if (!credential) {
    return false;
  }

  // Decrypt the secret
  const secretBase32 = decrypt(credential.encryptedSecret, credential.iv, env.MFA_ENCRYPTION_KEY);

  // Create TOTP instance
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });

  // Validate the code (allowing 1 time step window for clock skew)
  const delta = totp.validate({ token: code, window: 1 });

  if (delta === null) {
    return false;
  }

  // Mark as verified and enable MFA
  await db.transaction(async (tx) => {
    // Update credential as verified
    await tx.update(totpCredentials)
      .set({
        verified: true,
        verifiedAt: new Date(),
      })
      .where(eq(totpCredentials.userId, userId));

    // Create or update MFA method entry
    await tx.insert(mfaMethods)
      .values({
        userId,
        type: 'totp',
        enabled: true,
        primary: true,  // Make TOTP primary by default
      })
      .onConflictDoUpdate({
        target: [mfaMethods.userId, mfaMethods.type],
        set: {
          enabled: true,
          primary: true,
        },
      });

    // Enable MFA on user
    await tx.update(users)
      .set({ mfaEnabled: true, updatedAt: new Date() })
      .where(eq(users.id, userId));
  });

  return true;
}

// Verify a TOTP code during login
export async function verifyTOTPCode(userId: string, code: string): Promise<boolean> {
  const credential = await db.query.totpCredentials.findFirst({
    where: eq(totpCredentials.userId, userId),
  });

  if (!credential || !credential.verified) {
    return false;
  }

  // Decrypt the secret
  const secretBase32 = decrypt(credential.encryptedSecret, credential.iv, env.MFA_ENCRYPTION_KEY);

  // Create TOTP instance
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });

  // Validate the code (allowing 1 time step window for clock skew)
  const delta = totp.validate({ token: code, window: 1 });

  if (delta === null) {
    return false;
  }

  // Update last used timestamp for the method
  await db.update(mfaMethods)
    .set({ lastUsedAt: new Date() })
    .where(eq(mfaMethods.userId, userId));

  return true;
}

// Check if user has TOTP enabled
export async function hasTOTPEnabled(userId: string): Promise<boolean> {
  const credential = await db.query.totpCredentials.findFirst({
    where: eq(totpCredentials.userId, userId),
  });

  return credential?.verified ?? false;
}

// Disable TOTP for a user
export async function disableTOTP(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Delete TOTP credential
    await tx.delete(totpCredentials)
      .where(eq(totpCredentials.userId, userId));

    // Delete MFA method entry
    await tx.delete(mfaMethods)
      .where(eq(mfaMethods.userId, userId));

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

// Get TOTP credential info (without exposing secret)
export async function getTOTPInfo(userId: string): Promise<{ deviceName: string | null; createdAt: Date; verifiedAt: Date | null } | null> {
  const credential = await db.query.totpCredentials.findFirst({
    where: eq(totpCredentials.userId, userId),
    columns: {
      deviceName: true,
      createdAt: true,
      verifiedAt: true,
    },
  });

  return credential ?? null;
}
