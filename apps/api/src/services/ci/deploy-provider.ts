/**
 * Deploy Provider Interface
 *
 * Abstract interface for deployment operations. Cloud-specific implementations
 * are plugged in at runtime based on configuration.
 */

export interface CacheConfig {
  immutablePaths?: string[];
  noCachePaths?: string[];
  maxAge?: number;
}

export interface DeployProvider {
  name: string;

  /** Login to container registry and return registry URL */
  registryLogin(): Promise<{ registry: string }>;

  /** Deploy a container service (e.g., ECS, Cloud Run, K8s) */
  deployService(config: {
    service: string;
    image: string;
    waitForStability?: boolean;
  }): Promise<{ status: string; previousVersion?: string }>;

  /** Deploy static assets to object storage */
  deployStaticAssets(config: {
    source: string;
    destination: string;
    cacheConfig?: CacheConfig;
  }): Promise<{ filesUploaded: number }>;

  /** Invalidate CDN cache */
  invalidateCDN(config: {
    paths: string[];
  }): Promise<{ invalidationId: string }>;

  /** Check health of a deployed service */
  checkHealth(url: string): Promise<{ status: number; latencyMs: number }>;

  /** Rollback a service to a previous version */
  rollbackService(config: {
    service: string;
    previousVersion: string;
  }): Promise<{ status: string }>;
}
