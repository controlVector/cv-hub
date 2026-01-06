/**
 * Graph Sync Worker Entry Point
 * Standalone process for processing graph sync jobs
 */

// Only load dotenv in development - K8s provides env vars in production
if (process.env.NODE_ENV !== 'production') {
  require('dotenv/config');
}
import { startGraphSyncWorker, stopGraphSyncWorker, closeGraphSyncQueue } from '../services/graph';

console.log('[GraphSyncWorker] Starting...');

const worker = startGraphSyncWorker();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('[GraphSyncWorker] Received SIGINT, shutting down...');
  await stopGraphSyncWorker();
  await closeGraphSyncQueue();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[GraphSyncWorker] Received SIGTERM, shutting down...');
  await stopGraphSyncWorker();
  await closeGraphSyncQueue();
  process.exit(0);
});
