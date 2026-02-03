/**
 * SSH Server for Git Operations
 * Handles git-upload-pack and git-receive-pack over SSH protocol
 */

import ssh2 from 'ssh2';
const { Server } = ssh2;
import type { Connection, Session, AuthContext, ServerChannel, AcceptConnection, RejectConnection, ExecInfo } from 'ssh2';
import { spawn, execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { env } from '../../config/env';
import {
  findUserByFingerprint,
  updateLastUsed,
  calculateFingerprint,
} from '../ssh-keys.service';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
  canUserWriteToRepo,
} from '../repository.service';
import { repoExists } from './git-backend.service';
import { validatePush } from '../branch-protection.service';
import { processPostReceive } from './sync.service';
import { parseReceivedRefs } from './git-http.service';

// ============================================================================
// Types
// ============================================================================

interface AuthenticatedUser {
  id: string;
  username: string;
  keyId: string;
}

interface GitCommand {
  command: 'git-upload-pack' | 'git-receive-pack';
  repoPath: string;
  owner: string;
  repo: string;
}

// ============================================================================
// Host Key Management
// ============================================================================

/**
 * Load or generate SSH host key
 */
async function loadHostKey(): Promise<string> {
  // Try to load from configured path
  if (env.SSH_HOST_KEY_PATH) {
    try {
      const key = await fs.readFile(env.SSH_HOST_KEY_PATH, 'utf-8');
      console.log('[SSH] Loaded host key from', env.SSH_HOST_KEY_PATH);
      return key;
    } catch (error) {
      console.error('[SSH] Failed to load host key from', env.SSH_HOST_KEY_PATH, error);
    }
  }

  // Try to load from default location
  const defaultKeyPath = path.join(env.GIT_STORAGE_PATH, '.ssh', 'host_key');
  try {
    const key = await fs.readFile(defaultKeyPath, 'utf-8');
    console.log('[SSH] Loaded host key from', defaultKeyPath);
    return key;
  } catch {
    // Generate new key
    console.log('[SSH] Generating new host key...');
    const key = await generateHostKey(defaultKeyPath);
    return key;
  }
}

/**
 * Generate a new ED25519 host key using ssh-keygen (OpenSSH format)
 */
async function generateHostKey(savePath: string): Promise<string> {
  await fs.mkdir(path.dirname(savePath), { recursive: true });

  // Remove existing key files if present
  try { await fs.unlink(savePath); } catch {}
  try { await fs.unlink(savePath + '.pub'); } catch {}

  // Use ssh-keygen to generate key in OpenSSH format (compatible with ssh2)
  execSync(`ssh-keygen -t ed25519 -f "${savePath}" -N "" -q`);

  const key = await fs.readFile(savePath, 'utf-8');
  console.log('[SSH] Generated and saved host key to', savePath);
  return key;
}

// ============================================================================
// Authentication
// ============================================================================

/**
 * Authenticate user via public key
 */
async function authenticatePublicKey(
  ctx: AuthContext,
  key: { algo: string; data: Buffer }
): Promise<AuthenticatedUser | null> {
  // Calculate fingerprint from the key data
  const keyData = key.data.toString('base64');
  const fingerprint = calculateFingerprint(keyData);

  console.log('[SSH] Auth attempt with fingerprint:', fingerprint);

  // Look up user by fingerprint
  const sshKey = await findUserByFingerprint(fingerprint);

  if (!sshKey) {
    console.log('[SSH] No user found for fingerprint:', fingerprint);
    return null;
  }

  console.log('[SSH] Authenticated user:', sshKey.user.username);

  // Update last used timestamp
  await updateLastUsed(sshKey.id);

  return {
    id: sshKey.user.id,
    username: sshKey.user.username,
    keyId: sshKey.id,
  };
}

// ============================================================================
// Command Parsing
// ============================================================================

/**
 * Parse git command from SSH exec request
 */
