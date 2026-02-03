import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkspaceConfig } from './job-dispatch.service';

// Mock environment before importing module
vi.mock('../../config/env', () => ({
  env: {
    OPENROUTER_API_KEY: 'test-key',
    APP_URL: 'http://localhost:5173',
    GIT_STORAGE_PATH: '/tmp/test-git-repos',
  },
}));

// Mock deploy provider
const mockProvider = {
  name: 'test',
  registryLogin: vi.fn(),
  deployService: vi.fn(),
  deployStaticAssets: vi.fn(),
  invalidateCDN: vi.fn(),
  checkHealth: vi.fn(),
  rollbackService: vi.fn(),
};

vi.mock('./providers', () => ({
  getDeployProvider: () => mockProvider,
}));

// Mock fetch for LLM calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { assessDeploymentRisk, checkDeploymentHealth, executeRollback } from './ai-deploy.service';

const TEST_WORKSPACE: WorkspaceConfig = {
  ownerSlug: 'test-owner',
  repoSlug: 'test-repo',
  ref: 'refs/heads/main',
  sha: 'abc123',
};

function mockLLMResponse(content: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  });
}

describe('AI Deploy Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assessDeploymentRisk', () => {
    it('returns AI risk assessment for low-risk changes', async () => {
      const responseJson = JSON.stringify({
        riskLevel: 'low',
        reasoning: 'Changes only affect test files and documentation.',
        recommendations: ['No special precautions needed'],
      });

      mockLLMResponse(`\`\`\`json\n${responseJson}\n\`\`\``);

      const result = await assessDeploymentRisk('/tmp/test-workspace', TEST_WORKSPACE);

      expect(result.riskLevel).toBe('low');
      expect(result.reasoning).toContain('test files');
      expect(result.recommendations).toHaveLength(1);
    });

    it('returns AI risk assessment for high-risk changes', async () => {
      const responseJson = JSON.stringify({
        riskLevel: 'high',
        reasoning: 'Database schema migration and infrastructure changes detected.',
        recommendations: ['Deploy during maintenance window', 'Have rollback plan ready'],
      });

      mockLLMResponse(`\`\`\`json\n${responseJson}\n\`\`\``);

      const result = await assessDeploymentRisk('/tmp/test-workspace', TEST_WORKSPACE);

      expect(result.riskLevel).toBe('high');
      expect(result.recommendations).toHaveLength(2);
    });

    it('returns default when LLM call fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const result = await assessDeploymentRisk('/tmp/test-workspace', TEST_WORKSPACE);

      expect(result.riskLevel).toBe('low');
      expect(result.reasoning).toContain('defaulting');
    });

    it('returns default when response is not valid JSON', async () => {
      mockLLMResponse('This is not valid JSON at all');

      const result = await assessDeploymentRisk('/tmp/test-workspace', TEST_WORKSPACE);

      expect(result.riskLevel).toBe('low');
    });
  });

  describe('checkDeploymentHealth', () => {
    it('returns healthy when health check passes on first attempt', async () => {
      mockProvider.checkHealth.mockResolvedValueOnce({
        status: 200,
        latencyMs: 50,
      });

      const result = await checkDeploymentHealth('https://api.example.com/health', {
        retries: 3,
        intervalMs: 100,
      });

      expect(result.healthy).toBe(true);
      expect(result.rollbackRecommended).toBe(false);
      expect(mockProvider.checkHealth).toHaveBeenCalledTimes(1);
    });

    it('retries and succeeds on second attempt', async () => {
      mockProvider.checkHealth
        .mockResolvedValueOnce({ status: 503, latencyMs: 100 })
        .mockResolvedValueOnce({ status: 200, latencyMs: 50 });

      const result = await checkDeploymentHealth('https://api.example.com/health', {
        retries: 3,
        intervalMs: 100,
      });

      expect(result.healthy).toBe(true);
      expect(mockProvider.checkHealth).toHaveBeenCalledTimes(2);
    });

    it('returns unhealthy after all retries fail with AI analysis', async () => {
      mockProvider.checkHealth.mockResolvedValue({ status: 503, latencyMs: 200 });

      const analysisJson = JSON.stringify({
        analysis: 'Service is returning 503 errors consistently.',
        rollbackRecommended: true,
      });
      mockLLMResponse(`\`\`\`json\n${analysisJson}\n\`\`\``);

      const result = await checkDeploymentHealth('https://api.example.com/health', {
        retries: 2,
        intervalMs: 100,
      });

      expect(result.healthy).toBe(false);
      expect(result.rollbackRecommended).toBe(true);
      expect(result.analysis).toContain('503');
    });

    it('handles health check errors gracefully', async () => {
      mockProvider.checkHealth.mockRejectedValue(new Error('Connection refused'));

      const analysisJson = JSON.stringify({
        analysis: 'Service is unreachable.',
        rollbackRecommended: true,
      });
      mockLLMResponse(`\`\`\`json\n${analysisJson}\n\`\`\``);

      const result = await checkDeploymentHealth('https://api.example.com/health', {
        retries: 1,
        intervalMs: 100,
      });

      expect(result.healthy).toBe(false);
    });
  });

  describe('executeRollback', () => {
    it('executes rollback successfully', async () => {
      mockProvider.rollbackService.mockResolvedValueOnce({
        status: 'rolled_back',
      });

      // Mock LLM for incident summary
      mockLLMResponse('Service was rolled back due to failed health checks.');

      const result = await executeRollback({
        CV_HUB_ENV_SERVICE: 'my-service',
        PREVIOUS_TASK_DEF: 'arn:aws:ecs:us-east-1:123:task-def/my-service:5',
      });

      expect(result.status).toBe('rolled_back');
      expect(mockProvider.rollbackService).toHaveBeenCalledWith({
        service: 'my-service',
        previousVersion: 'arn:aws:ecs:us-east-1:123:task-def/my-service:5',
      });
    });

    it('skips rollback when no service configured', async () => {
      const result = await executeRollback({});

      expect(result.status).toBe('skipped');
      expect(result.summary).toContain('No service name');
      expect(mockProvider.rollbackService).not.toHaveBeenCalled();
    });

    it('skips rollback when no previous version available', async () => {
      const result = await executeRollback({
        CV_HUB_ENV_SERVICE: 'my-service',
      });

      expect(result.status).toBe('skipped');
      expect(result.summary).toContain('No previous version');
    });

    it('handles rollback failure', async () => {
      mockProvider.rollbackService.mockRejectedValueOnce(
        new Error('ECS service not found')
      );

      const result = await executeRollback({
        CV_HUB_ENV_SERVICE: 'my-service',
        PREVIOUS_TASK_DEF: 'arn:aws:ecs:task-def/old',
      });

      expect(result.status).toBe('failed');
      expect(result.summary).toContain('ECS service not found');
    });
  });
});
