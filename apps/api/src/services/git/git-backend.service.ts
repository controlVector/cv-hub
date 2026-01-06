import { simpleGit } from 'simple-git';
import type { SimpleGit, SimpleGitOptions } from 'simple-git';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { env } from '../../config/env';

// Types
export interface GitRef {
  name: string;
  sha: string;
  type: 'branch' | 'tag';
  isDefault?: boolean;
}

export interface GitTreeEntry {
  name: string;
  path: string;
  type: 'blob' | 'tree' | 'commit'; // commit = submodule
  mode: string;
  sha: string;
  size?: number;
}

export interface GitBlob {
  sha: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  size: number;
  isBinary: boolean;
}

export interface GitCommit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: Date;
  };
  committer: {
    name: string;
    email: string;
    date: Date;
  };
  parents: string[];
  tree: string;
}

export interface GitBlameLine {
  sha: string;
  lineNumber: number;
  content: string;
  author: string;
  authorEmail: string;
  date: Date;
  summary: string;
}

export interface GitDiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
  additions: number;
  deletions: number;
  patch?: string;
}

export interface GitDiff {
  baseSha: string;
  headSha: string;
  files: GitDiffFile[];
  stats: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
}

// Helper to get repo path
function getRepoPath(ownerSlug: string, repoSlug: string): string {
  return path.join(env.GIT_STORAGE_PATH, ownerSlug, `${repoSlug}.git`);
}

// Get SimpleGit instance for a repo
function getGit(repoPath: string): SimpleGit {
  const options: Partial<SimpleGitOptions> = {
    baseDir: repoPath,
    binary: 'git',
    maxConcurrentProcesses: 6,
  };
  return simpleGit(options);
}

// Execute git command and return stdout
function execGit(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: repoPath });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Git command failed: ${stderr || stdout}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Initialize a new bare repository
 */
export async function initBareRepo(ownerSlug: string, repoSlug: string, defaultBranch = 'main'): Promise<string> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  // Create directory structure
  await fs.mkdir(repoPath, { recursive: true });

  // Initialize bare repo
  await execGit(repoPath, ['init', '--bare']);

  // Set default branch
  await execGit(repoPath, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);

  // Set repo config
  await execGit(repoPath, ['config', 'receive.denyNonFastForwards', 'false']);
  await execGit(repoPath, ['config', 'receive.denyDeleteCurrent', 'true']);

  return repoPath;
}

/**
 * Delete a bare repository
 */
export async function deleteBareRepo(ownerSlug: string, repoSlug: string): Promise<void> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  try {
    await fs.rm(repoPath, { recursive: true, force: true });
  } catch (err) {
    // Ignore if doesn't exist
  }
}

/**
 * Check if repository exists
 */
export async function repoExists(ownerSlug: string, repoSlug: string): Promise<boolean> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  try {
    const stat = await fs.stat(path.join(repoPath, 'HEAD'));
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Get all refs (branches and tags)
 */
export async function getRefs(ownerSlug: string, repoSlug: string): Promise<GitRef[]> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);
  const git = getGit(repoPath);

  const refs: GitRef[] = [];

  // Get HEAD to determine default branch
  let defaultBranch = 'main';
  try {
    const head = await execGit(repoPath, ['symbolic-ref', 'HEAD']);
    defaultBranch = head.trim().replace('refs/heads/', '');
  } catch {
    // No commits yet
  }

  // Get branches
  try {
    const branches = await git.branch(['-a']);
    for (const [name, data] of Object.entries(branches.branches)) {
      if (!name.startsWith('remotes/')) {
        refs.push({
          name,
          sha: data.commit,
          type: 'branch',
          isDefault: name === defaultBranch,
        });
      }
    }
  } catch {
    // No branches yet
  }

  // Get tags
  try {
    const tags = await git.tags();
    for (const tagName of tags.all) {
      const sha = await execGit(repoPath, ['rev-parse', tagName]);
      refs.push({
        name: tagName,
        sha: sha.trim(),
        type: 'tag',
      });
    }
  } catch {
    // No tags
  }

  return refs;
}

/**
 * Get tree contents at a path
 */
