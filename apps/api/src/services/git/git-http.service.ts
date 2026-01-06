import { spawn } from 'child_process';
import path from 'path';
import { env } from '../../config/env';
import { Readable, Writable } from 'stream';

// Helper to get repo path
function getRepoPath(ownerSlug: string, repoSlug: string): string {
  return path.join(env.GIT_STORAGE_PATH, ownerSlug, `${repoSlug}.git`);
}

// Git pkt-line encoding
function pktLine(data: string): string {
  const length = (data.length + 4).toString(16).padStart(4, '0');
  return length + data;
}

function pktFlush(): string {
  return '0000';
}

export type GitService = 'git-upload-pack' | 'git-receive-pack';

/**
 * Handle /info/refs discovery request
 * Returns refs in smart protocol format for git clone/fetch/push
 */
export async function handleInfoRefs(
  ownerSlug: string,
  repoSlug: string,
  service: GitService
): Promise<{ contentType: string; body: Buffer }> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  return new Promise((resolve, reject) => {
    const proc = spawn(service, ['--stateless-rpc', '--advertise-refs', repoPath]);

    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    proc.stdout.on('data', (data) => chunks.push(data));
    proc.stderr.on('data', (data) => errorChunks.push(data));

    proc.on('close', (code) => {
      if (code !== 0) {
        const error = Buffer.concat(errorChunks).toString();
        reject(new Error(`Git service failed: ${error}`));
        return;
      }

      // Prepend service announcement
      const announcement = pktLine(`# service=${service}\n`) + pktFlush();
      const refs = Buffer.concat(chunks);
      const body = Buffer.concat([Buffer.from(announcement), refs]);

      resolve({
        contentType: `application/x-${service}-advertisement`,
        body,
      });
    });

    proc.on('error', reject);
  });
}

/**
 * Handle git-upload-pack request (clone/fetch)
 * Stateless RPC mode for HTTP
 */
export async function handleUploadPack(
  ownerSlug: string,
  repoSlug: string,
  requestBody: Buffer
): Promise<{ contentType: string; body: Buffer }> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  return new Promise((resolve, reject) => {
    const proc = spawn('git-upload-pack', ['--stateless-rpc', repoPath]);

    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    proc.stdout.on('data', (data) => chunks.push(data));
    proc.stderr.on('data', (data) => errorChunks.push(data));

    proc.on('close', (code) => {
      if (code !== 0) {
        const error = Buffer.concat(errorChunks).toString();
        reject(new Error(`Upload pack failed: ${error}`));
        return;
      }

      resolve({
        contentType: 'application/x-git-upload-pack-result',
        body: Buffer.concat(chunks),
      });
    });

    proc.on('error', reject);

    // Write request body to stdin
    proc.stdin.write(requestBody);
    proc.stdin.end();
  });
}

/**
 * Handle git-receive-pack request (push)
 * Stateless RPC mode for HTTP
 */
export async function handleReceivePack(
  ownerSlug: string,
  repoSlug: string,
  requestBody: Buffer,
  onPostReceive?: (refs: Array<{ oldSha: string; newSha: string; refName: string }>) => void
): Promise<{ contentType: string; body: Buffer }> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  return new Promise((resolve, reject) => {
    const proc = spawn('git-receive-pack', ['--stateless-rpc', repoPath]);

    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    proc.stdout.on('data', (data) => chunks.push(data));
    proc.stderr.on('data', (data) => errorChunks.push(data));

    proc.on('close', (code) => {
      if (code !== 0) {
        const error = Buffer.concat(errorChunks).toString();
        reject(new Error(`Receive pack failed: ${error}`));
        return;
      }

      // Parse pushed refs from request body for post-receive hook
      if (onPostReceive) {
        const refs = parseReceivedRefs(requestBody);
        if (refs.length > 0) {
          onPostReceive(refs);
        }
      }

      resolve({
        contentType: 'application/x-git-receive-pack-result',
        body: Buffer.concat(chunks),
      });
    });

    proc.on('error', reject);

    // Write request body to stdin
    proc.stdin.write(requestBody);
    proc.stdin.end();
  });
}

/**
 * Parse ref updates from receive-pack request
 */
function parseReceivedRefs(body: Buffer): Array<{ oldSha: string; newSha: string; refName: string }> {
  const refs: Array<{ oldSha: string; newSha: string; refName: string }> = [];

  // pkt-line format: 4-hex-length + data
  let offset = 0;
  const str = body.toString('utf-8');

  while (offset < str.length) {
    // Read length
    const lengthHex = str.slice(offset, offset + 4);
    if (lengthHex === '0000') {
      // Flush packet - end of refs section
      break;
    }

    const length = parseInt(lengthHex, 16);
    if (isNaN(length) || length < 4) break;

    // Read data (length includes the 4 bytes of length field)
    const data = str.slice(offset + 4, offset + length);
    offset += length;

    // Parse ref line: <old-sha> <new-sha> <ref-name>
    // First line may have capabilities after null byte
    const parts = data.split('\0')[0].trim().split(' ');
    if (parts.length >= 3) {
      const [oldSha, newSha, refName] = parts;
      if (oldSha.length === 40 && newSha.length === 40 && refName.startsWith('refs/')) {
        refs.push({ oldSha, newSha, refName });
      }
    }
  }

  return refs;
}

/**
 * Stream-based upload pack for large repos
 */
export function streamUploadPack(
  ownerSlug: string,
  repoSlug: string,
  input: Readable
): { contentType: string; stream: Readable } {
  const repoPath = getRepoPath(ownerSlug, repoSlug);
  const proc = spawn('git-upload-pack', ['--stateless-rpc', repoPath]);

  // Pipe input to git process
  input.pipe(proc.stdin);

  return {
    contentType: 'application/x-git-upload-pack-result',
    stream: proc.stdout,
  };
}

/**
 * Stream-based receive pack for large pushes
 */
export function streamReceivePack(
  ownerSlug: string,
  repoSlug: string,
  input: Readable
): { contentType: string; stream: Readable } {
  const repoPath = getRepoPath(ownerSlug, repoSlug);
  const proc = spawn('git-receive-pack', ['--stateless-rpc', repoPath]);

  // Pipe input to git process
  input.pipe(proc.stdin);

  return {
    contentType: 'application/x-git-receive-pack-result',
    stream: proc.stdout,
  };
}
