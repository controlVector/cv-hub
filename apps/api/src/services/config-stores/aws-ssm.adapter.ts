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
// AWS SSM Parameter Store Adapter
// Integrates with AWS Systems Manager Parameter Store
// ============================================================================

export class AwsSsmConfigStoreAdapter extends BaseConfigStoreAdapter {
  private client: any = null;

  constructor(options: ConfigStoreConnectionOptions) {
    super(options);
  }

  getType(): string {
    return 'aws_ssm';
  }

  /**
   * Initialize the AWS SSM client
   */
  private async getClient() {
    if (this.client) return this.client;

    try {
      // Dynamic import to avoid requiring AWS SDK if not used
      const { SSMClient } = await import('@aws-sdk/client-ssm');

      const config: any = {
        region: this.credentials.awsRegion || 'us-east-1',
      };

      // Use explicit credentials if provided, otherwise fall back to default credential chain
      if (this.credentials.awsAccessKeyId && this.credentials.awsSecretAccessKey) {
        config.credentials = {
          accessKeyId: this.credentials.awsAccessKeyId,
          secretAccessKey: this.credentials.awsSecretAccessKey,
        };
      }

      this.client = new SSMClient(config);
      return this.client;
    } catch (error) {
      logger.error('config', 'Failed to initialize AWS SSM client', error as Error);
      throw new Error('AWS SDK not available. Install @aws-sdk/client-ssm');
    }
  }

  async testConnection(): Promise<ConfigStoreTestResult> {
    const start = Date.now();

    try {
      const client = await this.getClient();
      const { DescribeParametersCommand } = await import('@aws-sdk/client-ssm');

      // Try to list a single parameter to verify access
      await client.send(
        new DescribeParametersCommand({
          MaxResults: 1,
        })
      );

      return {
        success: true,
        message: 'Successfully connected to AWS SSM Parameter Store',
        latencyMs: Date.now() - start,
        details: {
          region: this.credentials.awsRegion || 'us-east-1',
          path: this.path,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to connect: ${error.message}`,
        latencyMs: Date.now() - start,
        details: {
          error: error.name,
          code: error.code,
        },
      };
    }
  }

  async get(key: string): Promise<ConfigStoreValue | null> {
    try {
      const client = await this.getClient();
      const { GetParameterCommand } = await import('@aws-sdk/client-ssm');

      const fullPath = this.buildKeyPath(key);
      const response = await client.send(
        new GetParameterCommand({
          Name: fullPath,
          WithDecryption: true,
        })
      );

      if (!response.Parameter) {
        return null;
      }

      return {
        key,
        value: response.Parameter.Value || '',
        version: response.Parameter.Version,
        lastModified: response.Parameter.LastModifiedDate,
        metadata: {
          type: response.Parameter.Type || 'String',
          arn: response.Parameter.ARN || '',
        },
      };
    } catch (error: any) {
      if (error.name === 'ParameterNotFound') {
        return null;
      }
      logger.error('config', 'AWS SSM get failed', error);
      throw error;
    }
  }

  async put(options: ConfigStorePutOptions): Promise<ConfigStoreValue> {
    try {
      const client = await this.getClient();
      const { PutParameterCommand } = await import('@aws-sdk/client-ssm');

      const fullPath = this.buildKeyPath(options.key);
      const response = await client.send(
        new PutParameterCommand({
          Name: fullPath,
          Value: options.value,
          Type: 'SecureString',
          Overwrite: true,
          Description: options.description,
        })
      );

      return {
        key: options.key,
        value: options.value,
        version: response.Version,
        lastModified: new Date(),
        metadata: options.metadata,
      };
    } catch (error) {
      logger.error('config', 'AWS SSM put failed', error as Error);
      throw error;
    }
  }

  async delete(options: ConfigStoreDeleteOptions): Promise<boolean> {
    try {
      const client = await this.getClient();
      const { DeleteParameterCommand } = await import('@aws-sdk/client-ssm');

      const fullPath = this.buildKeyPath(options.key);
      await client.send(
        new DeleteParameterCommand({
          Name: fullPath,
        })
      );

      return true;
    } catch (error: any) {
      if (error.name === 'ParameterNotFound') {
        return false;
      }
      logger.error('config', 'AWS SSM delete failed', error);
      throw error;
    }
  }

  async list(options?: ConfigStoreListOptions): Promise<ConfigStoreListResult> {
    try {
      const client = await this.getClient();
      const { GetParametersByPathCommand } = await import('@aws-sdk/client-ssm');

      const prefix = options?.prefix ? this.buildKeyPath(options.prefix) : this.buildKeyPath('');

      const response = await client.send(
        new GetParametersByPathCommand({
          Path: prefix || '/',
          Recursive: true,
          WithDecryption: true,
          MaxResults: options?.maxResults || 50,
          NextToken: options?.nextToken,
        })
      );

      const values: ConfigStoreValue[] = (response.Parameters || []).map(
        (param: any) => ({
          key: this.stripKeyPath(param.Name || ''),
          value: param.Value || '',
          version: param.Version,
          lastModified: param.LastModifiedDate,
          metadata: {
            type: param.Type || 'String',
            arn: param.ARN || '',
          },
        })
      );

      return {
        values,
        nextToken: response.NextToken,
        hasMore: !!response.NextToken,
      };
    } catch (error) {
      logger.error('config', 'AWS SSM list failed', error as Error);
      throw error;
    }
  }

  supportsVersioning(): boolean {
    return true;
  }

  async getVersion(key: string, version: number): Promise<ConfigStoreValue | null> {
    try {
      const client = await this.getClient();
      const { GetParameterHistoryCommand } = await import('@aws-sdk/client-ssm');

      const fullPath = this.buildKeyPath(key);
      const response = await client.send(
        new GetParameterHistoryCommand({
          Name: fullPath,
          WithDecryption: true,
        })
      );

      const versionEntry = response.Parameters?.find(
        (p: any) => p.Version === version
      );

      if (!versionEntry) {
        return null;
      }

      return {
        key,
        value: versionEntry.Value || '',
        version: versionEntry.Version,
        lastModified: versionEntry.LastModifiedDate,
        metadata: {
          type: versionEntry.Type || 'String',
        },
      };
    } catch (error) {
      logger.error('config', 'AWS SSM getVersion failed', error as Error);
      return null;
    }
  }

  async listVersions(key: string): Promise<ConfigStoreValue[]> {
    try {
      const client = await this.getClient();
      const { GetParameterHistoryCommand } = await import('@aws-sdk/client-ssm');

      const fullPath = this.buildKeyPath(key);
      const response = await client.send(
        new GetParameterHistoryCommand({
          Name: fullPath,
          WithDecryption: true,
        })
      );

      return (response.Parameters || []).map((param: any) => ({
        key,
        value: param.Value || '',
        version: param.Version,
        lastModified: param.LastModifiedDate,
        metadata: {
          type: param.Type || 'String',
        },
      }));
    } catch (error) {
      logger.error('config', 'AWS SSM listVersions failed', error as Error);
      return [];
    }
  }
}

// Register the adapter
registerStoreAdapter('aws_ssm', (options) => new AwsSsmConfigStoreAdapter(options));
