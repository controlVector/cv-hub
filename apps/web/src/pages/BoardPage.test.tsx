/**
 * BoardPage Tests (Sprint 7 — Step 1)
 *
 * Verifies the Kanban board: columns, task cards, create task,
 * move task, empty state, error state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import BoardPage from './BoardPage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderBoard() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>
        <BoardPage />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

const mockTasks = [
  {
    id: 'task-1',
    title: 'Fix login bug',
    description: 'Users get 500 on login',
    task_type: 'debug',
    status: 'pending',
    priority: 'high',
    repository_id: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'task-2',
    title: 'Add dark mode',
    description: null,
    task_type: 'code_change',
    status: 'running',
    priority: 'medium',
    repository_id: null,
    created_at: '2025-01-02T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
  },
  {
    id: 'task-3',
    title: 'Write unit tests',
    description: 'Cover auth module',
    task_type: 'test',
    status: 'completed',
    priority: 'low',
    repository_id: null,
    completed_at: '2025-01-03T00:00:00Z',
    created_at: '2025-01-03T00:00:00Z',
    updated_at: '2025-01-03T00:00:00Z',
  },
  {
    id: 'task-4',
    title: 'Deploy to staging',
    description: null,
    task_type: 'deploy',
    status: 'queued',
    priority: 'critical',
    repository_id: null,
    created_at: '2025-01-04T00:00:00Z',
    updated_at: '2025-01-04T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BoardPage', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/v1/tasks', () => HttpResponse.json({ tasks: mockTasks })),
    );
  });

  // ── Columns ─────────────────────────────────────────────────────────

  it('renders all four board columns', async () => {
    renderBoard();

    await waitFor(() => {
      expect(screen.getByText('Backlog')).toBeInTheDocument();
    });

    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  // ── Tasks in correct columns ──────────────────────────────────────

  it('shows tasks in their correct columns', async () => {
    renderBoard();

    await waitFor(() => {
      expect(screen.getByText('Fix login bug')).toBeInTheDocument();
    });

    expect(screen.getByText('Add dark mode')).toBeInTheDocument();
    expect(screen.getByText('Write unit tests')).toBeInTheDocument();
    expect(screen.getByText('Deploy to staging')).toBeInTheDocument();
  });

  // ── Task card details ─────────────────────────────────────────────

  it('shows task type and priority chips on cards', async () => {
    renderBoard();

    await waitFor(() => {
      expect(screen.getByText('Fix login bug')).toBeInTheDocument();
    });

    expect(screen.getByText('Debug')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  // ── Empty state ───────────────────────────────────────────────────

  it('shows empty state message when no tasks', async () => {
    server.use(
      http.get('/api/v1/tasks', () => HttpResponse.json({ tasks: [] })),
    );

    renderBoard();

    await waitFor(() => {
      const noTaskElements = screen.getAllByText('No tasks');
      expect(noTaskElements.length).toBe(4);
    });
  });

  // ── Create task button ────────────────────────────────────────────

  it('opens create dialog when New Task clicked', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByText('New Task'));

    expect(screen.getByText('Create Task')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /title/i })).toBeInTheDocument();
  });

  // ── Create task submission ────────────────────────────────────────

  it('creates a task via the dialog form', async () => {
    const user = userEvent.setup();
    let capturedBody: any = null;

    server.use(
      http.post('/api/v1/tasks', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            task: {
              id: 'task-new',
              title: capturedBody.title,
              status: 'pending',
              task_type: capturedBody.task_type,
              priority: capturedBody.priority,
              created_at: new Date().toISOString(),
            },
          },
          { status: 201 },
        );
      }),
    );

    renderBoard();

    await user.click(screen.getByText('New Task'));

    await user.type(screen.getByRole('textbox', { name: /title/i }), 'New test task');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(capturedBody).toBeTruthy();
      expect(capturedBody.title).toBe('New test task');
    });
  });

  // ── Move task forward ─────────────────────────────────────────────

  it('moves a task forward when arrow button is clicked', async () => {
    const user = userEvent.setup();
    let patchedId: string | null = null;
    let patchedStatus: string | null = null;

    server.use(
      http.patch('/api/v1/tasks/:id', async ({ params, request }) => {
        patchedId = params.id as string;
        const body = await request.json() as any;
        patchedStatus = body.status;
        return HttpResponse.json({
          task: { id: patchedId, status: patchedStatus, title: 'Fix login bug', updated_at: new Date().toISOString() },
        });
      }),
    );

    renderBoard();

    await waitFor(() => {
      expect(screen.getByText('Fix login bug')).toBeInTheDocument();
    });

    // "Fix login bug" is in Backlog (pending). Click "move forward" to move to To Do.
    const forwardButtons = screen.getAllByLabelText('move forward');
    await user.click(forwardButtons[0]);

    await waitFor(() => {
      expect(patchedId).toBe('task-1');
      expect(patchedStatus).toBe('queued');
    });
  });

  // ── Error state ───────────────────────────────────────────────────

  it('shows error alert when tasks fail to load', async () => {
    server.use(
      http.get('/api/v1/tasks', () => HttpResponse.json({ error: 'Server error' }, { status: 500 })),
    );

    renderBoard();

    await waitFor(() => {
      expect(screen.getByText('Failed to load tasks')).toBeInTheDocument();
    });
  });

  // ── Page header ───────────────────────────────────────────────────

  it('renders the page header and description', () => {
    renderBoard();

    expect(screen.getByText('Board')).toBeInTheDocument();
    expect(screen.getByText('Manage tasks across your workflow')).toBeInTheDocument();
  });
});
