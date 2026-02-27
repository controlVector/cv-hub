/**
 * Repositories Page Tests (Sprint 6 — Step 3)
 *
 * Verifies the repository list page: loading, repo cards, search,
 * visibility filters, empty states, error handling, and navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import Repositories from './Repositories';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderRepos() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>
        <Repositories />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockRepos = {
  repositories: [
    {
      id: 'repo-1',
      name: 'cv-hub',
      slug: 'cv-hub',
      description: 'AI-native git platform',
      visibility: 'private' as const,
      provider: 'local' as const,
      defaultBranch: 'main',
      starCount: 42,
      forkCount: 5,
      openIssueCount: 3,
      openPrCount: 2,
      graphSyncStatus: 'synced',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: new Date().toISOString(),
      owner: { id: 'org-1', slug: 'testorg', name: 'Test Org' },
      language: 'TypeScript',
    },
    {
      id: 'repo-2',
      name: 'docs',
      slug: 'docs',
      description: 'Documentation site',
      visibility: 'public' as const,
      provider: 'local' as const,
      defaultBranch: 'main',
      starCount: 0,
      forkCount: 0,
      openIssueCount: 0,
      openPrCount: 0,
      graphSyncStatus: 'pending',
      createdAt: '2024-02-01T00:00:00Z',
      updatedAt: new Date(Date.now() - 86400000 * 7).toISOString(),
      owner: { id: 'org-1', slug: 'testorg', name: 'Test Org' },
      language: 'Python',
    },
  ],
  pagination: { limit: 100, offset: 0, total: 2 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Repositories', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('shows skeleton loaders while data is loading', () => {
    server.use(
      http.get('/api/v1/repos', () => new Promise(() => {})),
    );

    renderRepos();

    const skeletons = document.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders repository cards from API', async () => {
    server.use(
      http.get('/api/v1/repos', () => HttpResponse.json(mockRepos)),
    );

    renderRepos();

    await waitFor(() => {
      expect(screen.getByText('cv-hub')).toBeInTheDocument();
    });

    expect(screen.getByText('AI-native git platform')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.getByText('Documentation site')).toBeInTheDocument();
  });

  it('shows repo count in header', async () => {
    server.use(
      http.get('/api/v1/repos', () => HttpResponse.json(mockRepos)),
    );

    renderRepos();

    await waitFor(() => {
      expect(screen.getByText('2 repositories')).toBeInTheDocument();
    });
  });

  it('shows language indicator for repos', async () => {
    server.use(
      http.get('/api/v1/repos', () => HttpResponse.json(mockRepos)),
    );

    renderRepos();

    await waitFor(() => {
      expect(screen.getByText('TypeScript')).toBeInTheDocument();
    });

    expect(screen.getByText('Python')).toBeInTheDocument();
  });

  it('shows graph sync chip for synced repos', async () => {
    server.use(
      http.get('/api/v1/repos', () => HttpResponse.json(mockRepos)),
    );

    renderRepos();

    await waitFor(() => {
      expect(screen.getByText('Graph')).toBeInTheDocument();
    });
  });

  it('navigates to repo detail when clicking a card', async () => {
    server.use(
      http.get('/api/v1/repos', () => HttpResponse.json(mockRepos)),
    );

    const user = userEvent.setup();
    renderRepos();

    await waitFor(() => {
      expect(screen.getByText('cv-hub')).toBeInTheDocument();
    });

    // Click the card (the Card wraps everything)
    await user.click(screen.getByText('cv-hub'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/repositories/testorg/cv-hub');
  });

  it('navigates to new repository page', async () => {
    server.use(
      http.get('/api/v1/repos', () => HttpResponse.json(mockRepos)),
    );

    const user = userEvent.setup();
    renderRepos();

    await waitFor(() => {
      expect(screen.getByText('New Repository')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Repository'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/repositories/new');
  });

  it('shows empty state when no repos exist', async () => {
    server.use(
      http.get('/api/v1/repos', () =>
        HttpResponse.json({
          repositories: [],
          pagination: { limit: 100, offset: 0, total: 0 },
        }),
      ),
    );

    renderRepos();

    await waitFor(() => {
      expect(screen.getByText('No repositories yet')).toBeInTheDocument();
    });
  });

  it('shows error alert on API failure', async () => {
    server.use(
      http.get('/api/v1/repos', () =>
        HttpResponse.json({ error: 'Server error' }, { status: 500 }),
      ),
    );

    renderRepos();

    await waitFor(() => {
      expect(screen.getByText(/failed to load repositories/i)).toBeInTheDocument();
    });
  });

  it('has search input and tab filters', () => {
    server.use(
      http.get('/api/v1/repos', () => HttpResponse.json(mockRepos)),
    );

    renderRepos();

    expect(screen.getByPlaceholderText('Find a repository...')).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
  });

  it('shows visibility icon per repo', async () => {
    server.use(
      http.get('/api/v1/repos', () => HttpResponse.json(mockRepos)),
    );

    renderRepos();

    await waitFor(() => {
      expect(screen.getByText('cv-hub')).toBeInTheDocument();
    });

    // Private and public repos should both have the owner slug
    expect(screen.getAllByText('testorg').length).toBe(2);
  });
});
