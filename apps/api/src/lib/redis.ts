import { createClient, type RedisClientType } from 'redis';
import { env } from '../config/env';
import { dbLogger } from '../utils/logger';

let redis: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (!redis) {
    redis = createClient({ url: env.REDIS_URL });
    redis.on('error', (err) => dbLogger.error('Redis connection error', err));
    await redis.connect();
  }
  return redis;
}

// Store a challenge with TTL
export async function storeChallenge(key: string, challenge: string, ttlSeconds: number = 300): Promise<void> {
  const client = await getRedis();
  await client.setEx(key, ttlSeconds, challenge);
}

// Get and delete a challenge (one-time use)
export async function consumeChallenge(key: string): Promise<string | null> {
  const client = await getRedis();
  const challenge = await client.get(key);
  if (challenge) {
    await client.del(key);
  }
  return challenge;
}

// ==================== Device Authorization (RFC 8628) ====================

export interface DeviceAuthData {
  deviceCode: string;
  userCode: string;
  clientId: string;
  scopes: string[];
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: number;  // Unix timestamp ms
  interval: number;   // Polling interval in seconds
  lastPolledAt?: number;  // Unix timestamp ms
  status: 'pending' | 'approved' | 'denied' | 'expired';
  userId?: string;  // Set when user approves
  approvedScopes?: string[];  // Scopes user approved
}

const DEVICE_AUTH_PREFIX = 'device_auth:';
const USER_CODE_PREFIX = 'device_auth_user_code:';

// Store device authorization data
export async function storeDeviceAuth(deviceCode: string, data: DeviceAuthData, ttlSeconds: number): Promise<void> {
  const client = await getRedis();
  await client.setEx(
    `${DEVICE_AUTH_PREFIX}${deviceCode}`,
    ttlSeconds,
    JSON.stringify(data)
  );
}

// Get device authorization data by device code
export async function getDeviceAuth(deviceCode: string): Promise<DeviceAuthData | null> {
  const client = await getRedis();
  const data = await client.get(`${DEVICE_AUTH_PREFIX}${deviceCode}`);
  if (!data) return null;
  return JSON.parse(data) as DeviceAuthData;
}

// Update device authorization data (preserves TTL)
export async function updateDeviceAuth(deviceCode: string, updates: Partial<DeviceAuthData>): Promise<boolean> {
  const client = await getRedis();
  const key = `${DEVICE_AUTH_PREFIX}${deviceCode}`;

  // Get current data and TTL
  const [data, ttl] = await Promise.all([
    client.get(key),
    client.ttl(key),
  ]);

  if (!data || ttl <= 0) return false;

  const current = JSON.parse(data) as DeviceAuthData;
  const updated = { ...current, ...updates };

  await client.setEx(key, ttl, JSON.stringify(updated));
  return true;
}

// Delete device authorization data
export async function deleteDeviceAuth(deviceCode: string): Promise<void> {
  const client = await getRedis();
  await client.del(`${DEVICE_AUTH_PREFIX}${deviceCode}`);
}

// Store user code to device code mapping (hashed user code as key)
export async function storeUserCodeMapping(userCodeHash: string, deviceCode: string, ttlSeconds: number): Promise<void> {
  const client = await getRedis();
  await client.setEx(
    `${USER_CODE_PREFIX}${userCodeHash}`,
    ttlSeconds,
    deviceCode
  );
}

// Get device code by user code hash
export async function getDeviceCodeByUserCode(userCodeHash: string): Promise<string | null> {
  const client = await getRedis();
  return client.get(`${USER_CODE_PREFIX}${userCodeHash}`);
}

// Delete user code mapping
export async function deleteUserCodeMapping(userCodeHash: string): Promise<void> {
  const client = await getRedis();
  await client.del(`${USER_CODE_PREFIX}${userCodeHash}`);
}
