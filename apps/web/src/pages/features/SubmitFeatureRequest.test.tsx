import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubmitFeatureRequest from './SubmitFeatureRequest';
import { AuthProvider } from '../../contexts/AuthContext';

// Mock the auth context
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual('../../contexts/AuthContext');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'user1',
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
      },
      isLoading: false,
      isAuthenticated: true,
    }),
  };
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const renderComponent = () => {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SubmitFeatureRequest />
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe('SubmitFeatureRequest', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  describe('Step 1 - Problem Description', () => {
    it('renders the initial form with title and problem statement fields', () => {
      renderComponent();

      expect(screen.getByText('Submit a Feature Request')).toBeInTheDocument();
      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/problem statement/i)).toBeInTheDocument();
    });

    it('shows step indicator with correct active step', () => {
      renderComponent();

      expect(screen.getByText('Describe the Problem')).toBeInTheDocument();
      expect(screen.getByText('Propose a Solution')).toBeInTheDocument();
      expect(screen.getByText('Review & Submit')).toBeInTheDocument();
    });

    it('disables Next button when title is too short', async () => {
      renderComponent();

      const titleInput = screen.getByLabelText(/title/i);
      const nextButton = screen.getByRole('button', { name: /next/i });

      await userEvent.type(titleInput, 'Test');

      expect(nextButton).toBeDisabled();
    });

    it('disables Next button when problem statement is too short', async () => {
      renderComponent();

      const titleInput = screen.getByLabelText(/title/i);
      const problemInput = screen.getByLabelText(/problem statement/i);
      const nextButton = screen.getByRole('button', { name: /next/i });

      await userEvent.type(titleInput, 'Valid Title Here');
      await userEvent.type(problemInput, 'Short');

      expect(nextButton).toBeDisabled();
    });

    it('enables Next button when form is valid', async () => {
      renderComponent();

      const titleInput = screen.getByLabelText(/title/i);
      const problemInput = screen.getByLabelText(/problem statement/i);
      const nextButton = screen.getByRole('button', { name: /next/i });

      await userEvent.type(titleInput, 'Add dark mode support');
      await userEvent.type(
        problemInput,
        'Users are experiencing eye strain when using the application in low-light environments.'
      );

      expect(nextButton).not.toBeDisabled();
    });
  });

  describe('Step 2 - Proposed Solution', () => {
    it('navigates to step 2 when Next is clicked', async () => {
      renderComponent();

      const titleInput = screen.getByLabelText(/title/i);
      const problemInput = screen.getByLabelText(/problem statement/i);

      await userEvent.type(titleInput, 'Add dark mode support');
      await userEvent.type(
        problemInput,
        'Users are experiencing eye strain when using the application.'
      );

      const nextButton = screen.getByRole('button', { name: /next/i });
      await userEvent.click(nextButton);

      expect(screen.getByText('How would you solve it? (Optional)')).toBeInTheDocument();
      expect(screen.getByLabelText(/proposed solution/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/success criteria/i)).toBeInTheDocument();
    });

    it('allows proceeding without filling optional fields', async () => {
      renderComponent();

      // Fill step 1
      await userEvent.type(screen.getByLabelText(/title/i), 'Add dark mode support');
      await userEvent.type(
        screen.getByLabelText(/problem statement/i),
        'Users need dark mode for better visibility.'
      );
      await userEvent.click(screen.getByRole('button', { name: /next/i }));

      // Step 2 - don't fill anything, just click Next
      const nextButton = screen.getByRole('button', { name: /next/i });
      expect(nextButton).not.toBeDisabled();
    });

    it('allows going back to step 1', async () => {
      renderComponent();

      // Navigate to step 2
      await userEvent.type(screen.getByLabelText(/title/i), 'Add dark mode support');
      await userEvent.type(
        screen.getByLabelText(/problem statement/i),
        'Users need dark mode for better visibility.'
      );
      await userEvent.click(screen.getByRole('button', { name: /next/i }));

      // Click back
      const backButton = screen.getByRole('button', { name: /back/i });
      await userEvent.click(backButton);

      expect(screen.getByText('What problem are you trying to solve?')).toBeInTheDocument();
    });
  });

  describe('Step 3 - Review', () => {
    const fillAndNavigateToReview = async () => {
      await userEvent.type(screen.getByLabelText(/title/i), 'Add dark mode support');
      await userEvent.type(
        screen.getByLabelText(/problem statement/i),
        'Users are experiencing eye strain when using the application in low-light.'
      );
      await userEvent.click(screen.getByRole('button', { name: /next/i }));

      await userEvent.type(
        screen.getByLabelText(/proposed solution/i),
        'Implement a theme toggle.'
      );
      await userEvent.click(screen.getByRole('button', { name: /next/i }));
    };

    it('shows review of entered data', async () => {
      renderComponent();
      await fillAndNavigateToReview();

      expect(screen.getByText('Review Your Request')).toBeInTheDocument();
      expect(screen.getByText('Add dark mode support')).toBeInTheDocument();
      expect(
        screen.getByText(/Users are experiencing eye strain/)
      ).toBeInTheDocument();
      expect(screen.getByText('Implement a theme toggle.')).toBeInTheDocument();
    });

    it('shows Submit Request button on review step', async () => {
      renderComponent();
      await fillAndNavigateToReview();

      expect(screen.getByRole('button', { name: /submit request/i })).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('shows character count for title', async () => {
      renderComponent();

      const titleInput = screen.getByLabelText(/title/i);
      await userEvent.type(titleInput, 'Test');

      expect(screen.getByText(/4\/255 characters/)).toBeInTheDocument();
    });

    it('shows error state when title is too short', async () => {
      renderComponent();

      const titleInput = screen.getByLabelText(/title/i);
      await userEvent.type(titleInput, 'Hi');

      // The input should have error styling
      expect(titleInput).toHaveAttribute('aria-invalid', 'true');
    });
  });
});
