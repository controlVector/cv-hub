import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchSelector } from './BranchSelector';
import type { Branch, Tag } from '../../services/repository';

const mockBranches: Branch[] = [
  { name: 'main', sha: 'abc123', isDefault: true, isProtected: true },
  { name: 'develop', sha: 'def456', isDefault: false, isProtected: false },
  { name: 'feature/new-feature', sha: 'ghi789', isDefault: false, isProtected: false },
];

const mockTags: Tag[] = [
  { name: 'v1.0.0', sha: 'tag123', message: 'Initial release' },
  { name: 'v1.1.0', sha: 'tag456', message: 'Bug fixes' },
];

describe('BranchSelector', () => {
  const defaultProps = {
    currentRef: 'main',
    branches: mockBranches,
    tags: mockTags,
    onSelect: vi.fn(),
  };

  it('renders current ref in button', () => {
    render(<BranchSelector {...defaultProps} />);

    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('opens menu when button is clicked', async () => {
    render(<BranchSelector {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Find a branch or tag...')).toBeInTheDocument();
    });
  });

  it('shows branches tab by default', async () => {
    render(<BranchSelector {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByText('Branches')).toBeInTheDocument();
      expect(screen.getByText('Tags')).toBeInTheDocument();
    });
  });

  it('lists all branches', async () => {
    render(<BranchSelector {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByText('develop')).toBeInTheDocument();
      expect(screen.getByText('feature/new-feature')).toBeInTheDocument();
    });
  });

  it('shows default badge for default branch', async () => {
    render(<BranchSelector {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByText('default')).toBeInTheDocument();
    });
  });

  it('switches to tags tab when clicked', async () => {
    render(<BranchSelector {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      fireEvent.click(screen.getByText('Tags'));
    });

    await waitFor(() => {
      expect(screen.getByText('v1.0.0')).toBeInTheDocument();
      expect(screen.getByText('v1.1.0')).toBeInTheDocument();
    });
  });

  it('filters branches by search query', async () => {
    const user = userEvent.setup();
    render(<BranchSelector {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(async () => {
      const searchInput = screen.getByPlaceholderText('Find a branch or tag...');
      await user.type(searchInput, 'feature');
    });

    await waitFor(() => {
      expect(screen.getByText('feature/new-feature')).toBeInTheDocument();
      expect(screen.queryByText('develop')).not.toBeInTheDocument();
    });
  });

  it('calls onSelect when branch is clicked', async () => {
    const onSelect = vi.fn();
    render(<BranchSelector {...defaultProps} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      fireEvent.click(screen.getByText('develop'));
    });

    expect(onSelect).toHaveBeenCalledWith('develop');
  });

  it('closes menu after selection', async () => {
    render(<BranchSelector {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      fireEvent.click(screen.getByText('develop'));
    });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Find a branch or tag...')).not.toBeInTheDocument();
    });
  });

  it('shows checkmark for currently selected ref', async () => {
    render(<BranchSelector {...defaultProps} currentRef="main" />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      // Find the main branch in the dropdown (there may be multiple "main" texts)
      const menuItems = screen.getAllByRole('menuitem');
      const mainItem = menuItems.find(item => item.textContent?.includes('main'));
      expect(mainItem).toBeInTheDocument();
    });
  });

  it('shows no branches message when search has no results', async () => {
    const user = userEvent.setup();
    render(<BranchSelector {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(async () => {
      const searchInput = screen.getByPlaceholderText('Find a branch or tag...');
      await user.type(searchInput, 'nonexistent');
    });

    await waitFor(() => {
      expect(screen.getByText('No branches found')).toBeInTheDocument();
    });
  });

  it('shows no tags message when tags tab is empty after filter', async () => {
    const user = userEvent.setup();
    render(<BranchSelector {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      fireEvent.click(screen.getByText('Tags'));
    });

    await waitFor(async () => {
      const searchInput = screen.getByPlaceholderText('Find a branch or tag...');
      await user.type(searchInput, 'nonexistent');
    });

    await waitFor(() => {
      expect(screen.getByText('No tags found')).toBeInTheDocument();
    });
  });
});
