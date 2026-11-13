import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useResource } from '../hooks/useResource';
import { authProviders } from '../resources';
import { SyntheticDataNote } from './SyntheticDataNote';

export const PRODUCT_NAME = 'Invoice Review';

// The product's name, after the organization's when set (design I1); also the tab's title.
export function useProductName(): string {
  const { data } = useResource(authProviders);
  const name = data?.organizationName ? `${data.organizationName} ${PRODUCT_NAME}` : PRODUCT_NAME;
  useEffect(() => {
    document.title = name;
  }, [name]);
  return name;
}

// Organization, divider, section; with no organization, the product leads and isn't repeated.
export function AppBrand({ to, section, children }: { to: string; section: string; children?: ReactNode }) {
  const { data } = useResource(authProviders);
  useProductName();
  const organization = data?.organizationName ?? null;
  const shownSection = organization || section !== PRODUCT_NAME ? section : null;
  return (
    <div className="app-brand-block">
      <div className="app-brand-row">
        <Link className="app-brand" to={to}>{organization ?? PRODUCT_NAME}</Link>
        {shownSection && <span className="app-section">{shownSection}</span>}
        {children}
      </div>
      <SyntheticDataNote className="app-synthetic-note" />
    </div>
  );
}
