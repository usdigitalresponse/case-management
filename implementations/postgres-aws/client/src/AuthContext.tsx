import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert } from '@trussworks/react-uswds';
import { ApiError, devLogin, getCurrentUser, logout as apiLogout, type AuthenticatedUser } from './api/client';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  devLogin: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch((error: unknown) => {
        // 401 just means "not signed in yet" — not an error worth surfacing.
        if (!(error instanceof ApiError && error.status === 401)) {
          // eslint-disable-next-line no-console
          console.error(error);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleDevLogin = useCallback(async () => {
    const nextUser = await devLogin();
    setUser(nextUser);
  }, []);

  const handleLogout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, devLogin: handleDevLogin, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}

// Centralizes the loading/not-signed-in gate every protected route
// previously repeated individually — wrap a route's element with this
// instead of re-checking `loading`/`user` in each page component.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return null;
  }
  if (!user) {
    return <Alert type="info">Sign in to continue.</Alert>;
  }
  return <>{children}</>;
}
