import type { ConfigStoreCredentials } from '../../db/schema/config';

// ============================================================================
// Base Config Store Adapter
// Abstract interface for all config store implementations
// ============================================================================

export interface ConfigStoreValue {
  key: string;
  value: string;
  metadata?: Record<string, string>;
  version?: number;
  lastModified?: Date;
}

export interface ConfigStoreConnectionOptions {
  credentials: ConfigStoreCredentials;
  path?: string;
  namespace?: string;
}

export interface ConfigStorePutOptions {
  key: string;
  value: string;
  metadata?: Record<string, string>;
  description?: string;
}

export interface ConfigStoreDeleteOptions {
  key: string;
}

export interface ConfigStoreListOptions {
  prefix?: string;
  maxResults?: number;
  nextToken?: string;
}

export interface ConfigStoreListResult {
  values: ConfigStoreValue[];
  nextToken?: string;
  hasMore: boolean;
}

export interface ConfigStoreTestResult {
  success: boolean;
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

/**
 * Abstract base class for config store adapters
 */
export abstract class BaseConfigStoreAdapter {
  protected credentials: ConfigStoreCredentials;
  protected path?: string;
  protected namespace?: string;

  constructor(options: ConfigStoreConnectionOptions) {
    this.credentials = options.credentials;
    this.path = options.path;
    this.namespace = options.namespace;
  }

  /**
   * Get the store type identifier
   */
  abstract getType(): string;

  /**
   * Test the connection to the store
   */
  abstract testConnection(): Promise<ConfigStoreTestResult>;

  /**
   * Get a single value by key
   */
  abstract get(key: string): Promise<ConfigStoreValue | null>;

  /**
   * Put (create or update) a value
   */
  abstract put(options: ConfigStorePutOptions): Promise<ConfigStoreValue>;

  /**
   * Delete a value
   */
  abstract delete(options: ConfigStoreDeleteOptions): Promise<boolean>;

  /**
   * List values with optional prefix filtering
   */
  abstract list(options?: ConfigStoreListOptions): Promise<ConfigStoreListResult>;

  /**
   * Check if the store supports versioning
   */
  abstract supportsVersioning(): boolean;

  /**
   * Get a specific version of a value (if versioning is supported)
   */
  async getVersion(key: string, version: number): Promise<ConfigStoreValue | null> {
    if (!this.supportsVersioning()) {
      throw new Error('This store does not support versioning');
    }
    // Default implementation - subclasses can override
    return this.get(key);
  }

  /**
   * List all versions of a value (if versioning is supported)
   */
  async listVersions(key: string): Promise<ConfigStoreValue[]> {
    if (!this.supportsVersioning()) {
      throw new Error('This store does not support versioning');
    }
    // Default implementation - subclasses can override
    const current = await this.get(key);
    return current ? [current] : [];
  }

  /**
   * Build the full key path including namespace/path prefix
   */
  protected buildKeyPath(key: string): string {
    const parts: string[] = [];
    if (this.namespace) parts.push(this.namespace);
    if (this.path) parts.push(this.path);
    parts.push(key);
    return parts.join('/');
  }

  /**
   * Strip the namespace/path prefix from a full key path
   */
  protected stripKeyPath(fullPath: string): string {
    let result = fullPath;
    if (this.namespace && result.startsWith(this.namespace + '/')) {
      result = result.substring(this.namespace.length + 1);
    }
    if (this.path && result.startsWith(this.path + '/')) {
      result = result.substring(this.path.length + 1);
    }
    return result;
  }
}

/**
 * Factory function type for creating store adapters
 */
export type ConfigStoreAdapterFactory = (
  options: ConfigStoreConnectionOptions
) => BaseConfigStoreAdapter;

/**
 * Registry of available store adapters
 */
export const storeAdapterRegistry = new Map<string, ConfigStoreAdapterFactory>();

/**
 * Register a store adapter
 */
export function registerStoreAdapter(
  type: string,
  factory: ConfigStoreAdapterFactory
): void {
  storeAdapterRegistry.set(type, factory);
}

/**
 * Get a store adapter by type
 */
export function getStoreAdapter(
  type: string,
  options: ConfigStoreConnectionOptions
): BaseConfigStoreAdapter {
  const factory = storeAdapterRegistry.get(type);
  if (!factory) {
    throw new Error(`Unknown config store type: ${type}`);
  }
  return factory(options);
}
