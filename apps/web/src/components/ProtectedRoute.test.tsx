/**
 * ProtectedRoute Tests (Sprint 6 — Step 6)
 *
 * Verifies auth gating: loading spinner, redirect when unauthenticated,
 * rendering children when authenticated.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProtectedRoute from './ProtectedRoute';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let mockAuth = {
  user: null as any,
  isLoading: false,
  isAuthenticated: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshAuth: vi.fn(),
  setAuthenticatedUser: vi.fn(),
};

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderProtected(initialPath = '/dashboard') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div>Protected Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProtectedRoute', () => {
  it('shows loading spinner when auth is loading', () => {
    mockAuth = {
      ...mockAuth,
      isLoading: true,
      isAuthenticated: false,
      user: null,
    };

    renderProtected();

    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });

  it('redirects to login when not authenticated', () => {
    mockAuth = {
      ...mockAuth,
      isLoading: false,
      isAuthenticated: false,
      user: null,
    };

    renderProtected();

    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('renders children when authenticated', () => {
    mockAuth = {
      ...mockAuth,
      isLoading: false,
      isAuthenticated: true,
      user: { id: 'u1', username: 'test', email: 'test@example.com' },
    };

    renderProtected();

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });
});
