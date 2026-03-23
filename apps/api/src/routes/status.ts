/**
 * Status Route
 * Returns per-service health checks for diagnostics
 */

import { Hono } from 'hono';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../config/env';

const statusRoutes = new Hono();

const startTime = Date.now();

interface ServiceStatus {
  status: 'up' | 'down';
  latency_ms: number;
  error?: string;
}

async function checkService(name: string, fn: () => Promise<void>): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    await fn();
    return { status: 'up', latency_ms: Date.now() - start };
  } catch (err: any) {
    return { status: 'down', latency_ms: Date.now() - start, error: err.message };
  }
}

statusRoutes.get('/api/status', async (c) => {
  const services: Record<string, ServiceStatus> = {};

  // API — always up if responding
  services.api = { status: 'up', latency_ms: 0 };

  // Run checks in parallel
  const [postgres, redis, falkordb, qdrant, git] = await Promise.all([
    // Postgres
    checkService('postgres', async () => {
      const isRds = env.DATABASE_URL.includes('.rds.amazonaws.com');
      const pool = new Pool({
        connectionString: env.DATABASE_URL,
        ssl: isRds ? { rejectUnauthorized: false } : undefined,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      try {
        const result = await pool.query('SELECT 1');
        if (!result.rows.length) throw new Error('Empty result');
      } finally {
        await pool.end();
      }
    }),

    // Redis
    checkService('redis', async () => {
      const client = createClient({ url: env.REDIS_URL });
      try {
        await client.connect();
        await client.ping();
      } finally {
        await client.quit().catch(() => {});
      }
    }),

    // FalkorDB
    checkService('falkordb', async () => {
      const client = createClient({
        url: env.FALKORDB_URL,
        password: env.FALKORDB_PASSWORD || undefined,
      });
      try {
        await client.connect();
        await client.ping();
      } finally {
        await client.quit().catch(() => {});
      }
    }),

    // Qdrant
    checkService('qdrant', async () => {
      const qdrantClient = new QdrantClient({
        url: env.QDRANT_URL,
        apiKey: env.QDRANT_API_KEY || undefined,
      });
      const collections = await qdrantClient.getCollections();
      if (!collections) throw new Error('No response');
    }),

    // Git storage
    checkService('git', async () => {
      const { promises: fs } = await import('fs');
      await fs.access(env.GIT_STORAGE_PATH);
    }),
  ]);

  services.postgres = postgres;
  services.redis = redis;
  services.falkordb = falkordb;
  services.qdrant = qdrant;
  services.git = git;

  // MCP — in-process check
  services.mcp = { status: 'up', latency_ms: 0 };

  // Determine overall status
  const allStatuses = Object.values(services);
  const anyDown = allStatuses.some((s) => s.status === 'down');
  const criticalDown = services.postgres.status === 'down' || services.api.status === 'down';
  const overall = criticalDown ? 'down' : anyDown ? 'degraded' : 'operational';

  return c.json({
    status: overall,
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    services,
  });
});

export default statusRoutes;
