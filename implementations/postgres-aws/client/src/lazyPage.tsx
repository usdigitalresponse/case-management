import type { ComponentType } from 'react';

type PageModule<P> = Promise<{ default: ComponentType<P> }>;

const RELOADED_AT = 'reloadedForNewCode';

// After a redeploy a page's old code file is gone: reload once for the new ones,
// or, if that just happened, let the error show instead of reloading again.
export function reloadForNewCode(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < 10_000) return false;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

async function loadPage<M>(load: () => Promise<M>): Promise<M> {
  try {
    return await load();
  } catch (error) {
    if (reloadForNewCode()) return new Promise<M>(() => {});
    throw error;
  }
}

// A route's page code loads when the route is first opened.
export function page(load: () => PageModule<object>) {
  return { lazy: async () => ({ Component: (await loadPage(load)).default }) };
}

export function pageWith<P extends object>(load: () => PageModule<P>, props: P) {
  return {
    lazy: async () => {
      const { default: Page } = await loadPage(load);
      return { element: <Page {...props} /> };
    },
  };
}
