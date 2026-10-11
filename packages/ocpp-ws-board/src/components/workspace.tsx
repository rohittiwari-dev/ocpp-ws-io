import {
  IconArrowDown,
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { downloadJson } from "@/lib/export";
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "mint" | "yellow" | "rose" | "blue" | "lavender";
}) {
  return (
    <span className={`status tone-${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
export function Empty({
  title = "Nothing here yet",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <IconSearch size={28} stroke={1.4} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Feedback({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  if (error)
    return (
      <div className="error-banner" role="alert">
        <span>{error}</span>
        <button className="button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  return loading ? (
    <div className="loading-state" role="status">
      Loading workspace...
    </div>
  ) : null;
}
export function Search({
  value,
  onChange,
  placeholder = "Search...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-field">
      <IconSearch size={18} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
export function Refresh({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="button icon-button"
      title="Refresh data"
      aria-label="Refresh data"
      onClick={onClick}
    >
      <IconRefresh size={18} />
    </button>
  );
}
export function Export<T>({ data, name }: { data: T; name: string }) {
  return (
    <button className="button" onClick={() => downloadJson(name, data)}>
      <IconArrowDown size={17} />
      Export JSON
    </button>
  );
}
export function Pagination({
  page,
  count,
  size = 12,
  onChange,
}: {
  page: number;
  count: number;
  size?: number;
  onChange: (page: number) => void;
}) {
  const total = Math.max(1, Math.ceil(count / size));
  return (
    <div className="table-footer">
      <span>
        {count
          ? `${page * size + 1}-${Math.min((page + 1) * size, count)} of ${count}`
          : "0 results"}
      </span>
      <div>
        <button
          className="button icon-button"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
        >
          <IconChevronLeft size={17} />
        </button>
        <span>
          {page + 1} of {total}
        </span>
        <button
          className="button icon-button"
          aria-label="Next page"
          disabled={page + 1 >= total}
          onClick={() => onChange(page + 1)}
        >
          <IconChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
export function JsonView({
  value,
}: {
  value: object | string | number | boolean | null;
}) {
  return <pre className="json-view">{JSON.stringify(value, null, 2)}</pre>;
}
