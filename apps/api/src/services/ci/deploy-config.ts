/**
 * Deploy Configuration
 *
 * Environment-aware deploy config derived from the trigger branch.
 * Pipeline YAML references $CV_HUB_ENV_* variables that are resolved at runtime.
 */

export interface DeployConfig {
  environment: 'dev' | 'production';
  apiUrl: string;
  appUrl: string;
  service: string;
  staticBucket: string;
  cdnDistribution: string;
}

/**
 * Get deployment configuration based on the branch being deployed
 */
export function getDeployConfig(branch: string): DeployConfig {
  // Strip refs/heads/ prefix if present
  const branchName = branch.startsWith('refs/heads/')
    ? branch.slice(11)
    : branch;

  if (branchName === 'develop') {
    return {
      environment: 'dev',
      apiUrl: 'https://api-dev.controlfab.ai',
      appUrl: 'https://hub-dev.controlfab.ai',
      service: 'controlfab-api-dev',
      staticBucket: 'controlfab-web-assets-dev',
      cdnDistribution: '',
    };
  }

  // main/master and everything else defaults to production
  return {
    environment: 'production',
    apiUrl: 'https://api.hub.controlfab.ai',
    appUrl: 'https://hub.controlfab.ai',
    service: 'controlfab-api',
    staticBucket: 'controlfab-web-assets',
    cdnDistribution: 'E1D32I9T5NEP6A',
  };
}

/**
 * Convert deploy config to environment variables for pipeline steps
 */
export function deployConfigToEnv(config: DeployConfig): Record<string, string> {
  return {
    CV_HUB_ENV: config.environment,
    CV_HUB_ENV_API_URL: config.apiUrl,
    CV_HUB_ENV_APP_URL: config.appUrl,
    CV_HUB_ENV_SERVICE: config.service,
    CV_HUB_ENV_STATIC_BUCKET: config.staticBucket,
    CV_HUB_ENV_CDN_DISTRIBUTION: config.cdnDistribution,
    CLOUDFRONT_DISTRIBUTION_ID: config.cdnDistribution,
  };
}
