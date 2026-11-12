// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Tabs } from './Tabs';

afterEach(cleanup);

const tabs = [
  { id: 'open', label: 'Waiting', count: 3 },
  { id: 'approved', label: 'Approved', count: 0 },
  { id: 'all', label: 'All', count: 5 },
] as const;

describe('tabs', () => {
  it('keeps only the selected tab in the Tab order and reads its count with its name', () => {
    render(<Tabs label="Requests by status" tabs={[...tabs]} selected="open" onSelect={() => {}} />);
    expect(screen.getByRole('tablist', { name: 'Requests by status' })).toBeTruthy();
    const selected = screen.getByRole('tab', { name: 'Waiting, 3' });
    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(selected.tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Approved, 0' }).tabIndex).toBe(-1);
  });

  it('moves with the arrow keys, Home and End, wrapping at the ends', () => {
    const onSelect = vi.fn();
    render(<Tabs label="Show" tabs={[...tabs]} selected="open" onSelect={onSelect} />);
    const first = screen.getByRole('tab', { name: 'Waiting, 3' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    fireEvent.keyDown(first, { key: 'End' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'All, 5' }), { key: 'Home' });
    expect(onSelect.mock.calls.map(([id]) => id as string)).toEqual(['approved', 'all', 'all', 'open']);
    expect(document.activeElement).toBe(first);
  });
});