export async function getTree(
  ownerSlug: string,
  repoSlug: string,
  ref: string,
  treePath = ''
): Promise<GitTreeEntry[]> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  // Resolve ref to sha
  const sha = await execGit(repoPath, ['rev-parse', ref]);
  const commitSha = sha.trim();

  // Get tree at path
  const lsTreeArgs = ['ls-tree', '-l', commitSha];
  if (treePath) {
    lsTreeArgs.push('--', treePath);
  }

  const output = await execGit(repoPath, lsTreeArgs);
  const entries: GitTreeEntry[] = [];

  for (const line of output.split('\n').filter(Boolean)) {
    // Format: <mode> <type> <sha> <size>\t<path>
    const match = line.match(/^(\d+)\s+(blob|tree|commit)\s+([a-f0-9]+)\s+(-|\d+)\t(.+)$/);
    if (match) {
      const [, mode, type, entrySha, sizeStr, entryPath] = match;
      const name = treePath
        ? entryPath.replace(treePath + '/', '')
        : entryPath;

      // Skip if this is a deeper path
      if (name.includes('/')) continue;

      entries.push({
        name,
        path: entryPath,
        type: type as 'blob' | 'tree' | 'commit',
        mode,
        sha: entrySha,
        size: sizeStr === '-' ? undefined : parseInt(sizeStr, 10),
      });
    }
  }

  // Sort: directories first, then files, alphabetically
  return entries.sort((a, b) => {
    if (a.type === 'tree' && b.type !== 'tree') return -1;
    if (a.type !== 'tree' && b.type === 'tree') return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get blob content
 */
export async function getBlob(
  ownerSlug: string,
  repoSlug: string,
  ref: string,
  filePath: string
): Promise<GitBlob> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  // Get blob sha
  const lsTree = await execGit(repoPath, ['ls-tree', ref, '--', filePath]);
  const match = lsTree.match(/^(\d+)\s+blob\s+([a-f0-9]+)\s+/);

  if (!match) {
    throw new Error(`File not found: ${filePath}`);
  }

  const blobSha = match[2];

  // Get blob size
  const sizeOutput = await execGit(repoPath, ['cat-file', '-s', blobSha]);
  const size = parseInt(sizeOutput.trim(), 10);

  // Get content
  const content = await execGit(repoPath, ['cat-file', 'blob', blobSha]);

  // Detect binary by checking for null bytes
  const isBinary = content.includes('\0');

  if (isBinary) {
    // Return base64 for binary files
    const buffer = Buffer.from(content, 'binary');
    return {
      sha: blobSha,
      content: buffer.toString('base64'),
      encoding: 'base64',
      size,
      isBinary: true,
    };
  }

  return {
    sha: blobSha,
    content,
    encoding: 'utf-8',
    size,
    isBinary: false,
  };
}

/**
 * Get commit info
 */
export async function getCommit(
  ownerSlug: string,
  repoSlug: string,
  sha: string
): Promise<GitCommit> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  // Get commit info with custom format
  const format = '%H%n%T%n%P%n%an%n%ae%n%aI%n%cn%n%ce%n%cI%n%B';
  const output = await execGit(repoPath, ['show', '-s', `--format=${format}`, sha]);

  const lines = output.split('\n');
  const [commitSha, tree, parents, authorName, authorEmail, authorDate,
    committerName, committerEmail, committerDate, ...messageLines] = lines;

  return {
    sha: commitSha,
    tree,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    author: {
      name: authorName,
      email: authorEmail,
      date: new Date(authorDate),
    },
    committer: {
      name: committerName,
      email: committerEmail,
      date: new Date(committerDate),
    },
    message: messageLines.join('\n').trim(),
  };
}

/**
 * Get commit history
 */
export async function getCommitHistory(
  ownerSlug: string,
  repoSlug: string,
  ref: string,
  options: { limit?: number; offset?: number; path?: string } = {}
): Promise<GitCommit[]> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);
  const { limit = 30, offset = 0, path: filePath } = options;

  const args = [
    'log',
    `--skip=${offset}`,
    `-n${limit}`,
    '--format=%H',
    ref,
  ];

  if (filePath) {
    args.push('--', filePath);
  }

  const output = await execGit(repoPath, args);
  const shas = output.split('\n').filter(Boolean);

  const commits: GitCommit[] = [];
  for (const sha of shas) {
    commits.push(await getCommit(ownerSlug, repoSlug, sha));
  }

  return commits;
}

/**
 * Get blame for a file
 */
