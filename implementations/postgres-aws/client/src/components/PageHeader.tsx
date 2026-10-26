import { Fragment, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';

export interface Crumb {
  label: ReactNode;
  to?: string;
}

// Every page's top: breadcrumb, title with an optional status, a line of
// key facts or a description, and the page's actions on the right.
export function PageHeader({
  crumbs,
  title,
  status,
  meta,
  description,
  actions,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      {crumbs && (
        <nav className="breadcrumb" aria-label="Breadcrumb">
          {crumbs.map((crumb, index) => (
            <Fragment key={index}>
              {index > 0 && <span aria-hidden="true">›</span>}
              {crumb.to ? <RouterLink to={crumb.to}>{crumb.label}</RouterLink> : <span>{crumb.label}</span>}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="page-title-row">
        <div>
          <h1>
            {title}
            {status}
          </h1>
          {meta && <p className="title-meta">{meta}</p>}
          {description && <p className="page-description">{description}</p>}
        </div>
        {actions && <div className="title-actions">{actions}</div>}
      </div>
    </>
  );
}
