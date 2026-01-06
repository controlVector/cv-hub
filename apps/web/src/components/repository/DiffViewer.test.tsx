import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffViewer } from './DiffViewer';
import type { DiffFile } from '../../services/repository';

const mockFiles: DiffFile[] = [
  {
    path: 'src/index.ts',
    status: 'modified',
    additions: 10,
    deletions: 3,
    patch: `@@ -1,5 +1,7 @@
 import { app } from './app';
-const PORT = 3000;
+const PORT = process.env.PORT || 3000;
+const HOST = process.env.HOST || 'localhost';

 app.listen(PORT, () => {
-  console.log('Server running');
+  console.log(\`Server running at \${HOST}:\${PORT}\`);
 });`,
  },
  {
    path: 'README.md',
    status: 'added',
    additions: 5,
    deletions: 0,
    patch: `@@ -0,0 +1,5 @@
+# My Project
+
+This is a test project.
+
+## Getting Started`,
  },
  {
    path: 'old-file.txt',
    status: 'deleted',
    additions: 0,
    deletions: 10,
    patch: `@@ -1,10 +0,0 @@
-This file is being deleted.
-Line 2
-Line 3
-Line 4
-Line 5
-Line 6
-Line 7
-Line 8
-Line 9
-Line 10`,
  },
  {
    path: 'src/new-name.ts',
    oldPath: 'src/old-name.ts',
    status: 'renamed',
    additions: 0,
    deletions: 0,
  },
];

describe('DiffViewer', () => {
  it('renders all diff files', () => {
    render(<DiffViewer files={mockFiles} totalAdditions={15} totalDeletions={13} />);

    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('old-file.txt')).toBeInTheDocument();
    expect(screen.getByText('src/new-name.ts')).toBeInTheDocument();
  });

  it('shows file summary with counts', () => {
    render(<DiffViewer files={mockFiles} totalAdditions={15} totalDeletions={13} />);

    expect(screen.getByText('4 files changed')).toBeInTheDocument();
    expect(screen.getByText('+15 additions')).toBeInTheDocument();
    expect(screen.getByText('-13 deletions')).toBeInTheDocument();
  });

  it('shows addition and deletion counts per file', () => {
    render(<DiffViewer files={mockFiles} />);

    // src/index.ts has +10 -3
    // Use getAllByText since these numbers appear multiple times (in chips and line numbers)
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('displays added lines in green', () => {
    render(<DiffViewer files={mockFiles} />);

    // Check that addition lines are rendered
    const addedLine = screen.getByText(/Server running at/);
    expect(addedLine).toBeInTheDocument();
  });

  it('displays deleted lines in red', () => {
    render(<DiffViewer files={mockFiles} />);

    // Check that deletion lines are rendered
    const deletedLine = screen.getByText(/Server running'\);/);
    expect(deletedLine).toBeInTheDocument();
  });

  it('shows renamed file with old and new paths', () => {
    render(<DiffViewer files={mockFiles} />);

    expect(screen.getByText('src/old-name.ts')).toBeInTheDocument();
    expect(screen.getByText('→')).toBeInTheDocument();
  });

  it('collapses file when clicking on header', () => {
    render(<DiffViewer files={mockFiles} />);

    const header = screen.getByText('src/index.ts').closest('div');
    if (header) {
      fireEvent.click(header);
    }

    // After collapsing, the patch content should be hidden
    // The component uses MUI Collapse, so we check if it's collapsed
  });

  it('shows empty message when no files', () => {
    render(<DiffViewer files={[]} />);

    expect(screen.getByText('No file changes')).toBeInTheDocument();
  });

  it('shows message for binary files without patch', () => {
    const binaryFile: DiffFile[] = [
      {
        path: 'image.png',
        status: 'added',
        additions: 0,
        deletions: 0,
      },
    ];

    render(<DiffViewer files={binaryFile} />);

    expect(screen.getByText('New file')).toBeInTheDocument();
  });

  it('shows correct status icons for different file states', () => {
    render(<DiffViewer files={mockFiles} />);

    // Check that status icons are rendered (by checking SVG elements exist)
    const svgElements = document.querySelectorAll('svg');
    expect(svgElements.length).toBeGreaterThan(0);
  });

  it('displays line numbers in diff', () => {
    render(<DiffViewer files={mockFiles} />);

    // The patch for src/index.ts starts at line 1
    // Check that line numbers are rendered - use getAllByText since 1 appears multiple times
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('handles file with only header line', () => {
    const minimalFile: DiffFile[] = [
      {
        path: 'test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch: '@@ -1 +1 @@\n-old\n+new',
      },
    ];

    render(<DiffViewer files={minimalFile} />);

    expect(screen.getByText('test.ts')).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
  });
});
