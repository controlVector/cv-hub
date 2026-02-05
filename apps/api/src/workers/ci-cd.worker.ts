/**
 * CI/CD Worker Entry Point
 * Standalone process for processing CI/CD jobs
 */

// Only load dotenv in development - K8s provides env vars in production
if (process.env.NODE_ENV !== 'production') {
  require('dotenv/config');
}

import '../instrument';
import {
  startOrchestrationWorker,
  startExecutionWorker,
  stopWorkers,
  closeQueues,
} from '../services/ci/job-dispatch.service';

console.log('[CI/CD Worker] Starting...');

// Start both workers
const orchestrationWorker = startOrchestrationWorker();
const executionWorker = startExecutionWorker();

console.log('[CI/CD Worker] Both workers started successfully');

// Handle graceful shutdown
async function shutdown(signal: string) {
  console.log(`[CI/CD Worker] Received ${signal}, shutting down...`);

  try {
    await stopWorkers();
    await closeQueues();
    console.log('[CI/CD Worker] Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[CI/CD Worker] Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[CI/CD Worker] Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CI/CD Worker] Unhandled rejection at:', promise, 'reason:', reason);
});
