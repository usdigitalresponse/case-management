// Shared parsing for comma-separated allowlists configured via env vars
// (GOOGLE_ALLOWED_DOMAINS, MICROSOFT_ALLOWED_DOMAINS, EXTERNAL_EMAIL_WHITELIST
// — see .env.example).
export function parseCommaSeparatedList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}
