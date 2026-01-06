import { env } from '../config/env';
import { logger } from '../utils/logger';
import { createWriteStream, createReadStream } from 'fs';
import { mkdir, unlink, stat, access } from 'fs/promises';
import { join, dirname } from 'path';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';

// ============================================================================
// Storage Interface
// ============================================================================

export interface StorageProvider {
  /**
   * Upload a file to storage
   * @param key - The storage key (path) for the file
   * @param data - The file data as a buffer or readable stream
   * @returns The public URL of the uploaded file
   */
  upload(key: string, data: Buffer | NodeJS.ReadableStream): Promise<string>;

  /**
   * Download a file from storage
   * @param key - The storage key (path) of the file
   * @returns The file data as a buffer
   */
  download(key: string): Promise<Buffer>;

  /**
   * Delete a file from storage
   * @param key - The storage key (path) of the file
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists in storage
   * @param key - The storage key (path) of the file
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get the public URL for a file
   * @param key - The storage key (path) of the file
   */
  getUrl(key: string): string;
}

// ============================================================================
// Local Storage Provider
// ============================================================================

class LocalStorageProvider implements StorageProvider {
  private basePath: string;
  private baseUrl: string;

  constructor() {
    this.basePath = env.LOCAL_STORAGE_PATH;
    this.baseUrl = `${env.API_URL}/storage`;
  }

  async upload(key: string, data: Buffer | NodeJS.ReadableStream): Promise<string> {
    const filePath = join(this.basePath, key);
    const dir = dirname(filePath);

    // Ensure directory exists
    await mkdir(dir, { recursive: true });

    if (Buffer.isBuffer(data)) {
      const writeStream = createWriteStream(filePath);
      await new Promise<void>((resolve, reject) => {
        writeStream.write(data, (err) => {
          if (err) reject(err);
          else {
            writeStream.end();
            resolve();
          }
        });
      });
    } else {
      const writeStream = createWriteStream(filePath);
      await pipeline(data, writeStream);
    }

    logger.info('general', 'File uploaded to local storage', { key });
    return this.getUrl(key);
  }

  async download(key: string): Promise<Buffer> {
    const filePath = join(this.basePath, key);
    const chunks: Buffer[] = [];

    const readStream = createReadStream(filePath);
    for await (const chunk of readStream) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const filePath = join(this.basePath, key);
    await unlink(filePath);
    logger.info('general', 'File deleted from local storage', { key });
  }

  async exists(key: string): Promise<boolean> {
    const filePath = join(this.basePath, key);
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}

// ============================================================================
// S3 Storage Provider
// ============================================================================

class S3StorageProvider implements StorageProvider {
  private endpoint: string;
  private bucket: string;
  private accessKey: string;
  private secretKey: string;
  private region: string;

  constructor() {
    if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
      throw new Error('S3 storage configuration is incomplete');
    }

    this.endpoint = env.S3_ENDPOINT;
    this.bucket = env.S3_BUCKET;
    this.accessKey = env.S3_ACCESS_KEY;
    this.secretKey = env.S3_SECRET_KEY;
    this.region = env.S3_REGION;
  }

