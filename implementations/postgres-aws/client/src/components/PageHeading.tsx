// A title with an eyebrow above it, for pages without a breadcrumb.
export function PageHeading({
  eyebrow,
  title,
  description,
  list = false,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  // A list or queue page: its title is Headline/Medium (26px), not Headline/Large.
  list?: boolean;
}) {
  return (
    <div className="page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className={list ? 'page-title--list' : undefined}>{title}</h1>
      {description && <p className="page-description">{description}</p>}
    </div>
  );
}
