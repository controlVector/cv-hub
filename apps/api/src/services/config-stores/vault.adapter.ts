import {
  BaseConfigStoreAdapter,
  type ConfigStoreConnectionOptions,
  type ConfigStoreValue,
  type ConfigStorePutOptions,
  type ConfigStoreDeleteOptions,
  type ConfigStoreListOptions,
  type ConfigStoreListResult,
  type ConfigStoreTestResult,
  registerStoreAdapter,
} from './base.adapter';
import { logger } from '../../utils/logger';

// ============================================================================
// HashiCorp Vault Adapter
// Integrates with HashiCorp Vault KV secrets engine (v2)
// ============================================================================

export class VaultConfigStoreAdapter extends BaseConfigStoreAdapter {
  private baseUrl: string;
  private token: string;
  private vaultNamespace?: string;
  private kvVersion: 1 | 2 = 2; // Default to KV v2

  constructor(options: ConfigStoreConnectionOptions) {
    super(options);
    this.baseUrl = options.credentials.vaultAddress || 'http://127.0.0.1:8200';
    this.token = options.credentials.vaultToken || '';
    this.vaultNamespace = options.credentials.vaultNamespace;
    this.path = options.credentials.vaultPath || 'secret';
  }

  getType(): string {
    return 'hashicorp_vault';
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Vault-Token': this.token,
      'Content-Type': 'application/json',
    };

    if (this.vaultNamespace) {
      headers['X-Vault-Namespace'] = this.vaultNamespace;
    }

