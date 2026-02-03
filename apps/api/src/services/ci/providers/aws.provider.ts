/**
 * AWS Deploy Provider
 *
 * Implements DeployProvider for AWS services:
 * - ECR for container registry
 * - ECS for container service deployment
 * - S3 for static asset deployment
 * - CloudFront for CDN invalidation
 */

import { spawn } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import type { DeployProvider, CacheConfig } from '../deploy-provider';
import { logger } from '../../../utils/logger';

// MIME type mapping for S3 uploads
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.webp': 'image/webp',
};

export class AWSDeployProvider implements DeployProvider {
  name = 'aws';

  private region: string;
  private accountId: string;
  private cluster: string;

  constructor() {
    this.region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    this.accountId = process.env.AWS_ACCOUNT_ID || '';
    this.cluster = process.env.ECS_CLUSTER || 'controlfab';
  }

  /**
   * Login to ECR using aws ecr get-login-password + buildah login
   */
  async registryLogin(): Promise<{ registry: string }> {
    const registry = `${this.accountId}.dkr.ecr.${this.region}.amazonaws.com`;

    // Get ECR auth token and pipe to buildah login
    const loginCmd = `aws ecr get-login-password --region ${this.region} | buildah login --username AWS --password-stdin ${registry}`;

    await this.runCommand(loginCmd);

    logger.info('ci', 'ECR login successful', { registry });

    return { registry };
  }

  /**
   * Deploy a container service to ECS
   *
   * 1. Get current task definition
   * 2. Register new revision with updated image
   * 3. Update ECS service to use new task def
   * 4. Optionally wait for service stability
   */
  async deployService(config: {
    service: string;
    image: string;
    waitForStability?: boolean;
  }): Promise<{ status: string; previousVersion?: string }> {
    const { service, image, waitForStability = true } = config;

    // Get current task definition
    const describeResult = await this.runCommand(
      `aws ecs describe-services --cluster ${this.cluster} --services ${service} --region ${this.region} --output json`
    );
    const serviceInfo = JSON.parse(describeResult);
    const currentTaskDef = serviceInfo.services?.[0]?.taskDefinition;

    if (!currentTaskDef) {
      throw new Error(`ECS service "${service}" not found in cluster "${this.cluster}"`);
    }

    // Get task definition details
    const taskDefResult = await this.runCommand(
      `aws ecs describe-task-definition --task-definition ${currentTaskDef} --region ${this.region} --output json`
    );
    const taskDef = JSON.parse(taskDefResult).taskDefinition;

    // Build the registry URL for the image
    const registry = `${this.accountId}.dkr.ecr.${this.region}.amazonaws.com`;
    const fullImage = image.includes('/') ? `${registry}/${image}` : `${registry}/${service}:${image}`;

    // Update container image in the first container definition
    const containerDefs = taskDef.containerDefinitions.map((c: any, i: number) => {
      if (i === 0) {
        return { ...c, image: fullImage };
      }
      return c;
    });

    // Register new task definition revision
    const newTaskDefInput = {
      family: taskDef.family,
      containerDefinitions: containerDefs,
      taskRoleArn: taskDef.taskRoleArn,
      executionRoleArn: taskDef.executionRoleArn,
      networkMode: taskDef.networkMode,
      requiresCompatibilities: taskDef.requiresCompatibilities,
      cpu: taskDef.cpu,
      memory: taskDef.memory,
    };

    const registerResult = await this.runCommand(
      `aws ecs register-task-definition --region ${this.region} --output json --cli-input-json '${JSON.stringify(newTaskDefInput)}'`
    );
    const newTaskDef = JSON.parse(registerResult).taskDefinition;
    const newTaskDefArn = newTaskDef.taskDefinitionArn;

    logger.info('ci', 'Registered new task definition', {
      family: newTaskDef.family,
      revision: newTaskDef.revision,
    });

    // Update ECS service to use new task definition
    await this.runCommand(
      `aws ecs update-service --cluster ${this.cluster} --service ${service} --task-definition ${newTaskDefArn} --region ${this.region} --output json`
    );

    // Wait for service stability
    if (waitForStability) {
      logger.info('ci', 'Waiting for ECS service stability', { service });
      await this.runCommand(
        `aws ecs wait services-stable --cluster ${this.cluster} --services ${service} --region ${this.region}`,
        600000 // 10 minute timeout for stability
      );
    }

    logger.info('ci', 'ECS service deployed', { service, taskDef: newTaskDefArn });

    return {
      status: 'deployed',
      previousVersion: currentTaskDef,
    };
  }

