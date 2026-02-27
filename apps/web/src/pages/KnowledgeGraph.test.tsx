/**
 * Knowledge Graph Page Tests (Sprint 6 — Step 4)
 *
 * Minimal tests for the graph explorer: header, repo selector,
 * empty state, sync button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import KnowledgeGraph from './KnowledgeGraph';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderGraph() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>
        <KnowledgeGraph />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

const mockRepos = [
  {
    id: 'repo-1',
    slug: 'cv-hub',
    name: 'cv-hub',
    graphSyncStatus: 'synced',
    organization: { slug: 'testorg' },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KnowledgeGraph', () => {
  beforeEach(() => {
    // Default: repos list returns data, graph cypher calls return empty
    server.use(
      http.get('/api/v1/repos', () =>
        HttpResponse.json({ repositories: mockRepos, pagination: { limit: 100, offset: 0, total: 1 } }),
      ),
      http.get('/api/v1/repos/:owner/:repo/graph/stats', () =>
        HttpResponse.json({ data: { fileCount: 10, symbolCount: 25, relationshipCount: 40, syncStatus: 'synced', lastSyncedAt: null, syncError: null, functionCount: 15, classCount: 3, commitCount: 50, moduleCount: 4 } }),
      ),
      http.post('/api/v1/repos/:owner/:repo/graph/cypher', () =>
        HttpResponse.json({ data: { results: [] } }),
      ),
    );
  });

  it('renders the page header', () => {
    renderGraph();

    expect(screen.getByText('Knowledge Graph')).toBeInTheDocument();
    expect(screen.getByText('Explore code relationships and dependencies')).toBeInTheDocument();
  });

  it('renders the sync graph button', () => {
    renderGraph();

    expect(screen.getByText('Sync Graph')).toBeInTheDocument();
  });

  it('renders a canvas element for graph visualization', () => {
    renderGraph();

    const canvas = document.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('shows search nodes input', () => {
    renderGraph();

    expect(screen.getByPlaceholderText('Search nodes...')).toBeInTheDocument();
  });

  it('shows graph stats panel after loading', async () => {
    renderGraph();

    await waitFor(() => {
      expect(screen.getByText('Graph Stats')).toBeInTheDocument();
    });

    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByText('Symbols')).toBeInTheDocument();
    expect(screen.getByText('Relationships')).toBeInTheDocument();
  });

  it('shows node detail placeholder when no node selected', () => {
    renderGraph();

    expect(screen.getByText('Click on a node to view details')).toBeInTheDocument();
  });
});
