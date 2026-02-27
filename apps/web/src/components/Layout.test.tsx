/**
 * Layout Tests (Sprint 7 — Step 3)
 *
 * Verifies sidebar navigation includes all items including new
 * Board and Safety entries.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import Layout from './Layout';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../contexts/AuthContext', async () => {
  const actual = await vi.importActual('../contexts/AuthContext');
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
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshAuth: vi.fn(),
      setAuthenticatedUser: vi.fn(),
    }),
  };
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderLayout() {
  server.use(
    http.get('/api/v1/dashboard/stats', () =>
      HttpResponse.json({
        billing: {
          tierName: 'starter',
          tierDisplayName: 'Starter',
          isFreeTier: true,
          usage: { repos: 2, members: 1 },
          limits: { repositories: 5, teamMembers: 3 },
        },
      }),
    ),
  );

  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Layout />}>
            <Route index element={<div>Dashboard Content</div>} />
            <Route path="board" element={<div>Board Content</div>} />
            <Route path="safety" element={<div>Safety Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Layout Navigation', () => {
  it('renders all sidebar navigation items', () => {
    renderLayout();

    // MUI renders both mobile + desktop drawers, so items appear twice
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Repositories').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Board').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Safety').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Knowledge Graph').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Organizations').length).toBeGreaterThanOrEqual(1);
  });

  it('navigates to Board when clicked', async () => {
    const user = userEvent.setup();
    renderLayout();

    const boardItems = screen.getAllByText('Board');
    await user.click(boardItems[0]);

    expect(screen.getByText('Board Content')).toBeInTheDocument();
  });

  it('navigates to Safety when clicked', async () => {
    const user = userEvent.setup();
    renderLayout();

    const safetyItems = screen.getAllByText('Safety');
    await user.click(safetyItems[0]);

    expect(screen.getByText('Safety Content')).toBeInTheDocument();
  });

  it('highlights active page in sidebar', () => {
    renderLayout();

    // Dashboard should be active (we start at /dashboard)
    const dashboardItems = screen.getAllByText('Dashboard');
    const selectedItem = dashboardItems
      .map((el) => el.closest('.MuiListItemButton-root'))
      .find((el) => el?.classList.contains('Mui-selected'));
    expect(selectedItem).toBeTruthy();
  });
});
