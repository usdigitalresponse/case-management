// Full-user ("sso") sign-in: one OIDC strategy implementation, registered
// once per configured provider, rather than a different passport strategy
// library per identity provider. See ../../MAPPING.md "Multi-IdP SSO".
import passport from 'passport';
import { Strategy as OidcStrategy, type Profile } from 'passport-openidconnect';
import { db } from '../db/client';
import { parseCommaSeparatedList } from './emailLists';
import { ensureUserAccountForEmail } from './userAccounts';

export interface AuthenticatedUser {
  userAccountId: string;
  email: string;
  displayName: string;
  // Distinguishes a full agency login (any configured OIDC provider) from
  // an external user admitted only via a case-scoped magic link
  // (../routes/magicLink.ts) — routes that external users must not reach
  // should check this rather than assume every session is a full user.
  authType: 'sso' | 'magic-link';
  // Which provider the session actually authenticated through (e.g.
  // 'google', 'microsoft') — display/audit only; authorization logic
  // should use authType, not this.
  ssoProvider?: string;
}

export interface OidcProviderConfig {
  id: string;
  displayName: string;
  issuer: string;
  authorizationURL: string;
  tokenURL: string;
  userInfoURL: string;
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  // Only emails in these domains may authenticate through *this*
  // provider — not a single flat allowlist, so a domain can't sign in
  // through the wrong IdP.
  allowedDomains: string[];
}

export function emailFromProfile(profile: Profile): string | undefined {
  return profile.emails?.[0]?.value ?? (profile._json?.email as string | undefined) ?? (profile._json
    ?.preferred_username as string | undefined);
}

function isAllowedEmail(email: string, allowedDomains: string[]): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain !== undefined && allowedDomains.includes(domain);
}

type ProviderConfigRest = Omit<OidcProviderConfig, 'id' | 'displayName'>;

// One entry per supported IdP: which env vars gate it being enabled at
// all, and how to turn those (guaranteed-present, by the time
// `buildConfig` runs) values into the rest of the config. Adding a third
// provider means adding one entry here, not another copy-pasted
// if-env-vars-set-then-push block.
interface ProviderDefinition {
  id: string;
  displayName: string;
  requiredEnvVars: string[];
  buildConfig: (requiredEnv: Record<string, string>) => ProviderConfigRest;
}

const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'google',
    displayName: 'Google',
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    buildConfig: (env) => ({
      issuer: 'https://accounts.google.com',
      authorizationURL: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenURL: 'https://oauth2.googleapis.com/token',
      userInfoURL: 'https://openidconnect.googleapis.com/v1/userinfo',
      clientID: requireEnvValue(env, 'GOOGLE_CLIENT_ID'),
      clientSecret: requireEnvValue(env, 'GOOGLE_CLIENT_SECRET'),
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      allowedDomains: [
        'usdigitalresponse.org',
        'usdrvolunteers.org',
        ...parseCommaSeparatedList(process.env.GOOGLE_ALLOWED_DOMAINS),
      ],
    }),
  },
  {
    id: 'microsoft',
    displayName: 'Microsoft',
    requiredEnvVars: ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
    buildConfig: (env) => {
      const tenantId = requireEnvValue(env, 'MICROSOFT_TENANT_ID');
      return {
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        authorizationURL: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
        tokenURL: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        userInfoURL: 'https://graph.microsoft.com/oidc/userinfo',
        clientID: requireEnvValue(env, 'MICROSOFT_CLIENT_ID'),
        clientSecret: requireEnvValue(env, 'MICROSOFT_CLIENT_SECRET'),
        callbackURL: process.env.MICROSOFT_CALLBACK_URL || '/auth/microsoft/callback',
        allowedDomains: parseCommaSeparatedList(process.env.MICROSOFT_ALLOWED_DOMAINS),
      };
    },
  },
];

// Returns the named env vars as a Record<string, string>, or undefined if
// any of them isn't set. `noUncheckedIndexedAccess` still types a lookup
// into the result as `string | undefined` (the index signature doesn't
// know a given key was checked) — ../db/rowHelpers.ts's `firstRow` narrows
// the same kind of "already guaranteed, TS just can't see it" case for
// query results; `requireEnvValue` below does the same for this one.
function getRequiredEnv(names: string[]): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (!value) {
      return undefined;
    }
    values[name] = value;
  }
  return values;
}

function requireEnvValue(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (!value) {
    throw new Error(`Expected ${name} to already be validated present by getRequiredEnv.`);
  }
  return value;
}

function buildProviderConfigs(): OidcProviderConfig[] {
  const configs: OidcProviderConfig[] = [];
  for (const definition of PROVIDER_DEFINITIONS) {
    const requiredEnv = getRequiredEnv(definition.requiredEnvVars);
    if (!requiredEnv) {
      continue;
    }
    configs.push({
      id: definition.id,
      displayName: definition.displayName,
      ...definition.buildConfig(requiredEnv),
    });
  }
  return configs;
}

export function passportStrategyName(providerId: string): string {
  return `oidc:${providerId}`;
}

// Registers a passport strategy per configured provider, skipping any
// whose credentials aren't set, and returns the list so app.ts/routes/auth.ts
// know what to mount and the client can render sign-in buttons without
// hardcoding a provider name.
export function configureOidcProviders(): OidcProviderConfig[] {
  const configs = buildProviderConfigs();

  for (const config of configs) {
    passport.use(
      passportStrategyName(config.id),
      new OidcStrategy(
        {
          issuer: config.issuer,
          authorizationURL: config.authorizationURL,
          tokenURL: config.tokenURL,
          userInfoURL: config.userInfoURL,
          clientID: config.clientID,
          clientSecret: config.clientSecret,
          callbackURL: config.callbackURL,
          // passport-openidconnect always prepends 'openid' itself
          // (lib/strategy.js), so listing it here too would send a
          // harmless but duplicated "openid openid profile email" scope.
          scope: ['profile', 'email'],
          // Without this, passport-openidconnect's default heuristic skips
          // the userInfoURL fetch entirely for a 3-arg verify callback (see
          // node_modules/passport-openidconnect/lib/strategy.js
          // _shouldLoadUserProfile) and emailFromProfile only ever sees
          // ID-token claims. Google's ID token includes `email` by
          // default, masking this, but Microsoft Entra ID's v2.0 ID token
          // commonly omits it — without this flag, an allowed Microsoft
          // user would be wrongly rejected as "not allowed to sign in."
          skipUserProfile: false,
        },
        (_issuer, profile, done) => {
          void (async () => {
            try {
              const email = emailFromProfile(profile);
              if (!email || !isAllowedEmail(email, config.allowedDomains)) {
                done(null, false, { message: 'Email domain is not allowed to sign in.' });
                return;
              }

              const account = await ensureUserAccountForEmail(db, email, profile.displayName || email);

              const user: AuthenticatedUser = {
                userAccountId: account.userAccountId,
                email: account.email,
                displayName: account.displayName,
                authType: 'sso',
                ssoProvider: config.id,
              };
              done(null, user);
            } catch (error) {
              done(error);
            }
          })();
        },
      ),
    );
  }

  return configs;
}
