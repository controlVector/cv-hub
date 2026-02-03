/**
 * Branch Protection Service
 * Enforces branch protection rules during git push operations
 */

import { db } from '../db';
import { branches, pullRequests, pullRequestReviews, repositoryMembers, repositories } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { isAncestor } from './git/git-backend.service';
import { checkRequiredStatuses } from './commit-status.service';

// ============================================================================
// Types
// ============================================================================

export interface ProtectionRules {
  requireReviews?: number;        // Minimum number of approvals required
  requireStatusChecks?: string[]; // Required CI status checks
  requireSignedCommits?: boolean; // Require GPG signed commits
  requireLinearHistory?: boolean; // No merge commits allowed
  allowForcePush?: boolean;       // Allow force pushes
  allowDeletions?: boolean;       // Allow branch deletion
  exemptUsers?: string[];         // User IDs exempt from rules
  exemptTeams?: string[];         // Team IDs exempt from rules
}

export interface PushRef {
  oldSha: string;
  newSha: string;
  refName: string;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  blockedRefs?: Array<{ refName: string; reason: string }>;
}

// Zero SHA indicates branch creation or deletion
const ZERO_SHA = '0000000000000000000000000000000000000000';

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validate a push operation against branch protection rules
 */
export async function validatePush(
  repoId: string,
  refs: PushRef[],
  userId: string
): Promise<ValidationResult> {
  // Get all protected branches for this repository
  const protectedBranches = await db.query.branches.findMany({
    where: and(
      eq(branches.repositoryId, repoId),
      eq(branches.isProtected, true)
    ),
  });

  if (protectedBranches.length === 0) {
    // No protected branches, allow all
    return { allowed: true };
  }

  const blockedRefs: Array<{ refName: string; reason: string }> = [];

  for (const ref of refs) {
    // Extract branch name from ref (e.g., refs/heads/main -> main)
    const branchName = extractBranchName(ref.refName);
    if (!branchName) continue; // Skip tags and other refs

    // Find matching protection rule
    const protectedBranch = protectedBranches.find(b =>
      matchesBranchPattern(branchName, b.name)
    );

    if (!protectedBranch) continue; // Branch not protected

    const rules = (protectedBranch.protectionRules as ProtectionRules) || {};

    // Check if user is exempt
    if (await isUserExempt(userId, repoId, rules)) {
      continue;
    }

    // Check for branch deletion
    if (ref.newSha === ZERO_SHA) {
      if (!rules.allowDeletions) {
        blockedRefs.push({
          refName: ref.refName,
          reason: `Cannot delete protected branch '${branchName}'`,
        });
      }
      continue;
    }

    // Check for force push (non-fast-forward)
    if (ref.oldSha !== ZERO_SHA) {
      const isForcePush = await detectForcePush(repoId, ref.oldSha, ref.newSha);
      if (isForcePush && !rules.allowForcePush) {
        blockedRefs.push({
          refName: ref.refName,
          reason: `Force push not allowed on protected branch '${branchName}'`,
        });
        continue;
      }
    }

    // Check if push requires PR
    if (rules.requireReviews && rules.requireReviews > 0) {
      const prCheck = await checkRequiresPR(repoId, branchName, ref.newSha, rules.requireReviews);
      if (!prCheck.allowed) {
        blockedRefs.push({
          refName: ref.refName,
          reason: prCheck.reason || `Direct push not allowed. Requires pull request with ${rules.requireReviews} approval(s)`,
        });
        continue;
      }
    }

    // Check for required status checks
    if (rules.requireStatusChecks && rules.requireStatusChecks.length > 0) {
      const statusCheck = await checkStatusChecks(repoId, ref.newSha, rules.requireStatusChecks);
      if (!statusCheck.allowed) {
        blockedRefs.push({
          refName: ref.refName,
          reason: statusCheck.reason || 'Required status checks have not passed',
        });
        continue;
      }
    }
  }

  if (blockedRefs.length > 0) {
    return {
      allowed: false,
      reason: blockedRefs[0].reason, // Primary reason
      blockedRefs,
    };
  }

  return { allowed: true };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract branch name from git ref
 */
function extractBranchName(refName: string): string | null {
  if (refName.startsWith('refs/heads/')) {
    return refName.slice(11); // Remove 'refs/heads/' prefix
  }
  return null; // Not a branch ref
}

/**
 * Check if branch name matches a protection pattern
 * Supports wildcards: * matches any sequence, ? matches single char
 */
function matchesBranchPattern(branchName: string, pattern: string): boolean {
  // Exact match
  if (branchName === pattern) return true;

  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
    .replace(/\*/g, '.*')                  // * -> .*
    .replace(/\?/g, '.');                  // ? -> .

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(branchName);
}

/**
 * Check if user is exempt from protection rules
 */
async function isUserExempt(
  userId: string,
  repoId: string,
  rules: ProtectionRules
): Promise<boolean> {
  // Check user exemption list
  if (rules.exemptUsers?.includes(userId)) {
    return true;
  }

  // Check if user is repository admin
  const membership = await db.query.repositoryMembers.findFirst({
    where: and(
      eq(repositoryMembers.repositoryId, repoId),
      eq(repositoryMembers.userId, userId),
      eq(repositoryMembers.role, 'admin')
    ),
  });

  if (membership) {
    // Admins are not automatically exempt unless explicitly listed
    // This can be changed based on policy
    return false;
  }

  // Check repository owner
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  });

  if (repo?.userId === userId) {
    // Personal repo owners might be exempt (configurable)
    return false;
  }

  return false;
}