function parseGitCommand(commandLine: string): GitCommand | null {
  // Expected format: git-upload-pack 'owner/repo.git' or git-receive-pack 'owner/repo.git'
  const match = commandLine.match(/^(git-upload-pack|git-receive-pack)\s+['"]?([^'"]+)['"]?$/);

  if (!match) {
    return null;
  }

  const [, command, repoPath] = match;

  // Parse owner/repo from path
  // Format: /owner/repo.git or owner/repo.git or owner/repo
  const cleanPath = repoPath.replace(/^\//, '').replace(/\.git$/, '');
  const parts = cleanPath.split('/');

  if (parts.length !== 2) {
    return null;
  }

  const [owner, repo] = parts;

  return {
    command: command as 'git-upload-pack' | 'git-receive-pack',
    repoPath: cleanPath,
    owner,
    repo,
  };
}

// ============================================================================
// Git Command Execution
// ============================================================================

/**
 * Execute git command for authenticated session
 */
async function executeGitCommand(
  _session: Session,
  user: AuthenticatedUser,
  gitCmd: GitCommand,
  channel: ServerChannel
): Promise<void> {
  const { command, owner, repo } = gitCmd;
  const isWrite = command === 'git-receive-pack';

  console.log(`[SSH] ${user.username} executing ${command} on ${owner}/${repo}`);

  // Verify repository exists and user has access
  const repoRecord = await getRepositoryByOwnerAndSlug(owner, repo);

  if (!repoRecord) {
    channel.stderr.write('ERROR: Repository not found\n');
    channel.close();
    return;
  }

  if (repoRecord.provider !== 'local') {
    channel.stderr.write('ERROR: SSH access only available for local repositories\n');
    channel.close();
    return;
  }

  // Check access permissions
  if (isWrite) {
    const canWrite = await canUserWriteToRepo(repoRecord.id, user.id);
    if (!canWrite) {
      channel.stderr.write('ERROR: Write access denied\n');
      channel.close();
      return;
    }
  } else {
    const canRead = await canUserAccessRepo(repoRecord.id, user.id);
    if (!canRead) {
      channel.stderr.write('ERROR: Repository not found\n');
      channel.close();
      return;
    }
  }

  // Check if bare repo exists on disk
  const exists = await repoExists(owner, repo);
  if (!exists) {
    channel.stderr.write('ERROR: Repository storage not initialized\n');
    channel.close();
    return;
  }

  // Get the full repo path
  const fullRepoPath = path.join(env.GIT_STORAGE_PATH, owner, `${repo}.git`);

  // For receive-pack, we need to collect the input to validate branch protection
  if (isWrite) {
    await executeReceivePack(channel, fullRepoPath, repoRecord.id, user);
  } else {
    await executeUploadPack(channel, fullRepoPath);
  }
}

/**
 * Execute git-upload-pack (clone/fetch)
 */
async function executeUploadPack(channel: ServerChannel, repoPath: string): Promise<void> {
  const proc = spawn('git-upload-pack', [repoPath]);

  // Pipe channel to git process
  channel.pipe(proc.stdin);
  proc.stdout.pipe(channel);
  proc.stderr.pipe(channel.stderr);

  proc.on('close', (code) => {
    channel.exit(code || 0);
    channel.close();
  });

  proc.on('error', (error) => {
    console.error('[SSH] git-upload-pack error:', error);
    channel.stderr.write(`ERROR: ${error.message}\n`);
    channel.exit(1);
    channel.close();
  });
}

/**
 * Execute git-receive-pack (push) with branch protection
 */
async function executeReceivePack(
  channel: ServerChannel,
  repoPath: string,
  repoId: string,
  user: AuthenticatedUser
): Promise<void> {
  // We need to intercept the push data to validate branch protection
  // Collect the initial negotiation data
  const chunks: Buffer[] = [];
  let headerReceived = false;
  let pushRefs: Array<{ oldSha: string; newSha: string; refName: string }> = [];

  const proc = spawn('git-receive-pack', [repoPath]);

  // Handle stdout from git
  proc.stdout.on('data', (data) => {
    channel.write(data);
  });

  proc.stderr.on('data', (data) => {
    channel.stderr.write(data);
  });

  // Handle incoming data from client
  channel.on('data', async (data: Buffer) => {
    if (!headerReceived) {
      chunks.push(data);

      // Try to parse refs from the accumulated data
      const fullData = Buffer.concat(chunks);
      const refs = parseReceivedRefs(fullData);

      if (refs.length > 0) {
        headerReceived = true;
        pushRefs = refs;

        // Validate branch protection
        const validation = await validatePush(repoId, pushRefs, user.id);

        if (!validation.allowed) {
          // Reject the push
          const errorMsg = `ERROR: ${validation.reason || 'Push rejected by branch protection'}\n`;
          channel.stderr.write(errorMsg);
          proc.kill();
          channel.exit(1);
          channel.close();
          return;
        }

        // Send all buffered data to git
        proc.stdin.write(fullData);
      }
    } else {
      // Pass through after header
      proc.stdin.write(data);
    }
  });

  channel.on('end', () => {
    proc.stdin.end();
  });

  proc.on('close', (code) => {
    if (code === 0 && pushRefs.length > 0) {
      // Post-receive hook - sync metadata to database
      const ownerRepo = repoPath.split('/').slice(-2);
      const owner = ownerRepo[0];
      const repo = ownerRepo[1].replace('.git', '');
      console.log(`[SSH Push] ${owner}/${repo}:`, pushRefs.map(r => r.refName).join(', '));

      processPostReceive(repoId, pushRefs).catch((err) => {
        console.error(`[SSH Push] Sync failed for ${owner}/${repo}:`, err);
      });
    }

    channel.exit(code || 0);
    channel.close();
  });

  proc.on('error', (error) => {
    console.error('[SSH] git-receive-pack error:', error);
    channel.stderr.write(`ERROR: ${error.message}\n`);
    channel.exit(1);
    channel.close();
  });
}

// ============================================================================
// Server Setup
// ============================================================================

let sshServer: InstanceType<typeof Server> | null = null;

/**
 * Start the SSH server
 */
export async function startSshServer(): Promise<void> {
  if (!env.SSH_ENABLED) {
    console.log('[SSH] SSH server disabled');
    return;
  }

  let hostKey = await loadHostKey();

  // Validate key by attempting to create the server; regenerate if format is invalid
  const createServer = (key: string) => new Server({ hostKeys: [key] }, connectionHandler);

  const connectionHandler = (client: Connection) => {
    let authenticatedUser: AuthenticatedUser | null = null;

    console.log('[SSH] Client connected');

    client.on('authentication', async (ctx: AuthContext) => {
      if (ctx.method === 'publickey') {
        // Check if signature verification is needed
        if (!ctx.signature) {
          // First pass - just acknowledge we accept this key type
          return ctx.accept();
        }

        // Second pass - verify signature
        const user = await authenticatePublicKey(ctx, ctx.key);
        if (user) {
          authenticatedUser = user;
          return ctx.accept();
        }
      }

      // Reject all other auth methods
      ctx.reject(['publickey']);
    });

    client.on('ready', () => {
      console.log('[SSH] Client authenticated:', authenticatedUser?.username || 'unknown');

      client.on('session', (acceptSession: AcceptConnection<Session>) => {
        const session = acceptSession();

        session.on('exec', async (
          acceptExec: AcceptConnection<ServerChannel>,
          rejectExec: RejectConnection | undefined,
          info: ExecInfo
        ) => {
          if (!authenticatedUser) {
            rejectExec?.();
            return;
          }

          const gitCmd = parseGitCommand(info.command);

          if (!gitCmd) {
            const channel = acceptExec();
            channel.stderr.write('ERROR: Invalid command. Only git operations are supported.\n');
            channel.exit(1);
            channel.close();
            return;
          }

          const channel = acceptExec();
          await executeGitCommand(session, authenticatedUser, gitCmd, channel);
        });
      });
    });

    client.on('error', (err: Error) => {
      console.error('[SSH] Client error:', err.message);
    });

    client.on('end', () => {
      console.log('[SSH] Client disconnected');
    });
  };

  try {
    sshServer = createServer(hostKey);
  } catch (error) {
    console.warn('[SSH] Host key format invalid, regenerating...', (error as Error).message);
    const defaultKeyPath = path.join(env.GIT_STORAGE_PATH, '.ssh', 'host_key');
    hostKey = await generateHostKey(defaultKeyPath);
    sshServer = createServer(hostKey);
  }

  sshServer.listen(env.SSH_PORT, env.SSH_HOST, () => {
    console.log(`[SSH] Server listening on ${env.SSH_HOST}:${env.SSH_PORT}`);
  });

  sshServer.on('error', (err: Error) => {
    console.error('[SSH] Server error:', err);
  });
}

/**
 * Stop the SSH server
 */
export async function stopSshServer(): Promise<void> {
  if (sshServer) {
    sshServer.close();
    sshServer = null;
    console.log('[SSH] Server stopped');
  }
}

/**
 * Get SSH server status
 */
export function getSshServerStatus(): { enabled: boolean; running: boolean; port: number; host: string } {
  return {
    enabled: env.SSH_ENABLED,
    running: sshServer !== null,
    port: env.SSH_PORT,
    host: env.SSH_HOST,
  };
}
