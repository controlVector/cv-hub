import type { Context, Next } from 'hono';
import { getRedis } from '../lib/redis';
import { RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const defaultConfig: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 100,
};

const strictConfig: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 5,             // Very strict for auth endpoints
};

function getClientIdentifier(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  return ip;
}

export function createRateLimiter(config: RateLimitConfig = defaultConfig) {
  return async (c: Context, next: Next) => {
    try {
      const redisClient = await getRedis();
      const identifier = getClientIdentifier(c);
      const path = c.req.path;
      const key = `ratelimit:${path}:${identifier}`;

      const current = await redisClient.incr(key);

      if (current === 1) {
        await redisClient.expire(key, Math.ceil(config.windowMs / 1000));
      }

      if (current > config.maxRequests) {
        throw new RateLimitError();
      }

      c.header('X-RateLimit-Limit', config.maxRequests.toString());
      c.header('X-RateLimit-Remaining', Math.max(0, config.maxRequests - current).toString());
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw error;
      }
      // If Redis fails, log but don't block the request
      logger.error('api', 'Rate limit middleware error', error as Error);
    }

    await next();
  };
}

export const rateLimiter = createRateLimiter(defaultConfig);
export const strictRateLimiter = createRateLimiter(strictConfig);
