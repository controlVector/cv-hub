/**
 * SettingsPage Tests (Sprint 6 — Step 6)
 *
 * Verifies the settings navigation hub renders all setting categories
 * and navigates to the correct paths.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderSettings() {
  return render(
    <BrowserRouter>
      <SettingsPage />
    </BrowserRouter>,
  );
}

describe('SettingsPage', () => {
  it('renders settings page header', () => {
    renderSettings();

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText(/manage your account/i)).toBeInTheDocument();
  });

  it('renders all settings categories', () => {
    renderSettings();

    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Connections')).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
  });

  it('shows descriptions for each category', () => {
    renderSettings();

    expect(screen.getByText(/two-factor authentication/i)).toBeInTheDocument();
    expect(screen.getByText(/api tokens/i)).toBeInTheDocument();
    expect(screen.getByText(/connect external services/i)).toBeInTheDocument();
    expect(screen.getByText(/environment variables/i)).toBeInTheDocument();
  });

  it('navigates to security settings on click', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText('Security'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/settings/security');
  });

  it('navigates to developer settings on click', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText('Developer'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/settings/developer');
  });
});
