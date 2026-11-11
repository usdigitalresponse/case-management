import { Fragment, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';

export interface Crumb {
  label: ReactNode;
  to?: string;
}

export function PageHeader({
  crumbs,
  title,
  status,
  meta,
  description,
  actions,
  list = false,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  // A list or queue page: its title is Headline/Medium (26px), not Headline/Large.
  list?: boolean;
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
        <h1 className={list ? 'page-title--list' : undefined}>
          {title}
          {status}
        </h1>
        {actions && <div className="title-actions">{actions}</div>}
        {meta && <p className="title-meta">{meta}</p>}
        {description && <p className="page-description">{description}</p>}
      </div>
    </>
  );
}
