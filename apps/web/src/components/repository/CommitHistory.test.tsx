import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { CommitHistory } from './CommitHistory';
import type { CommitInfo } from '../../services/repository';

const mockCommits: CommitInfo[] = [
  {
    sha: 'abc123def456789',
    message: 'Initial commit\n\nThis is the first commit with a longer body.',
    author: {
      name: 'Test User',
      email: 'test@example.com',
      date: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    },
    committer: {
      name: 'Test User',
      email: 'test@example.com',
      date: new Date(Date.now() - 3600000).toISOString(),
    },
    parents: [],
  },
  {
    sha: 'def456ghi789012',
    message: 'Add README file',
    author: {
      name: 'Another User',
      email: 'another@example.com',
      date: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    },
    committer: {
      name: 'Another User',
      email: 'another@example.com',
      date: new Date(Date.now() - 86400000).toISOString(),
    },
    parents: ['abc123def456789'],
  },
];

const renderComponent = (props = {}) => {
  const defaultProps = {
    commits: mockCommits,
    owner: 'testuser',
    repo: 'test-repo',
    isLoading: false,
    hasMore: false,
    onLoadMore: vi.fn(),
  };

  return render(
    <BrowserRouter>
      <CommitHistory {...defaultProps} {...props} />
    </BrowserRouter>
  );
};

describe('CommitHistory', () => {
  it('renders commit list', () => {
    renderComponent();

    expect(screen.getByText('Initial commit')).toBeInTheDocument();
    expect(screen.getByText('Add README file')).toBeInTheDocument();
  });

  it('shows author names', () => {
    renderComponent();

    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('Another User')).toBeInTheDocument();
  });

  it('shows relative time', () => {
    renderComponent();

    expect(screen.getByText(/hour.*ago/)).toBeInTheDocument();
    expect(screen.getByText(/day.*ago/)).toBeInTheDocument();
  });

  it('shows short SHA', () => {
    renderComponent();

    // Should show first 7 characters of SHA
    expect(screen.getByText('abc123d')).toBeInTheDocument();
    expect(screen.getByText('def456g')).toBeInTheDocument();
  });

  it('copies SHA when clicking SHA chip', async () => {
    const mockClipboard = { writeText: vi.fn() };
    Object.assign(navigator, { clipboard: mockClipboard });

    renderComponent();

    const shaChip = screen.getByText('abc123d');
    fireEvent.click(shaChip);

    expect(mockClipboard.writeText).toHaveBeenCalledWith('abc123def456789');
  });

  it('shows loading skeleton when isLoading and no commits', () => {
    renderComponent({ commits: [], isLoading: true });

    const skeletons = document.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows empty message when no commits', () => {
    renderComponent({ commits: [], isLoading: false });

    expect(screen.getByText('No commits found')).toBeInTheDocument();
  });

  it('shows Load More button when hasMore is true', () => {
    renderComponent({ hasMore: true });

    expect(screen.getByText('Load more commits')).toBeInTheDocument();
  });

  it('calls onLoadMore when Load More button is clicked', () => {
    const onLoadMore = vi.fn();
    renderComponent({ hasMore: true, onLoadMore });

    fireEvent.click(screen.getByText('Load more commits'));

    expect(onLoadMore).toHaveBeenCalled();
  });

  it('hides Load More button when hasMore is false', () => {
    renderComponent({ hasMore: false });

    expect(screen.queryByText('Load more commits')).not.toBeInTheDocument();
  });

  it('shows author initials in avatar', () => {
    renderComponent();

    // "Test User" should have initials "TU"
    expect(screen.getByText('TU')).toBeInTheDocument();
    // "Another User" should have initials "AU"
    expect(screen.getByText('AU')).toBeInTheDocument();
  });
});
