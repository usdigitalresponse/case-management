// Finds the case or person a file names, for a suggestion the uploader
// confirms. Exact matches (ignoring punctuation, accents, case and name
// order) win; looser ones are tried only when there are none.

export interface MatchKeys {
  references: string[];
  name: string;
}

const SUFFIX = /^(jr|sr|ii|iii|iv)$/;

export function normalize(text: string, lowerCase = true): string {
  const plain = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return (lowerCase ? plain.toLowerCase() : plain).replace(/[^a-zA-Z0-9]+/g, ' ').trim();
}

export function matchKeys(name: string | null, references: Array<string | null>): MatchKeys {
  const words = normalize(name ?? '').split(' ');
  while (words.length > 2 && SUFFIX.test(words.at(-1)!)) {
    words.pop();
  }
  return {
    references: references.map((text) => normalize(text ?? '')).filter(Boolean),
    name: words.join(' '),
  };
}

// Each number, and the name either way round ("Jo Smith", "Smith, Jo").
export function exactKeys({ references, name }: MatchKeys): string[] {
  const words = name.split(' ');
  const reversed = words.length > 1 ? [words.at(-1), ...words.slice(0, -1)].join(' ') : '';
  return [...references, name, reversed].filter(Boolean);
}

// Within longer text, short keys and short all-digit numbers turn up by
// chance in dates and amounts.
function distinctive(key: string): boolean {
  return key.length >= 4 && (/[a-z]/.test(key) || key.replace(/ /g, '').length >= 6);
}

// Equal, or one letter added, dropped, changed or swapped in a long word.
function close(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) {
    return false;
  }
  let at = 0;
  while (a[at] === b[at]) {
    at += 1;
  }
  if (a.length === b.length) {
    return a.slice(at + 1) === b.slice(at + 1) || (a[at] === b[at + 1] && a[at + 1] === b[at] && a.slice(at + 2) === b.slice(at + 2));
  }
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  return longer.slice(at + 1) === shorter.slice(at);
}

// `written` keeps capitals, so an initial ("J. Sample") isn't confused with
// "a" or a possessive's "s".
function looselyHolds(written: string[], { references, name }: MatchKeys): boolean {
  const words = written.map((word) => word.toLowerCase());
  // A number without its separators ("CR0001" for "CR-0001").
  const compactReferences = references
    .map((reference) => reference.replace(/ /g, ''))
    .filter((reference) => reference.length >= 4 && /\d/.test(reference) && /[a-z]/.test(reference));
  for (let start = 0; start < words.length; start += 1) {
    let joined = '';
    for (let end = start; end < Math.min(words.length, start + 4); end += 1) {
      joined += words[end];
      if (compactReferences.includes(joined)) {
        return true;
      }
    }
  }
  // Given and family name either way round, up to one word apart; the given
  // name may be its initial.
  const parts = name.split(' ');
  const given = parts[0]!;
  const family = parts.at(-1)!;
  if (parts.length < 2 || family.length < 3) {
    return false;
  }
  const isGiven = (index: number) => {
    const word = words[index];
    return word !== undefined && (close(word, given) || (word.length === 1 && word === given[0] && written[index] !== word));
  };
  return words.some((word, index) => close(word, family) && [index - 1, index - 2, index + 1, index + 2].some(isGiven));
}

// A text that is exactly a key matches whatever its length.
export function namedIn<T>(text: string | null | undefined, rows: T[], keysOf: (row: T) => MatchKeys): T[] {
  const whole = normalize(text ?? '');
  if (!whole) {
    return [];
  }
  const padded = ` ${whole} `;
  const exact = rows.filter((row) =>
    exactKeys(keysOf(row)).some((key) => key === whole || (distinctive(key) && padded.includes(` ${key} `))),
  );
  if (exact.length > 0) {
    return exact;
  }
  const written = normalize(text ?? '', false).split(' ');
  return rows.filter((row) => looselyHolds(written, keysOf(row)));
}
