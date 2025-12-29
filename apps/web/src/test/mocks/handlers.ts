import { http, HttpResponse } from 'msw';

// Sample data for tests
export const mockFeatureRequests = [
  {
    id: 'req-1',
    external_id: 'cvhub-user1-1234567890',
    requester_id: 'user1',
    requester_name: 'Test User',
    source: 'cv-hub',
    title: 'Add dark mode',
    problem_statement: 'Users need dark mode for better visibility at night.',
    request_type: 'feature',
    category: 'UI/UX',
    tags: ['ux', 'web'],
    status: 'raw',
    priority: null,
    ai_summary: 'Request to add dark mode support for better usability.',
    created_at: '2024-01-15T10:00:00Z',
  },
  {
    id: 'req-2',
    external_id: 'cvhub-user1-1234567891',
    requester_id: 'user1',
    requester_name: 'Test User',
    source: 'cv-hub',
    title: 'Fix login bug',
    problem_statement: 'Login fails intermittently.',
    request_type: 'bug',
    category: 'Authentication',
    tags: ['security', 'backend'],
    status: 'under_review',
    priority: 'high',
    ai_summary: 'Bug report for intermittent login failures.',
    reviewer_id: 'reviewer1',
    triaged_at: '2024-01-16T10:00:00Z',
    created_at: '2024-01-15T11:00:00Z',
  },
];

export const mockUser = {
  id: 'user1',
  username: 'testuser',
  email: 'test@example.com',
  displayName: 'Test User',
};

export const handlers = [
  // Feature Request Endpoints
  http.post('/api/prd/requests', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({
      id: 'new-req-id',
      external_id: body.external_id,
      status: 'raw',
      ai_analysis: {
        summary: 'AI analysis of the request.',
        request_type: 'feature',
        category: 'General',
        priority_suggestion: 'medium',
        tags: [],
        similar_requests: [],
        related_prds: [],
      },
    });
  }),

  http.get('/api/prd/requests', ({ request }) => {
    const url = new URL(request.url);
    const requesterId = url.searchParams.get('requester_id');
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('page_size') || '10');

    let filtered = mockFeatureRequests;
    if (requesterId) {
      filtered = filtered.filter((r) => r.requester_id === requesterId);
    }

    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginated = filtered.slice(start, end);

    return HttpResponse.json({
      requests: paginated,
      total: filtered.length,
      page,
      page_size: pageSize,
      has_more: end < filtered.length,
    });
  }),

  http.get('/api/prd/requests/:id', ({ params }) => {
    const request = mockFeatureRequests.find((r) => r.id === params.id);
    if (!request) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(request);
  }),

  // Auth Endpoints
  http.get('/api/auth/me', () => {
    return HttpResponse.json(mockUser);
  }),

  http.post('/api/auth/login', () => {
    return HttpResponse.json({
      user: mockUser,
      accessToken: 'mock-access-token',
    });
  }),

  http.post('/api/auth/logout', () => {
    return HttpResponse.json({ success: true });
  }),

  http.post('/api/auth/refresh', () => {
    return HttpResponse.json({
      accessToken: 'new-mock-access-token',
    });
  }),
];