    return headers;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const url = `${this.baseUrl}/v1/${path}`;

    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vault request failed: ${response.status} ${errorText}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async testConnection(): Promise<ConfigStoreTestResult> {
    const start = Date.now();

    try {
      // Check token validity by looking up self
      const response = await this.request('GET', 'auth/token/lookup-self');

      return {
        success: true,
        message: 'Successfully connected to HashiCorp Vault',
        latencyMs: Date.now() - start,
        details: {
          address: this.baseUrl,
          namespace: this.vaultNamespace,
          path: this.path,
          tokenPolicies: response.data?.policies || [],
          tokenTtl: response.data?.ttl,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to connect: ${error.message}`,
        latencyMs: Date.now() - start,
        details: {
          error: error.message,
        },
      };
    }
  }

  private getSecretPath(key: string): string {
    // For KV v2, path format is: <mount>/data/<path>
    const fullPath = this.buildKeyPath(key);
    return this.kvVersion === 2
      ? `${this.path}/data/${fullPath}`
      : `${this.path}/${fullPath}`;
  }

  private getMetadataPath(key: string): string {
    const fullPath = this.buildKeyPath(key);
    return `${this.path}/metadata/${fullPath}`;
  }

  async get(key: string): Promise<ConfigStoreValue | null> {
    try {
      const secretPath = this.getSecretPath(key);
      const response = await this.request('GET', secretPath);

      if (!response || !response.data) {
        return null;
      }

      const data = this.kvVersion === 2 ? response.data.data : response.data;
      const metadata = this.kvVersion === 2 ? response.data.metadata : {};

      // We store values as { value: "...", metadata: {...} }
      return {
        key,
        value: data.value || '',
        version: metadata.version,
        lastModified: metadata.created_time
          ? new Date(metadata.created_time)
          : undefined,
        metadata: data.metadata || {},
      };
    } catch (error: any) {
      if (error.message.includes('404')) {
        return null;
      }
      logger.error('config', 'Vault get failed', error);
      throw error;
    }
  }

  async put(options: ConfigStorePutOptions): Promise<ConfigStoreValue> {
    try {
      const secretPath = this.getSecretPath(options.key);

      const payload = this.kvVersion === 2
        ? {
            data: {
              value: options.value,
              metadata: options.metadata || {},
            },
          }
        : {
            value: options.value,
            metadata: options.metadata || {},
          };

      const response = await this.request('POST', secretPath, payload);

      const version = response?.data?.version;

      return {
        key: options.key,
        value: options.value,
        version,
        lastModified: new Date(),
        metadata: options.metadata,
      };
    } catch (error) {
      logger.error('config', 'Vault put failed', error as Error);
      throw error;
    }
  }

  async delete(options: ConfigStoreDeleteOptions): Promise<boolean> {
    try {
      if (this.kvVersion === 2) {
        // For KV v2, we delete the metadata to completely remove all versions
        const metadataPath = this.getMetadataPath(options.key);
        await this.request('DELETE', metadataPath);
      } else {
        const secretPath = this.getSecretPath(options.key);
        await this.request('DELETE', secretPath);
      }

      return true;
    } catch (error: any) {
      if (error.message.includes('404')) {
        return false;
      }
      logger.error('config', 'Vault delete failed', error);
      throw error;
    }
  }

  async list(options?: ConfigStoreListOptions): Promise<ConfigStoreListResult> {
    try {
      const prefix = options?.prefix || '';
      const listPath = this.kvVersion === 2
        ? `${this.path}/metadata/${this.buildKeyPath(prefix)}`
        : `${this.path}/${this.buildKeyPath(prefix)}`;

      const response = await this.request('LIST', listPath);

      const keys = response?.data?.keys || [];
      const values: ConfigStoreValue[] = [];

      // Vault LIST only returns keys, not values
      // We need to fetch each value individually
      const maxResults = options?.maxResults || 50;
      const keysToFetch = keys.slice(0, maxResults);

      for (const key of keysToFetch) {
        // Skip "directories" (keys ending with /)
        if (key.endsWith('/')) continue;

        const fullKey = prefix ? `${prefix}/${key}` : key;
        const value = await this.get(fullKey);
        if (value) {
          values.push(value);
        }
      }

      return {
        values,
        hasMore: keys.length > maxResults,
      };
    } catch (error: any) {
      if (error.message.includes('404')) {
        return { values: [], hasMore: false };
      }
      logger.error('config', 'Vault list failed', error);
      throw error;
    }
  }

  supportsVersioning(): boolean {
    return this.kvVersion === 2;
  }

  async getVersion(key: string, version: number): Promise<ConfigStoreValue | null> {
    if (this.kvVersion !== 2) {
      return null;
    }

    try {
      const secretPath = this.getSecretPath(key);
      const response = await this.request('GET', `${secretPath}?version=${version}`);

      if (!response || !response.data) {
        return null;
      }

      const data = response.data.data;
      const metadata = response.data.metadata;

      return {
        key,
        value: data.value || '',
        version: metadata.version,
        lastModified: metadata.created_time
          ? new Date(metadata.created_time)
          : undefined,
        metadata: data.metadata || {},
      };
    } catch (error) {
      logger.error('config', 'Vault getVersion failed', error as Error);
      return null;
    }
  }

  async listVersions(key: string): Promise<ConfigStoreValue[]> {
    if (this.kvVersion !== 2) {
      const current = await this.get(key);
      return current ? [current] : [];
    }

    try {
      const metadataPath = this.getMetadataPath(key);
      const response = await this.request('GET', metadataPath);

      if (!response || !response.data || !response.data.versions) {
        return [];
      }

      const versions = Object.keys(response.data.versions)
        .map(Number)
        .sort((a, b) => b - a);

      const values: ConfigStoreValue[] = [];

      for (const version of versions) {
        const value = await this.getVersion(key, version);
        if (value) {
          values.push(value);
        }
      }

      return values;
    } catch (error) {
      logger.error('config', 'Vault listVersions failed', error as Error);
      return [];
    }
  }

  /**
   * Undelete a soft-deleted version (KV v2 only)
   */
  async undelete(key: string, versions: number[]): Promise<boolean> {
    if (this.kvVersion !== 2) {
      return false;
    }

    try {
      const undeletePath = `${this.path}/undelete/${this.buildKeyPath(key)}`;
      await this.request('POST', undeletePath, { versions });
      return true;
    } catch (error) {
      logger.error('config', 'Vault undelete failed', error as Error);
      return false;
    }
  }

  /**
   * Permanently destroy versions (KV v2 only)
   */
  async destroy(key: string, versions: number[]): Promise<boolean> {
    if (this.kvVersion !== 2) {
      return false;
    }

    try {
      const destroyPath = `${this.path}/destroy/${this.buildKeyPath(key)}`;
      await this.request('POST', destroyPath, { versions });
      return true;
    } catch (error) {
      logger.error('config', 'Vault destroy failed', error as Error);
      return false;
    }
  }
}

// Register the adapter
registerStoreAdapter('hashicorp_vault', (options) => new VaultConfigStoreAdapter(options));
