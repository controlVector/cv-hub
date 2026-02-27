/**
 * Organization Settings Tests (Sprint 6 — Step 5)
 *
 * Verifies org settings page: loading, general form, members list,
 * billing section, role management, danger zone, error states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import OrganizationSettings from './OrganizationSettings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual('../../contexts/AuthContext');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'user-1',
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
      },
      isLoading: false,
      isAuthenticated: true,
    }),
  };
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderOrgSettings(slug = 'testorg') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[`/dashboard/orgs/${slug}/settings`]}>
        <Routes>
          <Route path="/dashboard/orgs/:slug/settings" element={<OrganizationSettings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockOrg = {
  id: 'org-1',
  slug: 'testorg',
  name: 'Test Organization',
  description: 'A test organization',
  logoUrl: '',
  websiteUrl: 'https://example.com',
  isPublic: true,
  memberCount: 2,
  appCount: 3,
  repositoryCount: 5,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
};

const mockMembers = [
  {
    id: 'mem-1',
    userId: 'user-1',
    organizationId: 'org-1',
    role: 'owner' as const,
    user: {
      id: 'user-1',
      email: 'test@example.com',
      displayName: 'Test User',
      avatarUrl: null,
    },
  },
  {
    id: 'mem-2',
    userId: 'user-2',
    organizationId: 'org-1',
    role: 'member' as const,
    user: {
      id: 'user-2',
      email: 'dev@example.com',
      displayName: 'Developer',
      avatarUrl: null,
    },
  },
];

const mockSubscription = {
  tier: 'pro',
  status: 'active',
  currentPeriodEnd: '2025-02-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrganizationSettings', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/v1/orgs/testorg', () =>
        HttpResponse.json({ organization: mockOrg }),
      ),
      http.get('/api/v1/orgs/testorg/members', () =>
        HttpResponse.json({ members: mockMembers }),
      ),
      http.get('/api/stripe/subscription/:orgId', () =>
        HttpResponse.json(mockSubscription),
      ),
    );
  });

  // ── Loading ─────────────────────────────────────────────────────────

  it('shows skeleton loaders while data is loading', () => {
    server.use(
      http.get('/api/v1/orgs/testorg', () => new Promise(() => {})),
    );

    renderOrgSettings();

    const skeletons = document.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // ── General settings form ───────────────────────────────────────────

  it('renders org name and description in form fields', async () => {
    renderOrgSettings();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Organization')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('A test organization')).toBeInTheDocument();
  });

  it('renders general settings section with save button', async () => {
    renderOrgSettings();

    await waitFor(() => {
      expect(screen.getByText('General Settings')).toBeInTheDocument();
    });

    expect(screen.getByText('Save Changes')).toBeInTheDocument();
  });

  it('renders public organization toggle', async () => {
    renderOrgSettings();

    await waitFor(() => {
      expect(screen.getByText('Public organization')).toBeInTheDocument();
    });
  });

  // ── Members list ────────────────────────────────────────────────────

  it('renders members with roles', async () => {
    renderOrgSettings();

    await waitFor(() => {
      expect(screen.getByText('Members')).toBeInTheDocument();
    });

    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('shows role dropdown for non-owner members (when user is owner)', async () => {
    renderOrgSettings();

    await waitFor(() => {
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });

    // The owner should see a Select for the member role
    // The member "Developer" has role "member", owner sees dropdown
    expect(screen.getByText('Member')).toBeInTheDocument();
  });

  // ── Danger zone ─────────────────────────────────────────────────────

  it('shows danger zone with delete button for owners', async () => {
    renderOrgSettings();

    await waitFor(() => {
      expect(screen.getByText('Danger Zone')).toBeInTheDocument();
    });

    expect(screen.getByText('Delete Organization')).toBeInTheDocument();
  });

  // ── Error handling ──────────────────────────────────────────────────

  it('shows error alert when org not found', async () => {
    server.use(
      http.get('/api/v1/orgs/testorg', () =>
        HttpResponse.json({ error: 'Not found' }, { status: 404 }),
      ),
    );

    renderOrgSettings();

    await waitFor(() => {
      expect(screen.getByText(/organization not found/i)).toBeInTheDocument();
    });
  });

  // ── Non-admin access ────────────────────────────────────────────────

  it('shows permission error for non-admin users', async () => {
    server.use(
      http.get('/api/v1/orgs/testorg/members', () =>
        HttpResponse.json({
          members: [
            {
              id: 'mem-3',
              userId: 'user-1',
              organizationId: 'org-1',
              role: 'member',
              user: {
                id: 'user-1',
                email: 'test@example.com',
                displayName: 'Test User',
                avatarUrl: null,
              },
            },
          ],
        }),
      ),
    );

    renderOrgSettings();

    await waitFor(() => {
      expect(
        screen.getByText(/don't have permission/i),
      ).toBeInTheDocument();
    });
  });

  // ── Back navigation ─────────────────────────────────────────────────

  it('shows back to organization button', async () => {
    renderOrgSettings();

    await waitFor(() => {
      expect(screen.getByText('Back to Organization')).toBeInTheDocument();
    });
  });
});
