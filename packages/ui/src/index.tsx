import type { ReactNode } from "react";

export type NavItem = {
  readonly id: string;
  readonly label: string;
  readonly active?: boolean;
};

export type Stat = {
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "good" | "warn";
};

export function AppFrame({
  title,
  subtitle,
  navItems,
  children,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly navItems: readonly NavItem[];
  readonly children: ReactNode;
}) {
  return (
    <div className="app-frame">
      <aside className="app-sidebar" aria-label="Primary">
        <div className="brand-mark">
          <span className="brand-sigil">M</span>
          <span>
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </span>
        </div>
        <nav className="nav-list">
          {navItems.map((item) => (
            <a
              aria-current={item.active ? "page" : undefined}
              className={item.active ? "nav-item active" : "nav-item"}
              href={`#${item.id}`}
              key={item.id}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
  );
}

export function StatGrid({ stats }: { readonly stats: readonly Stat[] }) {
  return (
    <section className="stat-grid" aria-label="System status">
      {stats.map((stat) => (
        <div className={`stat ${stat.tone ?? "neutral"}`} key={stat.label}>
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
        </div>
      ))}
    </section>
  );
}

export function SurfaceCard({
  title,
  meta,
  children,
}: {
  readonly title: string;
  readonly meta?: string;
  readonly children: ReactNode;
}) {
  return (
    <article className="surface-card">
      <header>
        <h2>{title}</h2>
        {meta ? <span>{meta}</span> : null}
      </header>
      {children}
    </article>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "good" | "warn";
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function IconButton({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className="icon-button"
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
