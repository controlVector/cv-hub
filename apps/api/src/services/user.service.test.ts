import { describe, it, expect, beforeEach } from 'vitest';
import { createUser, authenticateUser, getUserById } from './user.service';
import { getTestDb, truncateAllTables } from '../test/test-db';
import { users, passwordCredentials } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('UserService', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  describe('createUser', () => {
    it('creates a new user with hashed password', async () => {
      const input = {
        email: 'test@example.com',
        username: 'testuser',
        password: 'SecurePassword123!',
        displayName: 'Test User',
      };

      const user = await createUser(input);

      expect(user.id).toBeDefined();
      expect(user.email).toBe('test@example.com');
      expect(user.username).toBe('testuser');
      expect(user.displayName).toBe('Test User');
      expect(user.emailVerified).toBe(false);
      expect(user.mfaEnabled).toBe(false);
    });

    it('creates password credential for the user', async () => {
      const input = {
        email: 'test@example.com',
        username: 'testuser',
        password: 'SecurePassword123!',
      };

      const user = await createUser(input);

      // Verify password credential was created
      const db = getTestDb();
      const [credential] = await db
        .select()
        .from(passwordCredentials)
        .where(eq(passwordCredentials.userId, user.id));

      expect(credential).toBeDefined();
      expect(credential.passwordHash).toBeDefined();
      expect(credential.passwordHash).not.toBe('SecurePassword123!'); // Should be hashed
    });

    it('throws ConflictError when email already exists', async () => {
      const input = {
        email: 'duplicate@example.com',
        username: 'user1',
        password: 'password123',
      };

      await createUser(input);

      // Try to create another user with same email
      await expect(
        createUser({
          email: 'duplicate@example.com',
          username: 'user2',
          password: 'password123',
        })
      ).rejects.toThrow('Email or username already in use');
    });

    it('throws ConflictError when username already exists', async () => {
      const input = {
        email: 'user1@example.com',
        username: 'duplicate',
        password: 'password123',
      };

      await createUser(input);

      // Try to create another user with same username
      await expect(
        createUser({
          email: 'user2@example.com',
          username: 'duplicate',
          password: 'password123',
        })
      ).rejects.toThrow('Email or username already in use');
    });

    it('uses username as displayName when not provided', async () => {
      const user = await createUser({
        email: 'test@example.com',
        username: 'myusername',
        password: 'password123',
      });

      expect(user.displayName).toBe('myusername');
    });

    it('generates email verification token', async () => {
      const user = await createUser({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
      });

      // Check that verification token was set in database
      const db = getTestDb();
      const [dbUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, user.id));

      expect(dbUser.emailVerificationToken).toBeDefined();
      expect(dbUser.emailVerificationExpires).toBeDefined();
      expect(dbUser.emailVerificationExpires!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('authenticateUser', () => {
    beforeEach(async () => {
      // Create a test user for authentication tests
      await createUser({
        email: 'auth@example.com',
        username: 'authuser',
        password: 'CorrectPassword123!',
      });
    });

    it('returns user for valid credentials', async () => {
      const user = await authenticateUser('auth@example.com', 'CorrectPassword123!');

      expect(user.email).toBe('auth@example.com');
      expect(user.username).toBe('authuser');
    });

    it('throws AuthenticationError for invalid email', async () => {
      await expect(
        authenticateUser('nonexistent@example.com', 'CorrectPassword123!')
      ).rejects.toThrow('Invalid email or password');
    });

    it('throws AuthenticationError for invalid password', async () => {
      await expect(
        authenticateUser('auth@example.com', 'WrongPassword!')
      ).rejects.toThrow('Invalid email or password');
    });

    it('returns complete user profile', async () => {
      const user = await authenticateUser('auth@example.com', 'CorrectPassword123!');

      expect(user).toMatchObject({
        email: 'auth@example.com',
        username: 'authuser',
        emailVerified: false,
        mfaEnabled: false,
      });
      expect(user.id).toBeDefined();
      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
    });
  });

  describe('getUserById', () => {
    it('returns user when found', async () => {
      const createdUser = await createUser({
        email: 'getbyid@example.com',
        username: 'getbyiduser',
        password: 'password123',
        displayName: 'Get By ID User',
      });

      const foundUser = await getUserById(createdUser.id);

      expect(foundUser).not.toBeNull();
      expect(foundUser!.id).toBe(createdUser.id);
      expect(foundUser!.email).toBe('getbyid@example.com');
      expect(foundUser!.username).toBe('getbyiduser');
      expect(foundUser!.displayName).toBe('Get By ID User');
    });

    it('returns null when user not found', async () => {
      const user = await getUserById('00000000-0000-0000-0000-000000000000');

      expect(user).toBeNull();
    });

    it('returns user without password information', async () => {
      const createdUser = await createUser({
        email: 'secure@example.com',
        username: 'secureuser',
        password: 'password123',
      });

      const foundUser = await getUserById(createdUser.id);

      // Ensure no password-related fields are exposed
      expect(foundUser).not.toHaveProperty('passwordHash');
      expect(foundUser).not.toHaveProperty('password');
    });
  });
});