  // Generate AWS Signature v4 headers
  private async generateAuthHeaders(
    method: string,
    key: string,
    contentHash: string,
    contentType?: string
  ): Promise<Record<string, string>> {
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const host = new URL(this.endpoint).host;
    const canonicalUri = `/${this.bucket}/${key}`;

    const headers: Record<string, string> = {
      'host': host,
      'x-amz-content-sha256': contentHash,
      'x-amz-date': amzDate,
    };

    if (contentType) {
      headers['content-type'] = contentType;
    }

    // Create canonical request
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map(k => `${k}:${headers[k]}`)
      .join('\n') + '\n';

    const canonicalRequest = [
      method,
      canonicalUri,
      '', // Query string (empty)
      canonicalHeaders,
      signedHeaders,
      contentHash,
    ].join('\n');

    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    // Calculate signature
    const getSignatureKey = (key: string, dateStamp: string, region: string, service: string) => {
      const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
      const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
      const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
      return crypto.createHmac('sha256', kService).update('aws4_request').digest();
    };

    const signingKey = getSignatureKey(this.secretKey, dateStamp, this.region, 's3');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    // Create authorization header
    const authorization = `${algorithm} Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...headers,
      'Authorization': authorization,
    };
  }

  async upload(key: string, data: Buffer | NodeJS.ReadableStream): Promise<string> {
    // Convert stream to buffer if necessary
    let buffer: Buffer;
    if (Buffer.isBuffer(data)) {
      buffer = data;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of data) {
        chunks.push(Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
    }

    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const contentType = 'application/octet-stream';

    const headers = await this.generateAuthHeaders('PUT', key, contentHash, contentType);

    const response = await fetch(`${this.endpoint}/${this.bucket}/${key}`, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Length': buffer.length.toString(),
      },
      body: new Uint8Array(buffer),
    });

    if (!response.ok) {
      throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
    }

    logger.info('general', 'File uploaded to S3', { key, bucket: this.bucket });
    return this.getUrl(key);
  }

  async download(key: string): Promise<Buffer> {
    const contentHash = 'UNSIGNED-PAYLOAD';
    const headers = await this.generateAuthHeaders('GET', key, contentHash);

    const response = await fetch(`${this.endpoint}/${this.bucket}/${key}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`S3 download failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(key: string): Promise<void> {
    const contentHash = 'UNSIGNED-PAYLOAD';
    const headers = await this.generateAuthHeaders('DELETE', key, contentHash);

    const response = await fetch(`${this.endpoint}/${this.bucket}/${key}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      throw new Error(`S3 delete failed: ${response.status} ${response.statusText}`);
    }

    logger.info('general', 'File deleted from S3', { key, bucket: this.bucket });
  }

  async exists(key: string): Promise<boolean> {
    const contentHash = 'UNSIGNED-PAYLOAD';
    const headers = await this.generateAuthHeaders('HEAD', key, contentHash);

    const response = await fetch(`${this.endpoint}/${this.bucket}/${key}`, {
      method: 'HEAD',
      headers,
    });

    return response.ok;
  }

  getUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${key}`;
  }
}

// ============================================================================
// GitHub Storage Provider (passthrough to GitHub releases)
// ============================================================================

class GitHubStorageProvider implements StorageProvider {
  // GitHub storage is read-only - downloads redirect to GitHub releases

  async upload(_key: string, _data: Buffer | NodeJS.ReadableStream): Promise<string> {
    throw new Error('GitHub storage is read-only. Upload directly to GitHub releases.');
  }

  async download(key: string): Promise<Buffer> {
    // key should be a GitHub release asset URL
    const response = await fetch(key);
    if (!response.ok) {
      throw new Error(`GitHub download failed: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(_key: string): Promise<void> {
    throw new Error('GitHub storage is read-only. Delete through GitHub releases.');
  }

  async exists(key: string): Promise<boolean> {
    const response = await fetch(key, { method: 'HEAD' });
    return response.ok;
  }

  getUrl(key: string): string {
    // For GitHub storage, the key IS the URL
    return key;
  }
}

// ============================================================================
// Storage Factory
// ============================================================================

let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (storageInstance) {
    return storageInstance;
  }

  switch (env.STORAGE_TYPE) {
    case 'local':
      storageInstance = new LocalStorageProvider();
      break;
    case 's3':
      storageInstance = new S3StorageProvider();
      break;
    case 'github':
    default:
      storageInstance = new GitHubStorageProvider();
      break;
  }

  logger.info('general', 'Storage provider initialized', { type: env.STORAGE_TYPE });
  return storageInstance;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a storage key for a release asset
 */
export function generateAssetKey(appId: string, version: string, fileName: string): string {
  return `releases/${appId}/${version}/${fileName}`;
}

/**
 * Calculate SHA256 hash of a buffer
 */
export function calculateHash(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
