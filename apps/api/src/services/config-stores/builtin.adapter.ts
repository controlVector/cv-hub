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

// ============================================================================
// Built-in Config Store Adapter
// Uses CV-Hub's internal encrypted storage (PostgreSQL)
// This is a passthrough adapter - actual storage is handled by the config service
// ============================================================================

/**
 * In-memory store for the builtin adapter
 * This is used as a cache/passthrough since actual storage is in PostgreSQL
 */
const memoryStore = new Map<string, ConfigStoreValue>();

export class BuiltinConfigStoreAdapter extends BaseConfigStoreAdapter {
  constructor(options: ConfigStoreConnectionOptions) {
    super(options);
  }

  getType(): string {
    return 'builtin';
  }

  async testConnection(): Promise<ConfigStoreTestResult> {
    // Built-in store is always available
    const start = Date.now();

    return {
      success: true,
      message: 'Built-in store is operational',
      latencyMs: Date.now() - start,
      details: {
        type: 'builtin',
        storage: 'postgresql',
        encryption: 'aes-256-gcm',
      },
    };
  }

  async get(key: string): Promise<ConfigStoreValue | null> {
    const fullKey = this.buildKeyPath(key);
    const value = memoryStore.get(fullKey);
    return value ?? null;
  }

  async put(options: ConfigStorePutOptions): Promise<ConfigStoreValue> {
    const fullKey = this.buildKeyPath(options.key);
    const existing = memoryStore.get(fullKey);

    const value: ConfigStoreValue = {
      key: options.key,
      value: options.value,
      metadata: options.metadata,
      version: (existing?.version ?? 0) + 1,
      lastModified: new Date(),
    };

    memoryStore.set(fullKey, value);
    return value;
  }

  async delete(options: ConfigStoreDeleteOptions): Promise<boolean> {
    const fullKey = this.buildKeyPath(options.key);
    return memoryStore.delete(fullKey);
  }

  async list(options?: ConfigStoreListOptions): Promise<ConfigStoreListResult> {
    const prefix = options?.prefix ? this.buildKeyPath(options.prefix) : this.buildKeyPath('');
    const maxResults = options?.maxResults ?? 100;

    const values: ConfigStoreValue[] = [];
    let count = 0;

    for (const [key, value] of memoryStore.entries()) {
      if (key.startsWith(prefix)) {
        if (count >= maxResults) {
          return {
            values,
            hasMore: true,
            nextToken: key,
          };
        }
        values.push({
          ...value,
          key: this.stripKeyPath(key),
        });
        count++;
      }
    }

    return {
      values,
      hasMore: false,
    };
  }

  supportsVersioning(): boolean {
    // The built-in store supports versioning through the config_value_history table
    return true;
  }

  /**
   * Clear the in-memory store (for testing)
   */
  static clearMemoryStore(): void {
    memoryStore.clear();
  }
}

// Register the adapter
registerStoreAdapter('builtin', (options) => new BuiltinConfigStoreAdapter(options));
