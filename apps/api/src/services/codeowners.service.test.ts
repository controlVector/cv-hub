import { describe, it, expect } from 'vitest';
import {
  parseCodeownersContent,
  getOwnersForPaths,
  getSuggestedReviewers,
  matchesCodeownersPattern,
} from './codeowners.service';

describe('CODEOWNERSService', () => {
  // ============================================================
  // Parsing
  // ============================================================
  describe('parseCodeownersContent', () => {
    it('parses simple rules', () => {
      const content = `# Global owners
* @admin
/src/ @dev-team
*.js @js-reviewer`;

      const result = parseCodeownersContent(content);

      expect(result.entries).toHaveLength(3);
      expect(result.errors).toHaveLength(0);

      expect(result.entries[0]).toEqual({ pattern: '*', owners: ['@admin'], line: 2 });
      expect(result.entries[1]).toEqual({ pattern: '/src/', owners: ['@dev-team'], line: 3 });
      expect(result.entries[2]).toEqual({ pattern: '*.js', owners: ['@js-reviewer'], line: 4 });
    });

    it('skips comments and blank lines', () => {
      const content = `# Comment
# Another comment

* @admin

# More comments`;

      const result = parseCodeownersContent(content);
      expect(result.entries).toHaveLength(1);
    });

    it('handles multiple owners per pattern', () => {
      const content = `*.ts @dev1 @dev2 user@example.com`;

      const result = parseCodeownersContent(content);
      expect(result.entries[0].owners).toEqual(['@dev1', '@dev2', 'user@example.com']);
    });

    it('handles org/team format', () => {
      const content = `src/api/ @myorg/backend-team`;

      const result = parseCodeownersContent(content);
      expect(result.entries[0].owners).toEqual(['@myorg/backend-team']);
    });

    it('reports errors for patterns without owners', () => {
      const content = `*.ts`;

      const result = parseCodeownersContent(content);
      expect(result.entries).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('no owners');
    });

    it('reports errors for invalid owner format', () => {
      const content = `*.ts invalid-owner`;

      const result = parseCodeownersContent(content);
      expect(result.entries).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid owner');
    });

    it('parses empty content', () => {
      const result = parseCodeownersContent('');
      expect(result.entries).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ============================================================
  // Pattern Matching
  // ============================================================
  describe('matchesCodeownersPattern', () => {
    it('matches all files with *', () => {
      expect(matchesCodeownersPattern('any/file.ts', '*')).toBe(true);
      expect(matchesCodeownersPattern('deep/path/file.js', '*')).toBe(true);
    });

    it('matches file extensions', () => {
      expect(matchesCodeownersPattern('src/app.js', '*.js')).toBe(true);
      expect(matchesCodeownersPattern('deep/path/app.js', '*.js')).toBe(true);
      expect(matchesCodeownersPattern('src/app.ts', '*.js')).toBe(false);
    });

    it('matches anchored directory patterns', () => {
      expect(matchesCodeownersPattern('src/file.ts', '/src/')).toBe(true);
      expect(matchesCodeownersPattern('src/deep/file.ts', '/src/')).toBe(true);
      expect(matchesCodeownersPattern('other/src/file.ts', '/src/')).toBe(false);
    });

    it('matches directory patterns with **', () => {
      expect(matchesCodeownersPattern('src/api/routes/user.ts', 'src/api/**')).toBe(true);
      expect(matchesCodeownersPattern('src/api/middleware.ts', 'src/api/**')).toBe(true);
    });

    it('matches specific files', () => {
      expect(matchesCodeownersPattern('Makefile', 'Makefile')).toBe(true);
      expect(matchesCodeownersPattern('src/Makefile', 'Makefile')).toBe(true);
      expect(matchesCodeownersPattern('README.md', 'Makefile')).toBe(false);
    });

    it('matches paths with directory prefix', () => {
      expect(matchesCodeownersPattern('docs/guide.md', 'docs/')).toBe(true);
      expect(matchesCodeownersPattern('docs/api/ref.md', 'docs/')).toBe(true);
    });
  });

  // ============================================================
  // Owner Resolution
  // ============================================================
  describe('getOwnersForPaths', () => {
    it('returns owners for matching files (last match wins)', () => {
      const entries = [
        { pattern: '*', owners: ['@default'], line: 1 },
        { pattern: '*.ts', owners: ['@ts-team'], line: 2 },
        { pattern: '/src/api/', owners: ['@api-team'], line: 3 },
      ];

      const result = getOwnersForPaths(entries, [
        'README.md',
        'src/utils.ts',
        'src/api/routes.ts',
      ]);

      // README.md matches only * -> @default
      expect(result[0].owners).toEqual(['@default']);
      expect(result[0].matchedPattern).toBe('*');

      // src/utils.ts matches * and *.ts -> @ts-team (last match)
      expect(result[1].owners).toEqual(['@ts-team']);

      // src/api/routes.ts matches *, *.ts, and /src/api/ -> @api-team (last match)
      expect(result[2].owners).toEqual(['@api-team']);
    });

    it('returns empty owners when no match', () => {
      const entries = [
        { pattern: '*.ts', owners: ['@ts-team'], line: 1 },
      ];

      const result = getOwnersForPaths(entries, ['readme.md']);

      expect(result[0].owners).toEqual([]);
      expect(result[0].matchedPattern).toBeNull();
    });
  });

  describe('getSuggestedReviewers', () => {
    it('returns unique reviewers across all changed files', () => {
      const entries = [
        { pattern: '*.ts', owners: ['@dev1', '@dev2'], line: 1 },
        { pattern: '*.css', owners: ['@designer'], line: 2 },
        { pattern: '/docs/', owners: ['@dev1', '@docwriter'], line: 3 },
      ];

      const reviewers = getSuggestedReviewers(entries, [
        'src/app.ts',
        'styles/main.css',
        'docs/guide.md',
      ]);

      expect(reviewers.sort()).toEqual(['@designer', '@dev1', '@dev2', '@docwriter']);
    });

    it('returns empty array when no matches', () => {
      const entries = [
        { pattern: '*.py', owners: ['@python-team'], line: 1 },
      ];

      const reviewers = getSuggestedReviewers(entries, ['app.js']);
      expect(reviewers).toEqual([]);
    });

    it('deduplicates owners across patterns', () => {
      const entries = [
        { pattern: '*.ts', owners: ['@dev1'], line: 1 },
        { pattern: '/src/', owners: ['@dev1'], line: 2 },
      ];

      const reviewers = getSuggestedReviewers(entries, ['src/app.ts']);
      expect(reviewers).toEqual(['@dev1']);
    });
  });
});
