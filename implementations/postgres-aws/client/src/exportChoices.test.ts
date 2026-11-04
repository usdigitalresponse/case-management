import { describe, expect, it } from 'vitest';
import { parseExportChoices } from './exportChoices';

describe('parseExportChoices', () => {
  it('starts with a full PDF', () => {
    expect(parseExportChoices(null)).toEqual({ format: 'pdf', omit: [] });
    expect(parseExportChoices('not json')).toEqual({ format: 'pdf', omit: [] });
  });

  it('keeps saved choices and drops fields an export no longer has', () => {
    const saved = JSON.stringify({ format: 'xlsx', omit: ['lines:Description', 'lines:Retired column', 7] });
    expect(parseExportChoices(saved)).toEqual({ format: 'xlsx', omit: ['lines:Description'] });
  });
});
