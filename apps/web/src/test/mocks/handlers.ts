import { http, HttpResponse } from 'msw';

// ============================================================================
// Repository Mock Data
// ============================================================================

export const mockRepository = {
  id: 'repo-1',
  name: 'test-repo',
  slug: 'test-repo',
  description: 'A test repository for unit tests',
  visibility: 'public' as const,
  provider: 'local' as const,
  defaultBranch: 'main',
  gitUrl: 'http://localhost:3000/git/testuser/test-repo',
  graphSyncStatus: 'synced' as const,
  permissions: {
    read: true,
    write: true,
  },
};

export const mockBranches = [
  { name: 'main', sha: 'abc123', isDefault: true, isProtected: true },
  { name: 'develop', sha: 'def456', isDefault: false, isProtected: false },
  { name: 'feature/test', sha: 'ghi789', isDefault: false, isProtected: false },
];

export const mockTags = [
  { name: 'v1.0.0', sha: 'tag123', message: 'Initial release' },
  { name: 'v1.1.0', sha: 'tag456', message: 'Bug fixes' },
];

export const mockFileTree = [
  { name: 'src', path: 'src', type: 'tree' as const, mode: '040000', sha: 'tree1', size: undefined },
  { name: 'README.md', path: 'README.md', type: 'blob' as const, mode: '100644', sha: 'blob1', size: 1024 },
  { name: 'package.json', path: 'package.json', type: 'blob' as const, mode: '100644', sha: 'blob2', size: 512 },
];

export const mockFileContent = {
  ref: 'main',
  path: 'README.md',
  sha: 'blob1',
  size: 1024,
  isBinary: false,
  content: '# Test Repository\n\nThis is a test repository.',
  encoding: 'utf-8' as const,
  contentBase64: null,
};

export const mockCommits = [
  {
    sha: 'abc123def456',
    message: 'Initial commit\n\nThis is the first commit.',
    author: { name: 'Test User', email: 'test@example.com', date: '2024-01-15T10:00:00Z' },
    committer: { name: 'Test User', email: 'test@example.com', date: '2024-01-15T10:00:00Z' },
    parents: [],
  },
  {
    sha: 'def456ghi789',
    message: 'Add README file',
    author: { name: 'Test User', email: 'test@example.com', date: '2024-01-16T10:00:00Z' },
    committer: { name: 'Test User', email: 'test@example.com', date: '2024-01-16T10:00:00Z' },
    parents: ['abc123def456'],
  },
];

export const mockGraphStats = {
  fileCount: 42,
  symbolCount: 150,
  functionCount: 85,
  classCount: 12,
  commitCount: 100,
  moduleCount: 8,
  relationshipCount: 230,
  syncStatus: 'synced',
  lastSyncedAt: '2024-01-15T12:00:00Z',
  syncError: null,
};

// ============================================================================
// Feature Request Mock Data
// ============================================================================

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

  // ============================================================================
  // Repository Endpoints
  // ============================================================================

  // Get repository info (clone info)
  http.get('/api/v1/repos/:owner/:repo/clone-info', () => {
    return HttpResponse.json(mockRepository);
  }),

  // Get refs (branches and tags)
  http.get('/api/v1/repos/:owner/:repo/refs', () => {
    return HttpResponse.json({
      branches: mockBranches,
      tags: mockTags,
      defaultBranch: 'main',
    });
  }),

  // Get tree (directory listing)
  http.get('/api/v1/repos/:owner/:repo/tree/:ref', () => {
    return HttpResponse.json({
      ref: 'main',
      path: '',
      entries: mockFileTree,
    });
  }),

  http.get('/api/v1/repos/:owner/:repo/tree/:ref/*', () => {
    return HttpResponse.json({
      ref: 'main',
      path: 'src',
      entries: [
        { name: 'index.ts', path: 'src/index.ts', type: 'blob', mode: '100644', sha: 'blob3', size: 256 },
      ],
    });
  }),

  // Get blob (file content)
  http.get('/api/v1/repos/:owner/:repo/blob/:ref/*', () => {
    return HttpResponse.json(mockFileContent);
  }),

  // Get commits
  http.get('/api/v1/repos/:owner/:repo/commits', () => {
    return HttpResponse.json({
      ref: 'main',
      commits: mockCommits,
    });
  }),

  // Get single commit
  http.get('/api/v1/repos/:owner/:repo/commits/:sha', ({ params }) => {
    const commit = mockCommits.find((c) => c.sha === params.sha);
    if (!commit) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json({ commit });
  }),

  // Get graph stats
  http.get('/api/v1/repos/:owner/:repo/graph/stats', () => {
    return HttpResponse.json({ data: mockGraphStats });
  }),

  // Compare refs
  http.get('/api/v1/repos/:owner/:repo/compare/:baseHead', () => {
    return HttpResponse.json({
      base: 'abc123def456',
      head: 'def456ghi789',
      baseCommit: mockCommits[0],
      headCommit: mockCommits[1],
      aheadBy: 1,
      behindBy: 0,
      commits: [mockCommits[1]],
      files: [
        {
          path: 'README.md',
          status: 'added',
          additions: 3,
          deletions: 0,
          patch: '@@ -0,0 +1,3 @@\n+# Test Repository\n+\n+This is a test repository.',
        },
      ],
      totalAdditions: 3,
      totalDeletions: 0,
    });
  }),

  // Get blame
  http.get('/api/v1/repos/:owner/:repo/blame/:ref/*', () => {
    return HttpResponse.json({
      hunks: [
        {
          lines: 3,
          commit: {
            sha: 'abc123def456',
            author: { name: 'Test User', date: '2024-01-15T10:00:00Z' },
          },
        },
      ],
    });
  }),
];
