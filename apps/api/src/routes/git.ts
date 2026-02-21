import { Hono } from 'hono';

import { optionalAuth } from '../middleware/auth';
import {
  handleInfoRefs,
  handleUploadPack,
  handleReceivePack,
  parseReceivedRefs,
  type GitService,
} from '../services/git/git-http.service';
import {
  repoExists,
  initBareRepo,
} from '../services/git/git-backend.service';
import { processPostReceive } from '../services/git/sync.service';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
  canUserWriteToRepo,
} from '../services/repository.service';
import {
  validatePush,
  formatGitError,
} from '../services/branch-protection.service';
import {
  validateTokenWithAnyScope,
} from '../services/pat.service';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const gitRoutes = new Hono<AppEnv>();

// Middleware to verify repo exists and check access
async function verifyRepoAccess(
  owner: string,
  repoSlug: string,
  userId: string | null,
  requireWrite: boolean
): Promise<{ repoId: string; provider: string }> {
  // Get repo from database
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo) {
    throw new NotFoundError('Repository');
  }

  // Check if it's a local repo
  if (repo.provider !== 'local') {
    throw new ForbiddenError('Git operations only available for local repositories');
  }

  // Check access
  if (requireWrite) {
    if (!userId) {
      throw new ForbiddenError('Authentication required for write access');
    }
    const canWrite = await canUserWriteToRepo(repo.id, userId);
    if (!canWrite) {
      throw new ForbiddenError('Write access required');
    }
  } else {
    const canRead = await canUserAccessRepo(repo.id, userId);
    if (!canRead) {
      throw new NotFoundError('Repository'); // Don't reveal existence
    }
  }

  return { repoId: repo.id, provider: repo.provider };
}

// Parse Basic auth header
function parseBasicAuth(authHeader: string | undefined): { username: string; password: string } | null {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const [username, password] = decoded.split(':');
    return { username, password: password || '' };
  } catch {
    return null;
  }
}

// Authenticate via Personal Access Token
// Returns userId if valid, null otherwise
async function authenticateWithPAT(
  authHeader: string | undefined,
  requiredScopes: string[]
): Promise<string | null> {
  const basicAuth = parseBasicAuth(authHeader);
  if (!basicAuth) {
    return null;
  }

  // Git clients send the token as the password
  // Username can be anything (typically 'git' or the actual username)
  const { password: token } = basicAuth;

  // Check if it's a PAT (starts with cv_pat_)
  if (!token.startsWith('cv_pat_')) {
    return null;
  }

  const result = await validateTokenWithAnyScope(token, requiredScopes);

  if (result.valid && result.userId) {
    return result.userId;
  }

  return null;
}

// Ensure bare repo exists on disk, lazily initializing if the DB record exists but storage doesn't
async function ensureRepoStorage(owner: string, repo: string, defaultBranch = 'main'): Promise<void> {
  const exists = await repoExists(owner, repo);
  if (!exists) {
    // Repo is in DB (verified by verifyRepoAccess) but not on disk — initialize it
    console.log(`[Git] Lazy-initializing bare repo for ${owner}/${repo}`);
    await initBareRepo(owner, repo, defaultBranch);
  }
}

// GET /:owner/:repo.git/info/refs - Discovery endpoint
gitRoutes.get('/:owner/:repo/info/refs', optionalAuth, async (c) => {
  const { owner } = c.req.param();
  let { repo } = c.req.param();
  const service = c.req.query('service') as GitService | undefined;

  // Strip .git suffix if present
  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  if (!service || !['git-upload-pack', 'git-receive-pack'].includes(service)) {
    return c.text('Invalid service', 400);
  }

  // Get user from session or Basic auth (PAT)
  let userId = c.get('userId') || null;

  // Check for PAT via Basic auth if no session
  if (!userId) {
    const authHeader = c.req.header('authorization');
    // Determine required scopes based on operation
    const requiredScopes = service === 'git-receive-pack'
      ? ['repo:write', 'repo:admin']
      : ['repo:read', 'repo:write', 'repo:admin'];

    userId = await authenticateWithPAT(authHeader, requiredScopes);
  }

  const requireWrite = service === 'git-receive-pack';

  try {
    await verifyRepoAccess(owner, repo, userId, requireWrite);
  } catch (err) {
    if (!userId) {
      // Request authentication — git needs 401 + WWW-Authenticate to send credentials
      c.header('WWW-Authenticate', 'Basic realm="CV-Hub Git"');
      return c.text('Authentication required', 401);
    }
    throw err;
  }

  // Ensure bare repo exists on disk (lazy-init if DB record exists but storage doesn't)
  await ensureRepoStorage(owner, repo);

  const result = await handleInfoRefs(owner, repo, service);

  return new Response(new Uint8Array(result.body), {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'no-cache',
    },
  });
});

