/**
 * Script to upload release files to DigitalOcean Spaces
 * Usage: npx tsx scripts/upload-to-spaces.ts
 */

import crypto from 'crypto';
import { readFileSync, existsSync } from 'fs';

// Configuration
const S3_ENDPOINT = 'https://nyc3.digitaloceanspaces.com';
const S3_BUCKET = 'cv-hub-storage';
const S3_REGION = 'nyc3';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'DO8012BRJM3YVFRKGZCX';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;

if (!S3_SECRET_KEY) {
  console.error('Error: S3_SECRET_KEY environment variable is required');
  console.error('Usage: S3_SECRET_KEY=your-secret npx tsx scripts/upload-to-spaces.ts');
  process.exit(1);
}

// Files to upload
const FILES_TO_UPLOAD = [
  {
    localPath: '/tmp/cv-git_0.4.3_amd64.deb',
    remotePath: 'releases/cv-git/0.4.3/cv-git_0.4.3_amd64.deb',
  },
  {
    localPath: '/tmp/CV-PRD_0.1.8_amd64.AppImage',
    remotePath: 'releases/cv-prd/0.1.8/CV-PRD_0.1.8_amd64.AppImage',
  },
];

function generateAuthHeaders(
  method: string,
  key: string,
  contentHash: string,
  contentType?: string
): Record<string, string> {
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const host = new URL(S3_ENDPOINT).host;
  const canonicalUri = `/${S3_BUCKET}/${key}`;

  const headers: Record<string, string> = {
    'host': host,
    'x-amz-content-sha256': contentHash,
    'x-amz-date': amzDate,
    'x-amz-acl': 'public-read',
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
  const credentialScope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;
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

  const signingKey = getSignatureKey(S3_SECRET_KEY!, dateStamp, S3_REGION, 's3');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  // Create authorization header
  const authorization = `${algorithm} Credential=${S3_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    'Authorization': authorization,
  };
}

async function uploadFile(localPath: string, remotePath: string): Promise<void> {
  if (!existsSync(localPath)) {
    console.error(`File not found: ${localPath}`);
    return;
  }

  const buffer = readFileSync(localPath);
  const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const contentType = 'application/octet-stream';

  const headers = generateAuthHeaders('PUT', remotePath, contentHash, contentType);

  console.log(`Uploading ${localPath} to ${remotePath}...`);
  console.log(`File size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

  const response = await fetch(`${S3_ENDPOINT}/${S3_BUCKET}/${remotePath}`, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Length': buffer.length.toString(),
    },
    body: new Uint8Array(buffer),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Upload failed: ${response.status} ${response.statusText}`);
    console.error(`Error body: ${errorBody}`);
    return;
  }

  console.log(`Successfully uploaded: ${S3_ENDPOINT}/${S3_BUCKET}/${remotePath}`);
}

async function main() {
  console.log('Starting upload to DigitalOcean Spaces...\n');

  for (const file of FILES_TO_UPLOAD) {
    await uploadFile(file.localPath, file.remotePath);
    console.log('');
  }

  console.log('Done!');
}

main().catch(console.error);
