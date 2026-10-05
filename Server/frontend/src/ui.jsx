import { t as uiText, errorText, statusText, useLanguage, fieldText } from './i18n';
import React, { useState, useRef, useEffect } from "react";

export function Icon({ name = "grid" }) {
  const paths = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    box: "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
    device: "M4 3h16v14H4z M8 21h8 M12 17v4",
    activity: "M2 12h5l3-8 4 16 3-8h5",
    users:
      "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 8 M19 15a6 6 0 0 1 3 6",
    list: "M8 5h13 M8 12h13 M8 19h13 M3 5h1 M3 12h1 M3 19h1",
    settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
    collapse: "M9 4H3v16h6 M21 12H11 M15 8l-4 4 4 4",
  };
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.grid} />
    </svg>
  );
}
export function StatusBadge({ value }) {
  useLanguage();
  if (value === null || value === undefined || value === "")
    return <span className="muted">—</span>;
  const text = String(value);
  return (
    <span className={"inv-chip " + text.toLowerCase().replaceAll(" ", "-")}>
      {statusText(text)}
    </span>
  );
}
export function SourceBadge({ source }) {
  useLanguage();
  return source ? <StatusBadge value={source} /> : null;
}
export function EmptyState({
  children = "Không có dữ liệu phù hợp với bộ lọc.",
}) {
  useLanguage();
  return <div className="empty">{uiText(children)}</div>;
}
export function LoadingState({ children = "Đang tải…" }) {
  useLanguage();
  return (
    <div className="loading-state" role="status">
      <span className="status-dot" />
      {uiText(children)}
    </div>
  );
}
export function ErrorState({ children, retry }) {
  useLanguage();
  return (
    <div className="error" role="alert">
      {uiText(children)}
      {retry && (
        <button className="secondary" onClick={retry}> {uiText("Thử lại")} </button>
      )}
    </div>
  );
}
export function KpiCard({ label, value }) {
  useLanguage();
  return (
    <article>
      <span>{uiText(label)}</span>
      <strong>{uiText(value)}</strong>
    </article>
  );
}
export function PageHeader({ title, children }) {
  useLanguage();
  return (
    <header className="page-header">
      <h1>{uiText(title)}</h1>
      {children}
    </header>
  );
}
export function SearchBar({
  value,
  onChange,
  placeholder = "Tìm trong bảng…",
}) {
  useLanguage();
  return (
    <input
      type="search"
      aria-label={uiText("Tìm trong bảng")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={uiText(placeholder)}
    />
  );
}
export function FilterBar({ children }) {
  return <div className="filter-bar">{children}</div>;
}
export function ConfirmDialog({ message, onCancel, onConfirm }) {
  useLanguage();
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby="confirm-title"
      onCancel={onCancel}
    >
      <h2 id="confirm-title">{uiText("Xác nhận thao tác")}</h2>
      <p>{uiText(message)}</p>
      <div className="actions">
        <button className="secondary" onClick={onCancel} autoFocus> {uiText("Hủy")} </button>
        <button onClick={onConfirm}>{uiText("Xác nhận")}</button>
      </div>
    </dialog>
  );
}
export function ConfirmButton({ message, onClick, children, ...props }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button {...props} onClick={() => setOpen(true)}>
        {uiText(children)}
      </button>
      {open && (
        <ConfirmDialog
          message={uiText(message)}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            if (!props.disabled) onClick();
          }}
        />
      )}
    </>
  );
}
export function Pagination({ page, total, size, onChange }) {
  useLanguage();
  const count = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        {total} {uiText("kết quả · Trang")} {page + 1}/{count}
      </span>
      <div>
        <button
          className="secondary"
          disabled={!page}
          onClick={() => onChange(page - 1)}
        > {uiText("Trước")} </button>
        <button
          className="secondary"
          disabled={page + 1 >= count}
          onClick={() => onChange(page + 1)}
        > {uiText("Sau")} </button>
      </div>
    </div>
  );
}
export function DataTable({
  rows = [],
  columns,
  onSelect,
  actions,
  renderValue,
}) {
  useLanguage();
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState(null),
    [page, setPage] = useState(0);
  const size = 20;
  const filtered = rows.filter((r) =>
    columns.some((c) =>
      JSON.stringify(r[c] ?? "")
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    ),
  );
  const sorted = sort
    ? [...filtered].sort((a, b) => {
        const av = a[sort.key],
          bv = b[sort.key];
        const order =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
                numeric: true,
              });
        return order * sort.direction;
      })
    : filtered;
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(sorted.length / size) - 1),
  );
  const label = (c) => fieldText(c);
  const value = (r, c) => {
    if (['error', 'error_message', 'sync_error', 'message'].includes(c) && r[c]) return errorText(r[c]);
    if (c === "source_type") return <SourceBadge source={r[c]} />;
    if (
      ["online", "mqtt_connected", "serial_connected", "synchronized"].includes(
        c,
      ) &&
      typeof r[c] === "boolean"
    )
      return (
        <StatusBadge
          value={
            r[c]
              ? c === "synchronized"
                ? "Synced"
                : c === "online"
                  ? "Online"
                  : "Connected"
              : c === "synchronized"
                ? "Pending"
                : c === "online"
                  ? "Offline"
                  : "Disconnected"
          }
        />
      );
    if (
      ["state", "status", "severity", "result", "kind", "execution_state", "operation_status", "sync_status"].includes(c) &&
      typeof r[c] === "string"
    )
      return <StatusBadge value={r[c]} />;
    if (r[c] && typeof r[c] === "object")
      return (
        <details className="raw-detail">
          <summary>{uiText("Chi tiết")}</summary>
          {renderValue(r[c])}
        </details>
      );
    if (
      (c.startsWith("last_") || c.endsWith("_at")) &&
      r[c] &&
      !Number.isNaN(Date.parse(r[c]))
    )
      return (
        <time dateTime={r[c]} title={r[c]}>
          {new Date(r[c]).toLocaleString()}
        </time>
      );
    return renderValue(r[c]);
  };
  return (
    <div className="data-table">
      <FilterBar>
        <SearchBar
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(0);
          }}
        />
        <span className="muted">{filtered.length} {uiText("kết quả")}</span>
      </FilterBar>
      {sorted.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c}
                    aria-sort={
                      sort?.key === c
                        ? sort.direction === 1
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      className="sort-button"
                      onClick={() => {
                        setSort({
                          key: c,
                          direction: sort?.key === c ? -sort.direction : 1,
                        });
                        setPage(0);
                      }}
                    >
                      {uiText(label(c))}{" "}
                      <span aria-hidden="true">
                        {sort?.key === c ? sort.direction === 1 ? "↑" : "↓" : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
                {actions && <th>{uiText("Actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {sorted
                .slice(current * size, (current + 1) * size)
                .map((r, i) => (
                  <tr key={r.id ?? i}>
                    {columns.map((c) => (
                      <td key={c} className={typeof r[c] === "number" ? "numeric-cell" : undefined}>
                        {c === columns[0] && onSelect ? (
                          <button className="link" onClick={() => onSelect(r)}>
                            {value(r, c)}
                          </button>
                        ) : (
                          value(r, c)
                        )}
                      </td>
                    ))}
                    {actions && (
                      <td>
                        <details className="row-menu">
                          <summary aria-label={uiText("Thao tác")}>⋮</summary>
                          <div className="actions">{actions(r)}</div>
                        </details>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState />
      )}
      {filtered.length > size && (
        <Pagination
          page={current}
          total={filtered.length}
          size={size}
          onChange={setPage}
        />
      )}
    </div>
  );
}