// POST /:owner/:repo.git/git-upload-pack - Clone/Fetch
gitRoutes.post('/:owner/:repo/git-upload-pack', optionalAuth, async (c) => {
  const { owner } = c.req.param();
  let { repo } = c.req.param();

  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  // Get user from session or Basic auth (PAT)
  let userId = c.get('userId') || null;

  // Check for PAT via Basic auth if no session
  if (!userId) {
    const authHeader = c.req.header('authorization');
    userId = await authenticateWithPAT(authHeader, ['repo:read', 'repo:write', 'repo:admin']);
  }

  try {
    await verifyRepoAccess(owner, repo, userId, false);
  } catch (err) {
    if (!userId) {
      c.header('WWW-Authenticate', 'Basic realm="CV-Hub Git"');
      return c.text('Authentication required', 401);
    }
    throw err;
  }

  // Ensure bare repo exists on disk (lazy-init if needed)
  await ensureRepoStorage(owner, repo);

  const requestBody = Buffer.from(await c.req.arrayBuffer());
  const result = await handleUploadPack(owner, repo, requestBody);

  return new Response(new Uint8Array(result.body), {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'no-cache',
    },
  });
});

// POST /:owner/:repo.git/git-receive-pack - Push
gitRoutes.post('/:owner/:repo/git-receive-pack', optionalAuth, async (c) => {
  const { owner } = c.req.param();
  let { repo } = c.req.param();

  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  // Get user from session or Basic auth (PAT)
  let userId = c.get('userId') || null;

  if (!userId) {
    const authHeader = c.req.header('authorization');
    // Push requires repo:write or repo:admin scope
    userId = await authenticateWithPAT(authHeader, ['repo:write', 'repo:admin']);
  }

  if (!userId) {
    c.header('WWW-Authenticate', 'Basic realm="CV-Hub Git"');
    return c.text('Authentication required for push', 401);
  }

  const { repoId } = await verifyRepoAccess(owner, repo, userId, true);

  // Ensure bare repo exists on disk (lazy-init if needed)
  await ensureRepoStorage(owner, repo);

  const requestBody = Buffer.from(await c.req.arrayBuffer());

  // Parse refs from the push request for branch protection validation
  const pushRefs = parseReceivedRefs(requestBody);

  // Validate push against branch protection rules BEFORE processing
  if (pushRefs.length > 0) {
    const validation = await validatePush(repoId, pushRefs, userId);
    if (!validation.allowed) {
      // Return git-formatted error message
      const errorMessage = formatGitError(validation.reason || 'Push rejected by branch protection rules');
      return new Response(errorMessage, {
        status: 403,
        headers: {
          'Content-Type': 'text/plain',
        },
      });
    }
  }

  const result = await handleReceivePack(owner, repo, requestBody, (refs) => {
    // Post-receive hook - sync metadata to database
    console.log(`[Git Push] ${owner}/${repo}:`, refs.map(r => `${r.refName}`).join(', '));

    // Process the push asynchronously (don't block the response)
    processPostReceive(repoId, refs).catch((err) => {
      console.error(`[Git Push] Sync failed for ${owner}/${repo}:`, err);
    });
  });

  return new Response(new Uint8Array(result.body), {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'no-cache',
    },
  });
});

export { gitRoutes };
