/**
 * SafetyDashboard Tests (Sprint 7 — Step 2)
 *
 * Verifies safety page: header, repo selector, empty state,
 * run check, report display, error state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import SafetyDashboard from './SafetyDashboard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderSafety() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>
        <SafetyDashboard />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

const mockRepos = [
  {
    id: 'repo-1',
    slug: 'cv-hub',
    name: 'cv-hub',
    organization: { slug: 'testorg' },
  },
];

const mockReport = {
  report: {
    risk_level: 'medium',
    stats: { files: 120, symbols: 350, functions: 200, relationships: 500 },
    dead_code: [
      { name: 'unusedHelper', kind: 'function', file: 'src/utils.ts', line: 42 },
    ],
    dead_code_total: 1,
    complexity_hotspots: [
      { name: 'processData', complexity: 15, file: 'src/processor.ts', line: 10 },
    ],
    circular_imports: [
      { file_a: 'src/a.ts', file_b: 'src/b.ts' },
    ],
    orphan_files: [
      { path: 'src/old-script.ts', language: 'typescript' },
    ],
    checked_at: '2025-01-15T12:00:00Z',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SafetyDashboard', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/v1/repos', () =>
        HttpResponse.json({
          repositories: mockRepos,
          pagination: { limit: 100, offset: 0, total: 1 },
        }),
      ),
    );
  });

  // ── Header ────────────────────────────────────────────────────────

  it('renders page header', () => {
    renderSafety();

    expect(screen.getByText('Safety Dashboard')).toBeInTheDocument();
    expect(
      screen.getByText(/analyze code quality/i),
    ).toBeInTheDocument();
  });

  // ── Empty state ───────────────────────────────────────────────────

  it('shows empty state when no repo selected', () => {
    renderSafety();

    expect(
      screen.getByText('Select a repository to run safety analysis'),
    ).toBeInTheDocument();
  });

  // ── Run check button ─────────────────────────────────────────────

  it('disables Run button when no repo selected', () => {
    renderSafety();

    const btn = screen.getByRole('button', { name: /run safety check/i });
    expect(btn).toBeDisabled();
  });

  // ── Repo selector ────────────────────────────────────────────────

  it('shows repository options', async () => {
    const user = userEvent.setup();
    renderSafety();

    // Open the select dropdown by clicking the select element
    const selectButton = await screen.findByRole('combobox', { name: /repository/i });
    await user.click(selectButton);

    await waitFor(() => {
      expect(screen.getByText('testorg/cv-hub')).toBeInTheDocument();
    });
  });

  // ── Report display ───────────────────────────────────────────────

  it('displays report after running safety check', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('/api/v1/repos/:owner/:repo/safety/check', () =>
        HttpResponse.json(mockReport),
      ),
    );

    renderSafety();

    // Select repo
    const selectButton = await screen.findByRole('combobox', { name: /repository/i });
    await user.click(selectButton);
    await waitFor(() => {
      expect(screen.getByText('testorg/cv-hub')).toBeInTheDocument();
    });
    await user.click(screen.getByText('testorg/cv-hub'));

    // Run check
    await user.click(screen.getByRole('button', { name: /run safety check/i }));

    await waitFor(() => {
      expect(screen.getByText('Medium Risk')).toBeInTheDocument();
    });

    // Stats
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();

    // Dead code
    expect(screen.getByText('Dead Code (1 symbols)')).toBeInTheDocument();
    expect(screen.getByText('unusedHelper')).toBeInTheDocument();

    // Complexity hotspots
    expect(screen.getByText('processData')).toBeInTheDocument();

    // Circular imports
    expect(screen.getByText(/src\/a\.ts/)).toBeInTheDocument();
  });

  // ── Error state ──────────────────────────────────────────────────

  it('shows error when safety check fails', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('/api/v1/repos/:owner/:repo/safety/check', () =>
        HttpResponse.json({ error: 'Graph not synced' }, { status: 500 }),
      ),
    );

    renderSafety();

    // Select repo
    const selectButton = await screen.findByRole('combobox', { name: /repository/i });
    await user.click(selectButton);
    await waitFor(() => {
      expect(screen.getByText('testorg/cv-hub')).toBeInTheDocument();
    });
    await user.click(screen.getByText('testorg/cv-hub'));

    // Run check
    await user.click(screen.getByRole('button', { name: /run safety check/i }));

    await waitFor(() => {
      expect(screen.getByText(/safety check failed/i)).toBeInTheDocument();
    });
  });
});
