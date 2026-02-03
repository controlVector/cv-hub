/**
 * CODEOWNERS Service
 * Parses CODEOWNERS files and determines file ownership for auto-suggesting PR reviewers
 */

import { getBlob } from './git/git-backend.service';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface CodeownersEntry {
  pattern: string;
  owners: string[]; // @username, @org/team, or email
  line: number;
}

export interface CodeownersFile {
  entries: CodeownersEntry[];
  path: string; // Where the CODEOWNERS file was found
  errors: string[];
}

export interface FileOwnership {
  path: string;
  owners: string[];
  matchedPattern: string | null;
}

// ============================================================================
// CODEOWNERS Parsing
// ============================================================================

// Locations where CODEOWNERS file may live (checked in order)
const CODEOWNERS_PATHS = [
  'CODEOWNERS',
  '.github/CODEOWNERS',
  'docs/CODEOWNERS',
];

/**
 * Parse a CODEOWNERS file and attempt to read it from the repo.
 * Tries standard locations: root, .github/, docs/
 */
export async function parseCODEOWNERS(
  ownerSlug: string,
  repoSlug: string,
  ref = 'HEAD',
): Promise<CodeownersFile | null> {
  for (const filePath of CODEOWNERS_PATHS) {
    try {
      const blob = await getBlob(ownerSlug, repoSlug, ref, filePath);
      if (blob && !blob.isBinary) {
        const result = parseCodeownersContent(blob.content);
        return { ...result, path: filePath };
      }
    } catch {
      // File not found at this path, try next
      continue;
    }
  }

  return null;
}

/**
 * Parse raw CODEOWNERS content into structured entries
 */
export function parseCodeownersContent(content: string): { entries: CodeownersEntry[]; errors: string[] } {
  const entries: CodeownersEntry[] = [];
  const errors: string[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: Pattern has no owners specified`);
      continue;
    }

    const [pattern, ...ownerParts] = parts;

    // Validate owners
    const owners: string[] = [];
    for (const owner of ownerParts) {
      if (isValidOwner(owner)) {
        owners.push(owner);
      } else {
        errors.push(`Line ${i + 1}: Invalid owner format '${owner}'`);
      }
    }

    if (owners.length > 0) {
      entries.push({ pattern, owners, line: i + 1 });
    }
  }

  return { entries, errors };
}

/**
 * Validate owner format: @username, @org/team, or email
 */
function isValidOwner(owner: string): boolean {
  // @username or @org/team
  if (owner.startsWith('@') && owner.length > 1) return true;
  // Email address (basic check)
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) return true;
  return false;
}

// ============================================================================
// Owner Resolution
// ============================================================================

/**
 * Get owners for a set of file paths based on CODEOWNERS rules.
 * Last matching pattern wins (like .gitignore).
 */
export function getOwnersForPaths(
  entries: CodeownersEntry[],
  filePaths: string[],
): FileOwnership[] {
  return filePaths.map(filePath => {
    let matchedOwners: string[] = [];
    let matchedPattern: string | null = null;

    // Iterate all entries; last match wins
    for (const entry of entries) {
      if (matchesCodeownersPattern(filePath, entry.pattern)) {
        matchedOwners = entry.owners;
        matchedPattern = entry.pattern;
      }
    }

    return {
      path: filePath,
      owners: matchedOwners,
      matchedPattern,
    };
  });
}

/**
 * Get unique suggested reviewers for a set of changed files
 */
export function getSuggestedReviewers(
  entries: CodeownersEntry[],
  changedFiles: string[],
): string[] {
  const ownerships = getOwnersForPaths(entries, changedFiles);
  const allOwners = new Set<string>();

  for (const ownership of ownerships) {
    for (const owner of ownership.owners) {
      allOwners.add(owner);
    }
  }

  return Array.from(allOwners);
}

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Match a file path against a CODEOWNERS pattern.
 *
 * Pattern rules (subset of .gitignore):
 * - `*` matches anything except `/`
 * - `**` matches everything including `/`
 * - `?` matches a single character except `/`
 * - Leading `/` anchors to the root
 * - Trailing `/` matches directories
 * - No leading slash: matches anywhere in path
 */
export function matchesCodeownersPattern(filePath: string, pattern: string): boolean {
  // Normalize file path (remove leading slash)
  const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;

  // Handle directory pattern (trailing /)
  const isDirectoryPattern = pattern.endsWith('/');
  const cleanPattern = isDirectoryPattern ? pattern.slice(0, -1) : pattern;

  // Check if pattern is anchored (has leading /)
  const isAnchored = cleanPattern.startsWith('/');
  const patternBody = isAnchored ? cleanPattern.slice(1) : cleanPattern;

  // Build regex from pattern
  const regexStr = patternToRegex(patternBody, isDirectoryPattern);

  if (isAnchored) {
    // Must match from root
    const regex = new RegExp(`^${regexStr}`);
    return regex.test(normalizedPath);
  } else {
    // Can match anywhere in path
    // If pattern has no slash, it matches filename in any directory
    if (!patternBody.includes('/')) {
      const regex = new RegExp(`(^|/)${regexStr}($|/)`);
      return regex.test(normalizedPath);
    }
    // Otherwise, treat as anchored
    const regex = new RegExp(`^${regexStr}`);
    return regex.test(normalizedPath);
  }
}

/**
 * Convert a glob pattern to regex string
 */
function patternToRegex(pattern: string, isDirectory: boolean): string {
  let regex = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*' && pattern[i + 1] === '*') {
      // ** matches everything
      if (pattern[i + 2] === '/') {
        regex += '(.+/)?';
        i += 3;
      } else {
        regex += '.*';
        i += 2;
      }
    } else if (char === '*') {
      // * matches anything except /
      regex += '[^/]*';
      i++;
    } else if (char === '?') {
      regex += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(char)) {
      regex += `\\${char}`;
      i++;
    } else {
      regex += char;
      i++;
    }
  }

  if (isDirectory) {
    // Match the directory and everything inside it
    regex += '(/.*)?';
  }

  return regex + '$';
}
