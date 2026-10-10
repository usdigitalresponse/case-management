// Suggests which professional a supplier's timekeeper name means, only when
// exactly one candidate fits.

export interface TimekeeperCandidate {
  professionalId: string;
  displayName: string | null;
}

// "Jane Q. Smith" -> ["jane", "q", "smith"]
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// As written and, with one comma, as "Last, First": both, because a comma
// can be part of a name ("Smith, Jones and Lee").
function nameForms(name: string): string[][] {
  const parts = name.split(',');
  const forms = [nameTokens(name)];
  if (parts.length === 2) {
    forms.push(nameTokens(`${parts[1]} ${parts[0]}`));
  }
  return forms.filter((tokens) => tokens.length > 0);
}

function only<T>(matches: T[]): T | undefined {
  return matches.length === 1 ? matches[0] : undefined;
}

// "J. Q. Smith" matches "Jane Q Smith".
function initialsMatch(wanted: string[], tokens: string[]): boolean {
  const given = wanted.slice(0, -1);
  return (
    given.length > 0 &&
    given.every((token) => token.length === 1) &&
    tokens.length === wanted.length &&
    tokens[tokens.length - 1] === wanted[wanted.length - 1] &&
    given.every((initial, index) => tokens[index]?.startsWith(initial))
  );
}

export function matchTimekeeperName(label: string, candidates: TimekeeperCandidate[]): string | undefined {
  const wantedForms = nameForms(label);
  if (wantedForms.length === 0) {
    return undefined;
  }
  const named = candidates.flatMap((candidate) =>
    candidate.displayName ? [{ id: candidate.professionalId, forms: nameForms(candidate.displayName) }] : [],
  );
  const fits = (test: (wanted: string[], tokens: string[]) => boolean) =>
    only(named.filter(({ forms }) => wantedForms.some((wanted) => forms.some((tokens) => test(wanted, tokens)))));

  const exact = fits((wanted, tokens) => wanted.join(' ') === tokens.join(' '));
  return exact?.id ?? fits(initialsMatch)?.id;
}
