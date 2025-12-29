import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env';
import { generateSecureToken } from '../utils/crypto';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiry format: ${expiry}`);

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };

  return value * multipliers[unit];
}

export async function generateAccessToken(userId: string, sessionId: string): Promise<string> {
  const jti = generateSecureToken(16);
  const expirySeconds = parseExpiry(env.JWT_ACCESS_EXPIRY);

  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${expirySeconds}s`)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<{
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  sid: string;
}> {
  const { payload } = await jwtVerify(token, accessSecret);

  return {
    sub: payload.sub as string,
    iat: payload.iat as number,
    exp: payload.exp as number,
    jti: payload.jti as string,
    sid: payload.sid as string,
  };
}

export function getAccessTokenExpiry(): number {
  return parseExpiry(env.JWT_ACCESS_EXPIRY);
}

export function getRefreshTokenExpiry(): Date {
  const seconds = parseExpiry(env.JWT_REFRESH_EXPIRY);
  return new Date(Date.now() + seconds * 1000);
}
