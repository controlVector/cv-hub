import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';

logger.info('general', `Starting server in ${env.NODE_ENV} mode`);

serve({
  fetch: app.fetch,
  port: env.PORT,
}, (info) => {
  logger.info('general', `Server running at http://localhost:${info.port}`);
});