  /**
   * Deploy static assets to S3 with appropriate cache headers
   */
  async deployStaticAssets(config: {
    source: string;
    destination: string;
    cacheConfig?: CacheConfig;
  }): Promise<{ filesUploaded: number }> {
    const { source, destination } = config;
    const bucket = destination.startsWith('s3://') ? destination : `s3://${destination}`;

    // Sync with appropriate cache headers
    // - Hashed assets (js, css in assets/): immutable, long cache
    // - index.html: no-cache
    // - Other files: short cache

    // First: sync hashed assets with immutable cache
    await this.runCommand(
      `aws s3 sync ${source} ${bucket} --exclude "*.html" --cache-control "public, max-age=31536000, immutable" --region ${this.region}`
    );

    // Then: sync HTML files with no-cache
    await this.runCommand(
      `aws s3 sync ${source} ${bucket} --exclude "*" --include "*.html" --cache-control "no-cache, no-store, must-revalidate" --region ${this.region}`
    );

    const fileCount = this.countFilesRecursive(source);

    logger.info('ci', 'Static assets deployed to S3', { bucket, fileCount });

    return { filesUploaded: fileCount };
  }

  /**
   * Invalidate CloudFront distribution cache
   */
  async invalidateCDN(config: {
    paths: string[];
  }): Promise<{ invalidationId: string }> {
    const distribution = process.env.CLOUDFRONT_DISTRIBUTION_ID || '';
    if (!distribution) {
      logger.warn('ci', 'No CloudFront distribution configured, skipping invalidation');
      return { invalidationId: 'skipped' };
    }

    const pathsJson = JSON.stringify({ Paths: { Quantity: config.paths.length, Items: config.paths } });
    const callerRef = `cv-hub-${Date.now()}`;

    const result = await this.runCommand(
      `aws cloudfront create-invalidation --distribution-id ${distribution} --invalidation-batch '{"Paths":{"Quantity":${config.paths.length},"Items":${JSON.stringify(config.paths)}},"CallerReference":"${callerRef}"}' --region ${this.region} --output json`
    );

    const invalidation = JSON.parse(result);
    const invalidationId = invalidation.Invalidation?.Id || 'unknown';

    logger.info('ci', 'CloudFront invalidation created', { distribution, invalidationId });

    return { invalidationId };
  }

  /**
   * Check health of a deployed service
   */
  async checkHealth(url: string): Promise<{ status: number; latencyMs: number }> {
    const start = Date.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });

      return {
        status: response.status,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        status: 0,
        latencyMs: Date.now() - start,
      };
    }
  }

  /**
   * Rollback an ECS service to a previous task definition
   */
  async rollbackService(config: {
    service: string;
    previousVersion: string;
  }): Promise<{ status: string }> {
    const { service, previousVersion } = config;

    logger.info('ci', 'Rolling back ECS service', { service, previousVersion });

    await this.runCommand(
      `aws ecs update-service --cluster ${this.cluster} --service ${service} --task-definition ${previousVersion} --region ${this.region} --output json`
    );

    // Wait for stability after rollback
    await this.runCommand(
      `aws ecs wait services-stable --cluster ${this.cluster} --services ${service} --region ${this.region}`,
      600000
    );

    logger.info('ci', 'ECS service rolled back', { service, previousVersion });

    return { status: 'rolled_back' };
  }

  // Helpers

  private runCommand(command: string, timeoutMs = 120000): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      const child = spawn('/bin/sh', ['-c', command], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`AWS command timed out: ${command.slice(0, 100)}...`));
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`AWS command failed (exit ${code}): ${command.slice(0, 100)}...\n${output}`));
          return;
        }
        resolve(output);
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to run AWS command: ${err.message}`));
      });
    });
  }

  private countFilesRecursive(dir: string): number {
    let count = 0;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          count++;
        } else if (entry.isDirectory()) {
          count += this.countFilesRecursive(join(dir, entry.name));
        }
      }
    } catch {
      // Directory might not exist
    }
    return count;
  }
}
