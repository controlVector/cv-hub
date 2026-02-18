/**
 * Deploy Configuration
 *
 * Environment-aware deploy config derived from the trigger branch.
 * Pipeline YAML references $CV_HUB_ENV_* variables that are resolved at runtime.
 * URLs and service names are derived from BRAND_DOMAIN (defaults to controlvector.io).
 */

import { brand } from '../../config/brand';

const domain = brand.domain;
const slug = domain.replace(/\./g, '-').replace(/-io$|-ai$/, '');

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
      apiUrl: `https://api-dev.${domain}`,
      appUrl: `https://hub-dev.${domain}`,
      service: `${slug}-api-dev`,
      staticBucket: `${slug}-web-assets-dev`,
      cdnDistribution: process.env.CLOUDFRONT_DISTRIBUTION_DEV || '',
    };
  }

  // main/master and everything else defaults to production
  return {
    environment: 'production',
    apiUrl: `https://api.hub.${domain}`,
    appUrl: `https://hub.${domain}`,
    service: `${slug}-api`,
    staticBucket: `${slug}-web-assets`,
    cdnDistribution: process.env.CLOUDFRONT_DISTRIBUTION_PROD || '',
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
