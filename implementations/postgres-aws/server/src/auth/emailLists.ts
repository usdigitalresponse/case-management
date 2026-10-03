// Email address normalization and shared parsing for comma-separated
// allowlists configured via env vars (GOOGLE_ALLOWED_DOMAINS,
// MICROSOFT_ALLOWED_DOMAINS, EXTERNAL_EMAIL_WHITELIST — see .env.example).

// Every email stored or compared goes through this, so the same address
// from different login paths (an IdP may return mixed case) matches.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseCommaSeparatedList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(normalizeEmail)
    .filter((entry) => entry.length > 0);
}
