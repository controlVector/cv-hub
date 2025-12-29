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
