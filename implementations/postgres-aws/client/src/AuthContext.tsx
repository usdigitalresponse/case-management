import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { queryClient } from './queryClient';
import { resourceQuery } from './hooks/useResource';
import { authProviders } from './resources';
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
  // Counts sign-ins and sign-outs, so saved scroll positions don't carry over.
  signIns: number;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Outside the router; a new user starts at home (staff and portal pages differ) with only the sign-in options cached.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signIns, setSignIns] = useState(0);
  const switchUser = useCallback((next: AuthenticatedUser | null) => {
    window.history.replaceState(null, '', '/');
    // The header's organization name is the same for everyone; kept so it doesn't flash.
    const providers = queryClient.getQueryData(authProviders.key);
    queryClient.clear();
    if (providers) queryClient.setQueryData(authProviders.key, providers);
    // No navigation happens, so the page would keep the sign-in page's scroll.
    window.scrollTo(0, 0);
    setSignIns((count) => count + 1);
    setUser(next);
  }, []);

  useEffect(() => {
    // Loaded before the first page, so the header shows its organization name at once.
    const providers = queryClient.prefetchQuery(resourceQuery(authProviders));
    getCurrentUser()
      .then(setUser)
      .catch((error: unknown) => {
        // 401 just means "not signed in yet" — not an error worth surfacing.
        if (!(error instanceof ApiError && error.status === 401)) {
          // eslint-disable-next-line no-console
          console.error(error);
        }
      })
      .finally(() => void providers.finally(() => setLoading(false)));
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
        signIns,
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