/**
 * Detect if this is a force push (non-fast-forward)
 * Uses git merge-base --is-ancestor to check if oldSha is an ancestor of newSha
 */
async function detectForcePush(
  repoId: string,
  oldSha: string,
  newSha: string
): Promise<boolean> {
  // Look up the repository to get owner/repo slugs for filesystem access
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
    with: {
      owner: { columns: { username: true } },
      organization: { columns: { slug: true } },
    },
  });

  if (!repo) return false;

  const ownerSlug = repo.organization?.slug || repo.owner?.username;
  if (!ownerSlug) return false;

  // If oldSha is an ancestor of newSha, it's a fast-forward (not force push)
  const isFastForward = await isAncestor(ownerSlug, repo.slug, oldSha, newSha);
  return !isFastForward;
}

/**
 * Check if push is through an approved PR
 */
async function checkRequiresPR(
  repoId: string,
  targetBranch: string,
  newSha: string,
  requiredApprovals: number
): Promise<{ allowed: boolean; reason?: string }> {
  // Look for a merged PR that targets this branch with this SHA
  const pr = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.repositoryId, repoId),
      eq(pullRequests.targetBranch, targetBranch),
      eq(pullRequests.state, 'merged'),
      eq(pullRequests.mergeCommitSha, newSha)
    ),
    with: {
      reviews: true,
    },
  });

  if (pr) {
    // PR exists and is merged, check approvals
    const approvals = pr.reviews.filter(r => r.state === 'approved').length;
    if (approvals >= requiredApprovals) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `PR #${pr.number} has ${approvals} approval(s), requires ${requiredApprovals}`,
    };
  }

  // Also check for open PRs that might be in the process of merging
  const openPr = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.repositoryId, repoId),
      eq(pullRequests.targetBranch, targetBranch),
      eq(pullRequests.state, 'open'),
      eq(pullRequests.sourceSha, newSha)
    ),
    with: {
      reviews: true,
    },
  });

  if (openPr) {
    const approvals = openPr.reviews.filter(r => r.state === 'approved').length;
    if (approvals >= requiredApprovals) {
      // This might be a merge in progress
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `Direct pushes to '${targetBranch}' require a pull request with ${requiredApprovals} approval(s)`,
  };
}

/**
 * Check if required status checks have passed
 */
async function checkStatusChecks(
  repoId: string,
  sha: string,
  requiredChecks: string[]
): Promise<{ allowed: boolean; reason?: string }> {
  const result = await checkRequiredStatuses(repoId, sha, requiredChecks);

  if (result.passed) {
    return { allowed: true };
  }

  const reasons: string[] = [];
  if (result.missing.length > 0) {
    reasons.push(`Missing required checks: ${result.missing.join(', ')}`);
  }
  if (result.failing.length > 0) {
    reasons.push(`Failing checks: ${result.failing.join(', ')}`);
  }

  return {
    allowed: false,
    reason: reasons.join('. '),
  };
}

// ============================================================================
// Branch Protection Management
// ============================================================================

/**
 * Get protection rules for a branch
 */
export async function getBranchProtection(
  repoId: string,
  branchName: string
): Promise<{ isProtected: boolean; rules: ProtectionRules | null }> {
  const branch = await db.query.branches.findFirst({
    where: and(
      eq(branches.repositoryId, repoId),
      eq(branches.name, branchName)
    ),
  });

  if (!branch) {
    return { isProtected: false, rules: null };
  }

  return {
    isProtected: branch.isProtected,
    rules: (branch.protectionRules as ProtectionRules) || null,
  };
}

/**
 * Set protection rules for a branch
 */
export async function setBranchProtection(
  repoId: string,
  branchName: string,
  rules: ProtectionRules
): Promise<void> {
  await db.update(branches)
    .set({
      isProtected: true,
      protectionRules: rules,
      updatedAt: new Date(),
    })
    .where(and(
      eq(branches.repositoryId, repoId),
      eq(branches.name, branchName)
    ));
}

/**
 * Remove protection from a branch
 */
export async function removeBranchProtection(
  repoId: string,
  branchName: string
): Promise<void> {
  await db.update(branches)
    .set({
      isProtected: false,
      protectionRules: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(branches.repositoryId, repoId),
      eq(branches.name, branchName)
    ));
}

/**
 * Format git error message for client
 */
export function formatGitError(message: string): string {
  // Format as git sideband message
  const lines = message.split('\n');
  let result = '';

  for (const line of lines) {
    // Prefix with 'remote: ' for git client display
    result += `remote: ${line}\n`;
  }

  result += 'remote: \n';
  result += `remote: error: ${message}\n`;

  return result;
}
