export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  email?: string;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export interface AuthenticatedUser extends Omit<User, 'email'> {
  email: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}
