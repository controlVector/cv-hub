import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  submitFeatureRequest,
  getFeatureRequest,
  listMyFeatureRequests,
  listAllFeatureRequests,
} from './feature-request';

// Mock axios/api
vi.mock('../lib/api', () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import { api } from '../lib/api';

describe('Feature Request Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitFeatureRequest', () => {
    it('sends correct payload to API', async () => {
      const mockResponse = {
        data: {
          id: 'new-id',
          external_id: 'cvhub-user1-123',
          status: 'raw',
          ai_analysis: {
            summary: 'Test summary',
            request_type: 'feature',
            category: 'General',
            priority_suggestion: 'medium',
            tags: [],
            similar_requests: [],
            related_prds: [],
          },
        },
      };

      (api.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await submitFeatureRequest(
        'user1',
        'Test User',
        'test@example.com',
        {
          title: 'Test Feature',
          problemStatement: 'Test problem statement',
          proposedSolution: 'Test solution',
        }
      );

      expect(api.post).toHaveBeenCalledWith(
        '/api/prd/requests',
        expect.objectContaining({
          requester_id: 'user1',
          requester_name: 'Test User',
          requester_email: 'test@example.com',
          source: 'cv-hub',
          title: 'Test Feature',
          problem_statement: 'Test problem statement',
          proposed_solution: 'Test solution',
        })
      );

      expect(result.id).toBe('new-id');
      expect(result.status).toBe('raw');
    });

    it('generates external_id with timestamp', async () => {
      (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { id: 'new-id', external_id: 'test', status: 'raw' },
      });

      await submitFeatureRequest('user1', 'Test', 'test@example.com', {
        title: 'Test',
        problemStatement: 'Problem',
      });

      const callArgs = (api.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(callArgs.external_id).toMatch(/^cvhub-user1-\d+$/);
    });

    it('handles optional fields correctly', async () => {
      (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { id: 'new-id', external_id: 'test', status: 'raw' },
      });

      await submitFeatureRequest('user1', 'Test', 'test@example.com', {
        title: 'Test',
        problemStatement: 'Problem',
        // No optional fields
      });

      const callArgs = (api.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(callArgs.proposed_solution).toBeUndefined();
      expect(callArgs.success_criteria).toBeUndefined();
      expect(callArgs.additional_context).toBeUndefined();
    });
  });

  describe('getFeatureRequest', () => {
    it('fetches request by ID', async () => {
      const mockRequest = {
        id: 'req-1',
        title: 'Test Request',
        status: 'raw',
      };

      (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockRequest });

      const result = await getFeatureRequest('req-1');

      expect(api.get).toHaveBeenCalledWith('/api/prd/requests/req-1');
      expect(result.id).toBe('req-1');
    });
  });

  describe('listMyFeatureRequests', () => {
    it('fetches requests with correct params', async () => {
      const mockResponse = {
        requests: [{ id: 'req-1' }],
        total: 1,
        page: 1,
        page_size: 10,
        has_more: false,
      };

      (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockResponse });

      const result = await listMyFeatureRequests('user1', 1, 10);

      expect(api.get).toHaveBeenCalledWith('/api/prd/requests', {
        params: {
          requester_id: 'user1',
          page: 1,
          page_size: 10,
        },
      });

      expect(result.total).toBe(1);
      expect(result.requests).toHaveLength(1);
    });

    it('uses default pagination values', async () => {
      (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { requests: [], total: 0, page: 1, page_size: 10, has_more: false },
      });

      await listMyFeatureRequests('user1');

      expect(api.get).toHaveBeenCalledWith('/api/prd/requests', {
        params: {
          requester_id: 'user1',
          page: 1,
          page_size: 10,
        },
      });
    });
  });

  describe('listAllFeatureRequests', () => {
    it('fetches all requests for reviewers', async () => {
      const mockResponse = {
        requests: [{ id: 'req-1' }, { id: 'req-2' }],
        total: 2,
        page: 1,
        page_size: 20,
        has_more: false,
      };

      (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockResponse });

      const result = await listAllFeatureRequests('raw', 1, 20);

      expect(api.get).toHaveBeenCalledWith('/api/prd/requests', {
        params: {
          status: 'raw',
          page: 1,
          page_size: 20,
        },
      });

      expect(result.total).toBe(2);
    });

    it('works without status filter', async () => {
      (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { requests: [], total: 0, page: 1, page_size: 20, has_more: false },
      });

      await listAllFeatureRequests(undefined, 1, 20);

      expect(api.get).toHaveBeenCalledWith('/api/prd/requests', {
        params: {
          status: undefined,
          page: 1,
          page_size: 20,
        },
      });
    });
  });
});
