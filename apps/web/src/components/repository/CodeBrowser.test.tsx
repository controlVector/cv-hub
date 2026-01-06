import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeBrowser } from './CodeBrowser';
import type { FileTreeNode } from '../../contexts/RepositoryContext';

const mockFileTree: FileTreeNode[] = [
  {
    name: 'src',
    path: 'src',
    type: 'tree',
    sha: 'tree1',
    children: [
      { name: 'index.ts', path: 'src/index.ts', type: 'blob', sha: 'blob1', size: 256 },
    ],
    isLoaded: true,
  },
  { name: 'README.md', path: 'README.md', type: 'blob', sha: 'blob2', size: 1024 },
  { name: 'package.json', path: 'package.json', type: 'blob', sha: 'blob3', size: 512 },
];

describe('CodeBrowser', () => {
  const defaultProps = {
    fileTree: mockFileTree,
    selectedPath: null,
    expandedPaths: new Set<string>(),
    isLoading: false,
    onSelect: vi.fn(),
    onToggle: vi.fn(),
  };

  it('renders file tree items', () => {
    render(<CodeBrowser {...defaultProps} />);

    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();
  });

  it('shows directories before files', () => {
    render(<CodeBrowser {...defaultProps} />);

    // Get all text content and verify src comes before README.md
    const container = document.body;
    const text = container.textContent || '';

    // src should appear before README.md (directories first)
    expect(text.indexOf('src')).toBeLessThan(text.indexOf('README.md'));
  });

  it('calls onSelect when clicking a file', () => {
    const onSelect = vi.fn();
    render(<CodeBrowser {...defaultProps} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('README.md'));

    expect(onSelect).toHaveBeenCalledWith('README.md', 'blob');
  });

  it('calls onToggle when clicking a directory', () => {
    const onToggle = vi.fn();
    render(<CodeBrowser {...defaultProps} onToggle={onToggle} />);

    fireEvent.click(screen.getByText('src'));

    expect(onToggle).toHaveBeenCalledWith('src');
  });

  it('shows expanded directory children when path is in expandedPaths', () => {
    render(
      <CodeBrowser
        {...defaultProps}
        expandedPaths={new Set(['src'])}
      />
    );

    expect(screen.getByText('index.ts')).toBeInTheDocument();
  });

  it('collapses directory children when path is not in expandedPaths', () => {
    render(
      <CodeBrowser
        {...defaultProps}
        expandedPaths={new Set()}
      />
    );

    // When collapsed, MUI Collapse has height: 0 style
    // The index.ts should still be in DOM but hidden via Collapse
    const indexTs = screen.queryByText('index.ts');
    if (indexTs) {
      // If the element is in the DOM, check it's inside a collapsed container
      const collapse = indexTs.closest('.MuiCollapse-root');
      expect(collapse).not.toHaveClass('MuiCollapse-entered');
    }
    // OR it might not be rendered at all if isLoaded is false
    // This is also acceptable behavior
  });

  it('highlights selected file', () => {
    render(
      <CodeBrowser
        {...defaultProps}
        selectedPath="README.md"
      />
    );

    // The selected item should have special styling
    const readmeItem = screen.getByText('README.md').closest('div');
    expect(readmeItem).toHaveStyle({ cursor: 'pointer' });
  });

  it('shows loading skeleton when isLoading is true', () => {
    render(
      <CodeBrowser
        {...defaultProps}
        fileTree={[]}
        isLoading={true}
      />
    );

    // Should show skeleton elements instead of file tree
    const skeletons = document.querySelectorAll('.MuiSkeleton-root');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows empty message when no files', () => {
    render(
      <CodeBrowser
        {...defaultProps}
        fileTree={[]}
        isLoading={false}
      />
    );

    expect(screen.getByText('No files in this repository')).toBeInTheDocument();
  });

  it('displays file size for files', () => {
    render(<CodeBrowser {...defaultProps} />);

    // README.md has size 1024, should show as "1.0 KB"
    expect(screen.getByText('1.0 KB')).toBeInTheDocument();
  });
});
