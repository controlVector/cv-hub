import type { AuthenticatedUser } from './user';

export interface Session {
  id: string;
  userId: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: Date;
  expiresAt: Date;
  lastActiveAt: Date;
  isCurrent?: boolean;
}

export interface TokenPayload {
  sub: string;        // user id
  iat: number;        // issued at
  exp: number;        // expires at
  jti: string;        // token id
  sid: string;        // session id
  type: 'access' | 'refresh';
}

export interface AuthResponse {
  user: AuthenticatedUser;
  accessToken: string;
  expiresIn: number;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirm {
  token: string;
  password: string;
}

export interface EmailVerificationRequest {
  token: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
