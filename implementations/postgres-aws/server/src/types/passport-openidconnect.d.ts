// The package ships no types; only what ../auth/oidcProviders.ts uses.
declare module 'passport-openidconnect' {
  export interface Profile {
    id?: string;
    displayName?: string;
    username?: string;
    emails?: { value: string }[];
    _json?: Record<string, unknown>;
  }

  export type VerifyCallback = (error: unknown, user?: unknown, info?: { message?: string }) => void;

  export interface StrategyOptions {
    issuer: string;
    authorizationURL: string;
    tokenURL: string;
    userInfoURL?: string;
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string | string[];
    skipUserProfile?: boolean;
  }

  export class Strategy {
    constructor(options: StrategyOptions, verify: (issuer: string, profile: Profile, done: VerifyCallback) => void);
    name: string;
    authenticate(req: unknown, options?: unknown): void;
  }
}
