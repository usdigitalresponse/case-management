import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('isWhitelistedExternalEmail', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows a listed email regardless of case or surrounding whitespace', async () => {
    vi.stubEnv('EXTERNAL_EMAIL_WHITELIST', 'vendor1@example.com, Vendor2@Example.com');
    const { isWhitelistedExternalEmail } = await import('../src/auth/externalEmailWhitelist');
    expect(isWhitelistedExternalEmail('VENDOR1@example.com')).toBe(true);
    expect(isWhitelistedExternalEmail(' vendor2@example.com ')).toBe(true);
  });

  it('rejects an email not on the list, including when the list is unset', async () => {
    vi.stubEnv('EXTERNAL_EMAIL_WHITELIST', 'vendor1@example.com');
    const { isWhitelistedExternalEmail } = await import('../src/auth/externalEmailWhitelist');
    expect(isWhitelistedExternalEmail('someone-else@example.com')).toBe(false);

    vi.resetModules();
    vi.unstubAllEnvs();
    const { isWhitelistedExternalEmail: isWhitelistedWithNoList } = await import(
      '../src/auth/externalEmailWhitelist'
    );
    expect(isWhitelistedWithNoList('vendor1@example.com')).toBe(false);
  });
});
