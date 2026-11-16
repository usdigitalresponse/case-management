// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { REVIEWER, signedIn } from '../test/fixtures';
import CaseList from './CaseList';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe('All cases', () => {
  it('sends its old Review duplicates tab to Settings', async () => {
    fakeApi({ ...signedIn(REVIEWER) });
    const page = await renderPage(<CaseList />, { path: '/cases', url: '/cases?tab=duplicates' });
    await waitFor(() => expect(page.elsewhere()).toBe('/settings'));
  });
});
