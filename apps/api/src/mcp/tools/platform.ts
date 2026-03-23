/**
 * MCP Tools: Platform Status
 * Exposes platform health to AI agents via MCP
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../../config/env';

const startTime = Date.now();

async function checkService(fn: () => Promise<void>): Promise<{ status: 'up' | 'down'; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    await fn();
    return { status: 'up', latency_ms: Date.now() - start };
  } catch (err: any) {
    return { status: 'down', latency_ms: Date.now() - start, error: err.message };
  }
}

export function registerPlatformTools(server: McpServer) {
  server.tool(
    'cv_platform_status',
    'Get CV-Hub platform health status — check if API, database, graph, vector, and git services are operational',
    {},
    async () => {
      const services: Record<string, any> = {};
      services.api = { status: 'up', latency_ms: 0 };

      const [postgres, redis, falkordb, qdrant, git] = await Promise.all([
        checkService(async () => {
          const isRds = env.DATABASE_URL.includes('.rds.amazonaws.com');
          const pool = new Pool({
            connectionString: env.DATABASE_URL,
            ssl: isRds ? { rejectUnauthorized: false } : undefined,
            max: 1,
            connectionTimeoutMillis: 5000,
          });
          try { await pool.query('SELECT 1'); } finally { await pool.end(); }
        }),
        checkService(async () => {
          const client = createClient({ url: env.REDIS_URL });
          try { await client.connect(); await client.ping(); } finally { await client.quit().catch(() => {}); }
        }),
        checkService(async () => {
          const client = createClient({ url: env.FALKORDB_URL, password: env.FALKORDB_PASSWORD || undefined });
          try { await client.connect(); await client.ping(); } finally { await client.quit().catch(() => {}); }
        }),
        checkService(async () => {
          const qc = new QdrantClient({ url: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY || undefined });
          await qc.getCollections();
        }),
        checkService(async () => {
          const { promises: fs } = await import('fs');
          await fs.access(env.GIT_STORAGE_PATH);
        }),
      ]);

      services.postgres = postgres;
      services.redis = redis;
      services.falkordb = falkordb;
      services.qdrant = qdrant;
      services.git = git;
      services.mcp = { status: 'up', latency_ms: 0 };

      const anyDown = Object.values(services).some((s: any) => s.status === 'down');
      const criticalDown = services.postgres.status === 'down';
      const overall = criticalDown ? 'down' : anyDown ? 'degraded' : 'operational';

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: overall,
            timestamp: new Date().toISOString(),
            version: '0.1.0',
            uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
            services,
          }, null, 2),
        }],
      };
    },
  );
}
