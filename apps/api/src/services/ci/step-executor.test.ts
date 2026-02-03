import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  executeStep,
  getWorkspacePath,
  ensureWorkspace,
  cleanupWorkspace,
} from './step-executor';
import type { JobStep, WorkspaceConfig } from './job-dispatch.service';

const TEST_RUN_ID = 'test-run-001';
const TEST_JOB_KEY = 'test-job';
const TEST_WORKSPACE: WorkspaceConfig = {
  ownerSlug: 'test-owner',
  repoSlug: 'test-repo',
  ref: 'refs/heads/main',
  sha: 'abc123def456',
};
const TEST_CONTEXT = { runId: TEST_RUN_ID, jobKey: TEST_JOB_KEY };

describe('Step Executor', () => {
  afterEach(() => {
    // Clean up any workspace created during tests
    cleanupWorkspace(TEST_RUN_ID, TEST_JOB_KEY);
  });

  describe('workspace management', () => {
    it('getWorkspacePath returns correct path', () => {
      const path = getWorkspacePath('run-1', 'job-a');
      expect(path).toBe('/tmp/cv-hub-workspace/run-1/job-a');
    });

    it('ensureWorkspace creates directory', () => {
      const path = ensureWorkspace(TEST_RUN_ID, TEST_JOB_KEY);
      expect(existsSync(path)).toBe(true);
    });

    it('cleanupWorkspace removes directory', () => {
      const path = ensureWorkspace(TEST_RUN_ID, TEST_JOB_KEY);
      expect(existsSync(path)).toBe(true);
      cleanupWorkspace(TEST_RUN_ID, TEST_JOB_KEY);
      expect(existsSync(path)).toBe(false);
    });

    it('cleanupWorkspace handles non-existent directory gracefully', () => {
      expect(() => cleanupWorkspace('nonexistent', 'nonexistent')).not.toThrow();
    });
  });

  describe('shell command execution', () => {
    it('executes a simple echo command', async () => {
      const step: JobStep = {
        name: 'Echo test',
        run: 'echo "hello world"',
      };

      const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
      expect(result.output).toContain('hello world');
    });

    it('captures exit code on failure', async () => {
      const step: JobStep = {
        name: 'Fail test',
        run: 'exit 42',
      };

      await expect(executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT)).rejects.toThrow(
        /exit code 42/
      );
    });

    it('injects environment variables', async () => {
      const step: JobStep = {
        name: 'Env test',
        run: 'echo $MY_VAR',
        env: { MY_VAR: 'test-value' },
      };

      const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
      expect(result.output).toContain('test-value');
    });

    it('injects system environment variables', async () => {
      const step: JobStep = {
        name: 'System env test',
        run: 'echo $CI $CV_HUB $CV_HUB_SHA',
      };

      const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
      expect(result.output).toContain('true');
      expect(result.output).toContain('abc123def456');
    });

    it('step env overrides job env', async () => {
      const step: JobStep = {
        name: 'Override test',
        run: 'echo $FOO',
        env: { FOO: 'step-value' },
      };

      const result = await executeStep(
        step,
        TEST_WORKSPACE,
        { FOO: 'job-value' },
        TEST_CONTEXT
      );
      expect(result.output).toContain('step-value');
    });

    it('respects working directory', async () => {
      const workspacePath = ensureWorkspace(TEST_RUN_ID, TEST_JOB_KEY);
      const subDir = join(workspacePath, 'subdir');
      mkdirSync(subDir, { recursive: true });

      const step: JobStep = {
        name: 'Cwd test',
        run: 'pwd',
        workingDirectory: 'subdir',
      };

      const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
      expect(result.output).toContain('subdir');
    });

    it('captures set-output variables', async () => {
      const step: JobStep = {
        name: 'Output test',
        run: 'echo "::set-output name=version::1.2.3"',
      };

      const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
      expect(result.outputs).toEqual({ version: '1.2.3' });
    });

    it('times out long-running commands', async () => {
      const step: JobStep = {
        name: 'Timeout test',
        run: 'sleep 60',
        timeout: 1, // 1 second
      };

      await expect(executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT)).rejects.toThrow(
        /timed out/
      );
    }, 30000);

    it('handles multi-line commands', async () => {
      const step: JobStep = {
        name: 'Multi-line test',
        run: 'echo "line1"\necho "line2"\necho "line3"',
      };

      const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
      expect(result.output).toContain('line1');
      expect(result.output).toContain('line2');
      expect(result.output).toContain('line3');
    });

    it('captures stderr output', async () => {
      const step: JobStep = {
        name: 'Stderr test',
        run: 'echo "error message" >&2',
      };

      const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
      expect(result.output).toContain('error message');
    });
  });

  describe('no-op step', () => {
    it('returns no-op for empty step', async () => {
      const step: JobStep = {
        name: 'Empty step',
      };

      const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
      expect(result.output).toBe('No-op step');
    });
  });

  describe('built-in actions', () => {
    describe('setup-node@v1', () => {
      it('reports node version', async () => {
        const step: JobStep = {
          name: 'Setup Node',
          uses: 'setup-node@v1',
          with: { 'node-version': '20' },
        };

        const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
        expect(result.output).toContain('Node.js version');
        expect(result.outputs?.['node-version']).toBeDefined();
      });
    });

    describe('upload-artifact@v1', () => {
      it('uploads files from workspace', async () => {
        const workspacePath = ensureWorkspace(TEST_RUN_ID, TEST_JOB_KEY);
        const artifactDir = join(workspacePath, 'dist');
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(join(artifactDir, 'index.js'), 'console.log("hello")');

        const step: JobStep = {
          name: 'Upload',
          uses: 'upload-artifact@v1',
          with: { name: 'build-output', path: 'dist' },
        };

        const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
        expect(result.output).toContain('uploaded');
        expect(result.output).toContain('1 files');
      });

      it('errors on missing path with error behavior', async () => {
        const step: JobStep = {
          name: 'Upload',
          uses: 'upload-artifact@v1',
          with: { name: 'missing', path: 'nonexistent', 'if-no-files-found': 'error' },
        };

        await expect(executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT)).rejects.toThrow(
          /not found/
        );
      });

      it('warns on missing path by default', async () => {
        const step: JobStep = {
          name: 'Upload',
          uses: 'upload-artifact@v1',
          with: { name: 'missing', path: 'nonexistent' },
        };

        const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
        expect(result.output).toContain('Warning');
      });
    });

    describe('cache@v1', () => {
      it('reports cache miss when no cache exists', async () => {
        const uniqueKey = `test-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const step: JobStep = {
          name: 'Cache',
          uses: 'cache@v1',
          with: { key: uniqueKey, path: 'node_modules' },
        };

        const result = await executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT);
        expect(result.output).toContain('miss');
        expect(result.outputs?.['cache-hit']).toBe('false');
      });

      it('errors without key parameter', async () => {
        const step: JobStep = {
          name: 'Cache',
          uses: 'cache@v1',
          with: { path: 'node_modules' },
        };

        await expect(executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT)).rejects.toThrow(
          /requires/
        );
      });
    });

    describe('unknown action', () => {
      it('throws on unknown action', async () => {
        const step: JobStep = {
          name: 'Unknown',
          uses: 'nonexistent-action@v1',
        };

        await expect(executeStep(step, TEST_WORKSPACE, {}, TEST_CONTEXT)).rejects.toThrow(
          /Unknown action/
        );
      });
    });
  });
});
