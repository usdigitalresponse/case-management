// Staff SSO: one OIDC strategy registered per configured provider (../../docs/api.md "Multi-IdP SSO").
import passport from 'passport';
import { Strategy as OidcStrategy, type Profile } from 'passport-openidconnect';
import { db } from '../db/client';
import { parseCommaSeparatedList } from './emailLists';
import { ensureUserAccountForEmail } from './userAccounts';
import { getAdminAccountRoleId } from './staffAccountRole';

export interface AuthenticatedUser {
  userAccountId: string;
  email: string;
  displayName: string;
  // Staff SSO, or an external user's emailed code; routes external users must not reach check this.
  authType: 'sso' | 'email-code';
  // For display and audit only; authorization uses authType.
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
  // Per provider, so a domain can't sign in through the wrong one.
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

// One entry per supported provider: the env vars that turn it on, and its config built from them.
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

// The named env vars, or undefined if any isn't set.
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

// Registers a strategy per provider with credentials set, returning them for the routes and sign-in buttons.
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
          // passport-openidconnect adds 'openid' itself.
          scope: ['profile', 'email'],
          // Fetch userinfo even for a 3-argument verify callback: Microsoft Entra ID's ID token often lacks the email,
          // so an allowed user would otherwise be refused.
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

              // For now new accounts are administrators, so testers can try
              // every view; existing accounts keep their role.
              const account = await ensureUserAccountForEmail(db, email, profile.displayName || email, await getAdminAccountRoleId(db));
              // An administrator deactivated it (Settings).
              if (!account.active) {
                done(null, false, { message: 'This account has been deactivated.' });
                return;
              }

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
