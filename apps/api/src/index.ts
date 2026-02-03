import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { startSshServer, getSshServerStatus } from './services/git/ssh-server';

logger.info('general', `Starting server in ${env.NODE_ENV} mode`);

serve({
  fetch: app.fetch,
  port: env.PORT,
}, async (info) => {
  logger.info('general', `HTTP server running at http://localhost:${info.port}`);

  // Start SSH server if enabled
  try {
    await startSshServer();
    const sshStatus = getSshServerStatus();
    if (sshStatus.running) {
      logger.info('general', `SSH server running at ${sshStatus.host}:${sshStatus.port}`);
    }
  } catch (error) {
    logger.error('general', 'Failed to start SSH server', error as Error);
  }
});
