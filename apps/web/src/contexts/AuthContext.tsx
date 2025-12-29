import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setAccessToken } from '../lib/api';
import type { AuthenticatedUser, LoginInput, RegisterInput } from '@cv-hub/shared';

interface AuthState {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  login: (data: LoginInput) => Promise<void>;
  register: (data: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  setAuthenticatedUser: (user: AuthenticatedUser) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const queryClient = useQueryClient();

  const initializeAuth = useCallback(async () => {
    try {
      // Try to refresh token on page load
      const response = await api.post('/auth/refresh');
      setAccessToken(response.data.accessToken);

      // Fetch user data
      const userResponse = await api.get('/auth/me');
      setState({
        user: userResponse.data.user,
        isLoading: false,
        isAuthenticated: true,
      });
    } catch {
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
    }
  }, []);

  // Initialize auth on mount
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  const login = useCallback(async (data: LoginInput) => {
    const response = await api.post('/auth/login', data);
    setAccessToken(response.data.accessToken);
    setState({
      user: response.data.user,
      isLoading: false,
      isAuthenticated: true,
    });
  }, []);

  const register = useCallback(async (data: RegisterInput) => {
    const response = await api.post('/auth/register', data);
    setAccessToken(response.data.accessToken);
    setState({
      user: response.data.user,
      isLoading: false,
      isAuthenticated: true,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
      queryClient.clear();
    }
  }, [queryClient]);

  const refreshAuth = useCallback(async () => {
    try {
      const response = await api.post('/auth/refresh');
      setAccessToken(response.data.accessToken);

      // Also fetch user data to update state
      const userResponse = await api.get('/auth/me');
      setState({
        user: userResponse.data.user,
        isLoading: false,
        isAuthenticated: true,
      });
    } catch {
      setAccessToken(null);
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
    }
  }, []);

  // Set authenticated user directly (for use after MFA login)
  const setAuthenticatedUser = useCallback((user: AuthenticatedUser) => {
    setState({
      user,
      isLoading: false,
      isAuthenticated: true,
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refreshAuth, setAuthenticatedUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
