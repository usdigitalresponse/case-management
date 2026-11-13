import { request } from './http';

export interface AuthenticatedUser {
  userAccountId: string;
  email: string;
  displayName: string;
  authType: 'sso' | 'email-code';
  ssoProvider?: string;
  // From /auth/me only. They show or hide parts of the UI; the server
  // enforces each. isStaff: a staff role, so may enter invoices for others.
  isAdmin?: boolean;
  isStaff?: boolean;
  reviewPermissions?: ReviewPermissions | null;
  // The staff demo sign-in is on, so Settings has demo tools.
  demoMode?: boolean;
}

export interface ReviewPermissions {
  reviewLines: boolean;
  signOff: boolean;
  reassign: boolean;
  changeSettings: boolean;
}

export function getCurrentUser(): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/me');
}

// userAccountId: one of listDemoAccounts(); the server's default without it.
export function demoLogin(userAccountId?: string): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/demo-login', { method: 'POST', body: JSON.stringify({ userAccountId }) });
}

export function externalDemoLogin(userAccountId?: string): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/demo-login/external', { method: 'POST', body: JSON.stringify({ userAccountId }) });
}

// The seeded synthetic accounts the demo sign-ins may act as.
export interface DemoAccount {
  userAccountId: string;
  displayName: string;
  // The staff role, or the partner's kind of work.
  description: string | null;
}

export function listDemoAccounts(): Promise<{ staff: DemoAccount[]; partners: DemoAccount[] }> {
  return request<{ staff: DemoAccount[]; partners: DemoAccount[] }>('/auth/demo-accounts');
}

export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' });
}

export interface AuthProvider {
  id: string;
  displayName: string;
}

export interface AuthProvidersResponse {
  // Only providers with credentials configured (see ../../server/src/auth/oidcProviders.ts).
  providers: AuthProvider[];
  // Whether demo sign-in is allowed (DEMO_LOGIN_ENABLED).
  demoLoginEnabled: boolean;
  // The same for the external demo sign-in (EXTERNAL_DEMO_LOGIN_ENABLED).
  externalDemoLoginEnabled: boolean;
  // Set per deployment (ORGANIZATION_NAME); null for none.
  organizationName: string | null;
}

export function listAuthProviders(): Promise<AuthProvidersResponse> {
  return request<AuthProvidersResponse>('/auth/providers');
}

// The server answers 202 whether or not the email is known, so as not to reveal who may sign in.
export function requestSignInCode(email: string): Promise<void> {
  return request<void>('/auth/code/request', { method: 'POST', body: JSON.stringify({ email }) });
}

// 401 if the code is wrong, expired, used or out of tries.
export function verifySignInCode(email: string, code: string): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/code/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
}
