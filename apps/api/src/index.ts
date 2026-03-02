import './instrument';
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { startSshServer, getSshServerStatus } from './services/git/ssh-server';
import { registerAllMCPTools } from './mcp/register-tools';
import { sweepStaleExecutors } from './services/executor.service';

logger.info('general', `Starting server in ${env.NODE_ENV} mode`);

// Register MCP tools
registerAllMCPTools();

serve({
  fetch: app.fetch,
  port: env.PORT,
}, async (info) => {
  logger.info('general', `HTTP server running at http://localhost:${info.port}`);

  // Start executor heartbeat sweep (every 60s, marks stale executors offline)
  setInterval(async () => {
    try {
      const swept = await sweepStaleExecutors(5);
      if (swept > 0) {
        logger.info('executors', `Swept ${swept} stale executor(s) → offline`);
      }
    } catch (err) {
      logger.error('executors', 'Heartbeat sweep failed', err as Error);
    }
  }, 60_000);

  // Run initial sweep on startup
  sweepStaleExecutors(5)
    .then((n) => n > 0 && logger.info('executors', `Initial sweep: ${n} stale executor(s) → offline`))
    .catch((err) => logger.error('executors', 'Initial sweep failed', err as Error));

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
