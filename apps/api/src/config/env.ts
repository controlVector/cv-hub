import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // App
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:3000'),

  // CSRF
  CSRF_SECRET: z.string().min(32),

  // MFA
  MFA_ENCRYPTION_KEY: z.string().min(32).default('dev-mfa-encryption-key-change-in-prod'),

  // Email (optional for dev)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),

  // GitHub API (for release sync)
  GITHUB_TOKEN: z.string().optional(),

  // GitHub OAuth (for user repo connections)
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Storage (for release assets)
  STORAGE_TYPE: z.enum(['local', 's3', 'github']).default('github'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  LOCAL_STORAGE_PATH: z.string().default('./storage'),

  // Git Storage (for bare repositories)
  GIT_STORAGE_PATH: z.string().default('./git-repos'),
  GIT_HOOK_SECRET: z.string().min(16).optional(),

  // FalkorDB (Graph Database - same as cv-git)
  FALKORDB_URL: z.string().url().default('redis://localhost:6381'),
  FALKORDB_PASSWORD: z.string().optional(),

  // Qdrant (Vector Database - same as cv-git)
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional(),

  // Embeddings (for semantic search)
  OPENROUTER_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('openai/text-embedding-3-small'),

  // Graph Sync Worker Settings
  GRAPH_SYNC_CONCURRENCY: z.coerce.number().default(2),
  GRAPH_SYNC_TIMEOUT: z.coerce.number().default(600000), // 10 minutes
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }

  return result.data;
}

export const env = loadEnv();
