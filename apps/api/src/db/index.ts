import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

// RDS requires SSL but uses Amazon's CA which Node doesn't trust by default
const isRds = env.DATABASE_URL.includes('.rds.amazonaws.com');
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isRds ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
