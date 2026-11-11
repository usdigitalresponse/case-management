import type { ComponentType } from 'react';

type PageModule<P> = Promise<{ default: ComponentType<P> }>;

// A route's page code loads when the route is first opened.
export function page(load: () => PageModule<object>) {
  return { lazy: async () => ({ Component: (await load()).default }) };
}

export function pageWith<P extends object>(load: () => PageModule<P>, props: P) {
  return {
    lazy: async () => {
      const { default: Page } = await load();
      return { element: <Page {...props} /> };
    },
  };
}
