import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useResource } from '../hooks/useResource';
import { authProviders } from '../resources';

export const PRODUCT_NAME = 'Invoice Review';

// As in the design: the organization's name, a divider and the section; with no
// organization set, the product's name leads and a section repeating it is left out.
export function AppBrand({ to, section, children }: { to: string; section: string; children?: ReactNode }) {
  const { data } = useResource(authProviders);
  const organization = data?.organizationName ?? null;
  const shownSection = organization || section !== PRODUCT_NAME ? section : null;
  return (
    <div className="app-brand-block">
      <Link className="app-brand" to={to}>{organization ?? PRODUCT_NAME}</Link>
      {shownSection && <span className="app-section">{shownSection}</span>}
      {children}
    </div>
  );
}
