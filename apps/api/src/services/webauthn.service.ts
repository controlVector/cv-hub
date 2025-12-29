import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  CredentialDeviceType,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { webauthnCredentials, mfaMethods, users } from '../db/schema';
import { storeChallenge, consumeChallenge } from '../lib/redis';
import { mfaLogger } from '../utils/logger';
import { env } from '../config/env';

// Relying Party configuration
const rpName = 'CV-Hub';
const rpID = new URL(env.APP_URL).hostname;
const origin = env.APP_URL;

const CHALLENGE_TTL = 300;  // 5 minutes

// Get user's existing passkeys for exclusion during registration
async function getUserPasskeys(userId: string) {
  return db.query.webauthnCredentials.findMany({
    where: eq(webauthnCredentials.userId, userId),
  });
}

// Generate registration options for adding a new passkey
export async function generatePasskeyRegistration(
  userId: string,
  username: string,
  displayName: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existingCredentials = await getUserPasskeys(userId);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: Buffer.from(userId),
    userName: username,
    userDisplayName: displayName,
    attestationType: 'none',  // We don't need attestation for consumer apps
    excludeCredentials: existingCredentials.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',  // Prefer platform authenticators (Touch ID, Face ID, Windows Hello)
    },
  });

  // Store challenge for verification
  await storeChallenge(`webauthn:reg:${userId}`, options.challenge, CHALLENGE_TTL);

  return options;
}

// Verify registration response and save the new passkey
export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  deviceName?: string,
): Promise<{ verified: boolean; credentialId?: string }> {
  // Get the stored challenge
  const expectedChallenge = await consumeChallenge(`webauthn:reg:${userId}`);
  if (!expectedChallenge) {
    return { verified: false };
  }

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (error) {
    mfaLogger.error('WebAuthn registration verification failed', error as Error);
    return { verified: false };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false };
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Store the credential
  await db.transaction(async (tx) => {
    await tx.insert(webauthnCredentials).values({
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: response.response.transports ? JSON.stringify(response.response.transports) : null,
      deviceName: deviceName || 'Passkey',
      aaguid: verification.registrationInfo?.aaguid,
      backupEligible: credentialDeviceType === 'multiDevice',
      backupState: credentialBackedUp,
    });

    // Create or update MFA method entry
    await tx.insert(mfaMethods)
      .values({
        userId,
        type: 'webauthn',
        enabled: true,
        primary: false,
      })
      .onConflictDoNothing();

    // Enable MFA on user if not already
    await tx.update(users)
      .set({ mfaEnabled: true, updatedAt: new Date() })
      .where(eq(users.id, userId));
  });

  return { verified: true, credentialId: credential.id };
}

// Generate authentication options for passkey login
export async function generatePasskeyAuthentication(
  userId?: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;

  // If we know the user, only allow their registered credentials
  if (userId) {
    const credentials = await getUserPasskeys(userId);
    allowCredentials = credentials.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    }));
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials,
  });

  // Store challenge - use userId if known, otherwise use the challenge itself as key
  const challengeKey = userId ? `webauthn:auth:${userId}` : `webauthn:auth:anon:${options.challenge}`;
  await storeChallenge(challengeKey, options.challenge, CHALLENGE_TTL);

  return options;
}

// Verify authentication response
export async function verifyPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  userId?: string,
): Promise<{ verified: boolean; userId?: string; credentialId?: string }> {
  // Find the credential
  const credential = await db.query.webauthnCredentials.findFirst({
    where: eq(webauthnCredentials.credentialId, response.id),
  });

  if (!credential) {
    return { verified: false };
  }

  // If userId provided, verify it matches
  if (userId && credential.userId !== userId) {
    return { verified: false };
  }

  // Get the stored challenge
  const challengeKey = userId ? `webauthn:auth:${userId}` : `webauthn:auth:anon:${response.clientExtensionResults}`;
  const expectedChallenge = await consumeChallenge(challengeKey);

  // Try anonymous challenge if user-specific not found
  if (!expectedChallenge && !userId) {
    // For discoverable credentials, we need a different approach
    // The challenge was stored with the options, so we need to accept any valid challenge
  }

  if (!expectedChallenge) {
    return { verified: false };
  }

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, 'base64url'),
        counter: credential.counter,
        transports: credential.transports ? JSON.parse(credential.transports) : undefined,
      },
    });
  } catch (error) {
    mfaLogger.error('WebAuthn authentication verification failed', error as Error);
    return { verified: false };
  }

  if (!verification.verified) {
    return { verified: false };
  }

  // Update the credential counter and last used timestamp
  await db.transaction(async (tx) => {
    await tx.update(webauthnCredentials)
      .set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      })
      .where(eq(webauthnCredentials.id, credential.id));

    // Update last used timestamp for the method
    await tx.update(mfaMethods)
      .set({ lastUsedAt: new Date() })
      .where(and(
        eq(mfaMethods.userId, credential.userId),
        eq(mfaMethods.type, 'webauthn'),
      ));
  });

  return {
    verified: true,
    userId: credential.userId,
    credentialId: credential.credentialId,
  };
}

// Check if user has passkeys
export async function hasPasskeys(userId: string): Promise<boolean> {
  const credentials = await getUserPasskeys(userId);
  return credentials.length > 0;
}

// List user's passkeys
export async function listPasskeys(userId: string): Promise<{
  id: string;
  deviceName: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  backupEligible: boolean;
}[]> {
  const credentials = await db.query.webauthnCredentials.findMany({
    where: eq(webauthnCredentials.userId, userId),
    columns: {
      id: true,
      deviceName: true,
      createdAt: true,
      lastUsedAt: true,
      backupEligible: true,
    },
    orderBy: (creds, { desc }) => [desc(creds.createdAt)],
  });

  return credentials;
}

// Delete a specific passkey
export async function deletePasskey(userId: string, credentialId: string): Promise<boolean> {
  const result = await db.delete(webauthnCredentials)
    .where(and(
      eq(webauthnCredentials.userId, userId),
      eq(webauthnCredentials.id, credentialId),
    ))
    .returning({ id: webauthnCredentials.id });

  if (result.length === 0) {
    return false;
  }

  // Check if user has any remaining passkeys
  const remainingPasskeys = await getUserPasskeys(userId);
  if (remainingPasskeys.length === 0) {
    // Check if user has any other MFA methods
    const otherMethods = await db.query.mfaMethods.findFirst({
      where: and(
        eq(mfaMethods.userId, userId),
        eq(mfaMethods.enabled, true),
      ),
    });

    // If no other methods, disable MFA
    if (!otherMethods) {
      await db.update(users)
        .set({ mfaEnabled: false, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    // Delete the webauthn method entry
    await db.delete(mfaMethods)
      .where(and(
        eq(mfaMethods.userId, userId),
        eq(mfaMethods.type, 'webauthn'),
      ));
  }

  return true;
}
