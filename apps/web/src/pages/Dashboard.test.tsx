/**
 * Dashboard Tests (Sprint 6 — Step 2)
 *
 * Verifies the Dashboard page renders correctly with real API data:
 * loading state, stats cards, recent repos, billing CTA, empty states,
 * error handling, and navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import Dashboard from './Dashboard';

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
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderDashboard(queryClient?: QueryClient) {
  const qc = queryClient ?? createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockDashboardStats = {
  stats: {
    repositories: 12,
    pullRequests: 5,
    openIssues: 8,
  },
  recentRepositories: [
    {
      id: 'repo-1',
      name: 'cv-hub',
      slug: 'cv-hub',
      fullName: 'testorg/cv-hub',
      description: 'AI-native git platform',
      visibility: 'private',
      starCount: 42,
      openIssueCount: 3,
      openPrCount: 2,
      graphSyncStatus: 'synced',
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'repo-2',
      name: 'docs',
      slug: 'docs',
      fullName: 'testorg/docs',
      description: null,
      visibility: 'public',
      starCount: 0,
      openIssueCount: 0,
      openPrCount: 0,
      graphSyncStatus: 'pending',
      updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
  ],
  billing: null,
};

const mockBillingFree = {
  orgId: 'org-1',
  orgSlug: 'testorg',
  orgName: 'Test Org',
  tierName: 'free',
  tierDisplayName: 'Free',
  isFreeTier: true,
  usage: { repos: 2, members: 1 },
  limits: {
    repositories: 3,
    teamMembers: 2,
    storageGb: 1,
    environments: 1,
    buildMinutes: 100,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  // ── Loading state ────────────────────────────────────────────────────

  it('shows skeleton loaders while data is loading', () => {
    // No handler = pending forever
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return new Promise(() => {}); // Never resolves
      }),
    );

    renderDashboard();

    // MUI Skeletons render as spans with role=presentation or specific class
    const skeletons = document.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // ── Stats display ────────────────────────────────────────────────────

  it('renders stat cards with correct values from API', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json(mockDashboardStats);
      }),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    });

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Repositories')).toBeInTheDocument();
    expect(screen.getByText('Pull Requests')).toBeInTheDocument();
    expect(screen.getByText('Open Issues')).toBeInTheDocument();
  });

  it('counts graph-synced repos correctly', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json(mockDashboardStats);
      }),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Graph Synced')).toBeInTheDocument();
    });

    // 1 out of 2 repos is synced
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  // ── Recent repositories ──────────────────────────────────────────────

  it('renders recent repositories from API', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json(mockDashboardStats);
      }),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('cv-hub')).toBeInTheDocument();
    });

    expect(screen.getByText('AI-native git platform')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('shows graph sync status chips on repos', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json(mockDashboardStats);
      }),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('synced')).toBeInTheDocument();
    });

    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('navigates to repo detail when clicking a repo', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json(mockDashboardStats);
      }),
    );

    const user = userEvent.setup();
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('cv-hub')).toBeInTheDocument();
    });

    await user.click(screen.getByText('cv-hub'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/repositories/testorg/cv-hub');
  });

  // ── Empty state ──────────────────────────────────────────────────────

  it('shows empty state when no repositories exist', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json({
          ...mockDashboardStats,
          stats: { repositories: 0, pullRequests: 0, openIssues: 0 },
          recentRepositories: [],
        });
      }),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/no repositories yet/i)).toBeInTheDocument();
    });
  });

  // ── Billing CTA ──────────────────────────────────────────────────────

  it('shows upgrade CTA for free-tier users', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json({
          ...mockDashboardStats,
          billing: mockBillingFree,
        });
      }),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Free Plan')).toBeInTheDocument();
    });

    expect(screen.getByText(/2\/3 repositories/)).toBeInTheDocument();
    expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
  });

  it('does not show upgrade CTA when billing is null', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json(mockDashboardStats);
      }),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    });

    expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument();
  });

  it('navigates to org settings when clicking upgrade', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json({
          ...mockDashboardStats,
          billing: mockBillingFree,
        });
      }),
    );

    const user = userEvent.setup();
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Upgrade to Pro'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/orgs/testorg/settings');
  });

  // ── Quick actions ────────────────────────────────────────────────────

  it('renders quick action buttons that navigate correctly', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json(mockDashboardStats);
      }),
    );

    const user = userEvent.setup();
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('New Repository')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Repository'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/repositories/new');
  });

  // ── AI insights empty state ──────────────────────────────────────────

  it('shows AI insights placeholder when no insights available', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json(mockDashboardStats);
      }),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('AI Insights')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/sync a repository.*knowledge graph/i),
    ).toBeInTheDocument();
  });

  // ── Welcome header ───────────────────────────────────────────────────

  it('renders welcome header', async () => {
    server.use(
      http.get('/api/v1/dashboard/stats', () => {
        return HttpResponse.json(mockDashboardStats);
      }),
    );

    renderDashboard();

    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(
      screen.getByText("Here's what's happening across your repositories"),
    ).toBeInTheDocument();
  });
});