export async function getBlame(
  ownerSlug: string,
  repoSlug: string,
  ref: string,
  filePath: string
): Promise<GitBlameLine[]> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  // Use porcelain format for easy parsing
  const output = await execGit(repoPath, [
    'blame',
    '--porcelain',
    ref,
    '--',
    filePath,
  ]);

  const lines: GitBlameLine[] = [];
  const commits = new Map<string, { author: string; email: string; time: number; summary: string }>();

  const outputLines = output.split('\n');
  let i = 0;
  let lineNumber = 0;

  while (i < outputLines.length) {
    const headerLine = outputLines[i];
    if (!headerLine) {
      i++;
      continue;
    }

    const headerMatch = headerLine.match(/^([a-f0-9]{40})\s+(\d+)\s+(\d+)/);
    if (!headerMatch) {
      i++;
      continue;
    }

    const [, sha, , resultLine] = headerMatch;
    lineNumber = parseInt(resultLine, 10);
    i++;

    // Parse commit info if we haven't seen this commit
    if (!commits.has(sha)) {
      const commitInfo: any = {};

      while (i < outputLines.length && !outputLines[i].startsWith('\t')) {
        const line = outputLines[i];
        if (line.startsWith('author ')) {
          commitInfo.author = line.slice(7);
        } else if (line.startsWith('author-mail ')) {
          commitInfo.email = line.slice(12).replace(/[<>]/g, '');
        } else if (line.startsWith('author-time ')) {
          commitInfo.time = parseInt(line.slice(12), 10);
        } else if (line.startsWith('summary ')) {
          commitInfo.summary = line.slice(8);
        }
        i++;
      }

      commits.set(sha, commitInfo);
    } else {
      // Skip to content line
      while (i < outputLines.length && !outputLines[i].startsWith('\t')) {
        i++;
      }
    }

    // Get content line (starts with tab)
    const contentLine = outputLines[i];
    const content = contentLine?.startsWith('\t') ? contentLine.slice(1) : '';
    i++;

    const commitInfo = commits.get(sha)!;
    lines.push({
      sha,
      lineNumber,
      content,
      author: commitInfo.author,
      authorEmail: commitInfo.email,
      date: new Date(commitInfo.time * 1000),
      summary: commitInfo.summary,
    });
  }

  return lines;
}

/**
 * Compare two refs and get diff
 */
export async function getDiff(
  ownerSlug: string,
  repoSlug: string,
  base: string,
  head: string
): Promise<GitDiff> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  // Resolve refs
  const baseSha = (await execGit(repoPath, ['rev-parse', base])).trim();
  const headSha = (await execGit(repoPath, ['rev-parse', head])).trim();

  // Get diff stats
  const statsOutput = await execGit(repoPath, [
    'diff',
    '--numstat',
    '-M',
    `${baseSha}...${headSha}`,
  ]);

  const files: GitDiffFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const line of statsOutput.split('\n').filter(Boolean)) {
    const [additions, deletions, filePath] = line.split('\t');
    const adds = additions === '-' ? 0 : parseInt(additions, 10);
    const dels = deletions === '-' ? 0 : parseInt(deletions, 10);

    totalAdditions += adds;
    totalDeletions += dels;

    // Detect renames
    const renameMatch = filePath.match(/^(.+)\{(.+) => (.+)\}(.*)$/);
    let oldPath: string | undefined;
    let newPath: string;

    if (renameMatch) {
      const [, prefix, from, to, suffix] = renameMatch;
      oldPath = prefix + from + suffix;
      newPath = prefix + to + suffix;
    } else if (filePath.includes(' => ')) {
      [oldPath, newPath] = filePath.split(' => ');
    } else {
      newPath = filePath;
    }

    // Determine status
    let status: GitDiffFile['status'] = 'modified';
    if (adds > 0 && dels === 0 && !oldPath) {
      status = 'added';
    } else if (adds === 0 && dels > 0) {
      status = 'deleted';
    } else if (oldPath) {
      status = 'renamed';
    }

    files.push({
      path: newPath,
      oldPath,
      status,
      additions: adds,
      deletions: dels,
    });
  }

  return {
    baseSha,
    headSha,
    files,
    stats: {
      additions: totalAdditions,
      deletions: totalDeletions,
      filesChanged: files.length,
    },
  };
}

/**
 * Get diff patch for a single file
 */
export async function getFileDiff(
  ownerSlug: string,
  repoSlug: string,
  base: string,
  head: string,
  filePath: string
): Promise<string> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  const output = await execGit(repoPath, [
    'diff',
    `${base}...${head}`,
    '--',
    filePath,
  ]);

  return output;
}

/**
 * Get repository statistics
 */
export async function getRepoStats(ownerSlug: string, repoSlug: string): Promise<{
  commitCount: number;
  branchCount: number;
  tagCount: number;
  size: number;
}> {
  const repoPath = getRepoPath(ownerSlug, repoSlug);

  let commitCount = 0;
  let branchCount = 0;
  let tagCount = 0;

  try {
    const commits = await execGit(repoPath, ['rev-list', '--count', '--all']);
    commitCount = parseInt(commits.trim(), 10) || 0;
  } catch {
    // No commits
  }

  try {
    const branches = await execGit(repoPath, ['branch', '--list']);
    branchCount = branches.split('\n').filter(Boolean).length;
  } catch {
    // No branches
  }

  try {
    const tags = await execGit(repoPath, ['tag', '--list']);
    tagCount = tags.split('\n').filter(Boolean).length;
  } catch {
    // No tags
  }

  // Get size of .git directory
  let size = 0;
  try {
    const sizeOutput = await execGit(repoPath, ['count-objects', '-v']);
    const sizeMatch = sizeOutput.match(/size-pack:\s*(\d+)/);
    if (sizeMatch) {
      size = parseInt(sizeMatch[1], 10) * 1024; // Convert KB to bytes
    }
  } catch {
    // Ignore
  }

  return { commitCount, branchCount, tagCount, size };
}
