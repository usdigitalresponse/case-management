import { describe, expect, it } from 'vitest';
import { formatLineRate, formatQuantity, lineKindLabel } from './invoiceLineDisplay';

describe('line cells shared by every invoice table', () => {
  it('names a line by its kind, trip and time category', () => {
    expect(lineKindLabel('time')).toBe('Time');
    expect(lineKindLabel('time', { onTrip: true })).toBe('Travel time');
    expect(lineKindLabel('expense', { onTrip: true })).toBe('Travel expense');
    expect(lineKindLabel('mileage', { onTrip: true })).toBe('Mileage');
    expect(lineKindLabel('time', { waiting: true })).toBe('Waiting time');
  });

  it('shows quantities and rates with their units', () => {
    expect(formatQuantity('time', 1.7)).toBe('1.70 hours');
    expect(formatQuantity('mileage', 64)).toBe('64 miles');
    expect(formatQuantity('other', null)).toBe('—');
    expect(formatLineRate('time', '150')).toBe('$150.00');
    expect(formatLineRate('mileage', 0.725)).toBe('$0.725 a mile');
    expect(formatLineRate('time', null)).toBe('—');
  });
});
