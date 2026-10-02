// Individual email addresses allowed to use the external (magic-link)
// submission flow, configured locally via EXTERNAL_EMAIL_WHITELIST in .env
// (gitignored) — see .env.example. Checked by POST /auth/magic-link/request
// (../routes/auth.ts) before a token is ever issued.
import { parseCommaSeparatedList } from './emailLists';

const EXTERNAL_EMAIL_WHITELIST = parseCommaSeparatedList(process.env.EXTERNAL_EMAIL_WHITELIST);

export function isWhitelistedExternalEmail(email: string): boolean {
  return EXTERNAL_EMAIL_WHITELIST.includes(email.trim().toLowerCase());
}
