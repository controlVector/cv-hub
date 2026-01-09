import type { NewUser } from '../../db/schema/users';

/**
 * Test user fixtures for consistent test data
 */

export const testUsers: Record<string, Omit<NewUser, 'id'>> = {
  regularUser: {
    username: 'regularuser',
    email: 'regular@example.com',
    displayName: 'Regular User',
    emailVerified: true,
    mfaEnabled: false,
  },

  unverifiedUser: {
    username: 'unverified',
    email: 'unverified@example.com',
    displayName: 'Unverified User',
    emailVerified: false,
    mfaEnabled: false,
  },

  mfaUser: {
    username: 'mfauser',
    email: 'mfa@example.com',
    displayName: 'MFA User',
    emailVerified: true,
    mfaEnabled: true,
  },

  adminUser: {
    username: 'admin',
    email: 'admin@example.com',
    displayName: 'Admin User',
    emailVerified: true,
    mfaEnabled: false,
  },

  enterpriseUser: {
    username: 'enterprise',
    email: 'user@maxnerva.com',
    displayName: 'Enterprise User',
    emailVerified: true,
    mfaEnabled: false,
  },
};

export const testPasswords = {
  default: 'TestPassword123!',
  weak: '12345',
  strong: 'V3ry$tr0ng&C0mpl3x!P@ssw0rd',
};
