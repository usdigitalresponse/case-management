// Email normalization, and the comma-separated domain lists in env vars (.env.example).

// Every email stored or compared goes through this, so one address matches across sign-in paths.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseCommaSeparatedList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(normalizeEmail)
    .filter((entry) => entry.length > 0);
}
