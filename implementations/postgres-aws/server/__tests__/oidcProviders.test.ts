import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailFromProfile } from '../src/auth/oidcProviders';

describe('emailFromProfile', () => {
  it('reads a Google-shaped profile (emails array)', () => {
    expect(emailFromProfile({ emails: [{ value: 'staff@example.com' }] })).toBe('staff@example.com');
  });

  it('falls back to the raw email claim (e.g. a Microsoft-shaped profile)', () => {
    expect(emailFromProfile({ _json: { email: 'staff@agency.example' } })).toBe('staff@agency.example');
  });

  it('falls back to preferred_username when no email claim is present', () => {
    expect(emailFromProfile({ _json: { preferred_username: 'staff@agency.example' } })).toBe('staff@agency.example');
  });

  it('returns undefined when no claim yields an email', () => {
    expect(emailFromProfile({})).toBeUndefined();
  });
});

describe('configureOidcProviders', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('configures no providers when no credentials are set', async () => {
    const { configureOidcProviders } = await import('../src/auth/oidcProviders');
    expect(configureOidcProviders()).toEqual([]);
  });

  it('configures only Google when only Google credentials are set', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret');
    const { configureOidcProviders } = await import('../src/auth/oidcProviders');

    const providers = configureOidcProviders();
    expect(providers.map((p) => p.id)).toEqual(['google']);
  });

  it('configures Microsoft once its tenant/client id/secret are all set', async () => {
    vi.stubEnv('MICROSOFT_TENANT_ID', 'tenant-123');
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'ms-client-id');
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'ms-client-secret');
    const { configureOidcProviders } = await import('../src/auth/oidcProviders');

    const providers = configureOidcProviders();
    expect(providers.map((p) => p.id)).toEqual(['microsoft']);
    expect(providers[0]?.issuer).toBe('https://login.microsoftonline.com/tenant-123/v2.0');
  });

  it('configures both when both are set, each with its own allowedDomains', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret');
    vi.stubEnv('MICROSOFT_TENANT_ID', 'tenant-123');
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'ms-client-id');
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'ms-client-secret');
    vi.stubEnv('MICROSOFT_ALLOWED_DOMAINS', 'agency.example');
    const { configureOidcProviders } = await import('../src/auth/oidcProviders');

    const providers = configureOidcProviders();
    expect(providers.map((p) => p.id).sort()).toEqual(['google', 'microsoft']);
    const google = providers.find((p) => p.id === 'google');
    const microsoft = providers.find((p) => p.id === 'microsoft');
    expect(google?.allowedDomains).toEqual(['usdigitalresponse.org', 'usdrvolunteers.org']);
    expect(microsoft?.allowedDomains).toEqual(['agency.example']);
  });
});
