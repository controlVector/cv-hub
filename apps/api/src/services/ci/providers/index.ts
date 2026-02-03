/**
 * Deploy Provider Factory
 *
 * Returns the appropriate deploy provider based on configuration.
 * Default: AWS. Additional providers can be added here.
 */

import type { DeployProvider } from '../deploy-provider';
import { AWSDeployProvider } from './aws.provider';

let cachedProvider: DeployProvider | null = null;

/**
 * Get the deploy provider instance based on DEPLOY_PROVIDER env var
 */
export function getDeployProvider(): DeployProvider {
  if (cachedProvider) return cachedProvider;

  const providerName = process.env.DEPLOY_PROVIDER || 'aws';

  switch (providerName) {
    case 'aws':
      cachedProvider = new AWSDeployProvider();
      break;
    default:
      throw new Error(
        `Unknown deploy provider: "${providerName}". Supported: aws`
      );
  }

  return cachedProvider;
}

/**
 * Reset the cached provider (useful for testing)
 */
export function resetDeployProvider(): void {
  cachedProvider = null;
}
