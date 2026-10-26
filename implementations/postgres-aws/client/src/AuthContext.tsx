import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  ApiError,
  demoLogin,
  externalDemoLogin,
  getCurrentUser,
  logout as apiLogout,
  verifyMagicLink,
  type AuthenticatedUser,
} from './api/client';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  demoLogin: (userAccountId?: string) => Promise<void>;
  externalDemoLogin: (userAccountId?: string) => Promise<void>;
  verifyMagicLink: (token: string) => Promise<void>;
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

  const handleDemoLogin = useCallback(async (userAccountId?: string) => {
    await demoLogin(userAccountId);
    // The login response lacks isAdmin; /auth/me has it.
    setUser(await getCurrentUser());
  }, []);

  const handleExternalDemoLogin = useCallback(async (userAccountId?: string) => {
    const nextUser = await externalDemoLogin(userAccountId);
    setUser(nextUser);
  }, []);

  const handleVerifyMagicLink = useCallback(async (token: string) => {
    const nextUser = await verifyMagicLink(token);
    setUser(nextUser);
  }, []);

  const handleLogout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        demoLogin: handleDemoLogin,
        externalDemoLogin: handleExternalDemoLogin,
        verifyMagicLink: handleVerifyMagicLink,
        logout: handleLogout,
      }}
    >
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
