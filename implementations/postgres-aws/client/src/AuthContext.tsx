import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { queryClient } from './queryClient';
import {
  ApiError,
  demoLogin,
  externalDemoLogin,
  getCurrentUser,
  logout as apiLogout,
  verifySignInCode,
  type AuthenticatedUser,
} from './api/client';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  demoLogin: (userAccountId?: string) => Promise<void>;
  externalDemoLogin: (userAccountId?: string) => Promise<void>;
  signInWithCode: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  // Reloads roles and permissions after they change.
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Outside the router; a new user starts at home (staff and portal pages differ) with nothing cached.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const switchUser = useCallback((next: AuthenticatedUser | null) => {
    window.history.replaceState(null, '', '/');
    queryClient.clear();
    // No navigation happens, so drop the last user's saved scroll and start at the top.
    try {
      sessionStorage.removeItem('react-router-scroll-positions');
    } catch {
      // Unavailable, as in some private windows.
    }
    window.scrollTo(0, 0);
    setUser(next);
  }, []);

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
    switchUser(await getCurrentUser());
  }, [switchUser]);

  const handleExternalDemoLogin = useCallback(async (userAccountId?: string) => {
    switchUser(await externalDemoLogin(userAccountId));
  }, [switchUser]);

  const handleSignInWithCode = useCallback(async (email: string, code: string) => {
    switchUser(await verifySignInCode(email, code));
  }, [switchUser]);

  const handleLogout = useCallback(async () => {
    // Before signing out, so nothing on screen reloads without a session.
    queryClient.clear();
    await apiLogout();
    switchUser(null);
  }, [switchUser]);

  // New roles can see different data: refresh what is cached.
  const refreshUser = useCallback(async () => {
    setUser(await getCurrentUser());
    queryClient.removeQueries({ type: 'inactive' });
    await queryClient.invalidateQueries();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        demoLogin: handleDemoLogin,
        externalDemoLogin: handleExternalDemoLogin,
        signInWithCode: handleSignInWithCode,
        logout: handleLogout,
        refreshUser,
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
