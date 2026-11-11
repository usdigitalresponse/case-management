import type { ReactElement, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { AuthProvider, useAuth } from '../AuthContext';
import { queryClient } from '../queryClient';

// jsdom has no modal dialogs; Dialog opens with showModal.
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.open = false;
};

// Nor ResizeObserver, which the file viewer uses to fit its page.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function SignedIn({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  return loading ? null : <>{children}</>;
}

// Where a page sent the user, shown in place of pages these tests don't render.
function Elsewhere() {
  const { pathname } = useLocation();
  return <p data-testid="elsewhere">{pathname}</p>;
}

// One page at its route, as the signed-in user from the fake API's
// GET /auth/me; anywhere it navigates to is shown by its path.
export async function renderPage(element: ReactElement, { path, url }: { path: string; url: string }) {
  const router = createMemoryRouter(
    [
      { path, element },
      { path: '*', element: <Elsewhere /> },
    ],
    { initialEntries: [url] },
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SignedIn>
          <RouterProvider router={router} />
        </SignedIn>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, router, elsewhere: () => screen.queryByTestId('elsewhere')?.textContent ?? null };
}
