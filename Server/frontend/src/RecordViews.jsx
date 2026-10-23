import React, { useState } from "react";
import { useLanguage, fieldText } from "./i18n";
import {
  DataTable,
  DetailDrawer,
  TechnicalDetails,
  StatusBadge,
} from "./ui.jsx";

export function RecordBrowser({ rows, kind }) {
  const lang = useLanguage(),
    text = (vi, en) => (lang === "en" ? en : vi);
  const [selected, setSelected] = useState(null),
    [filters, setFilters] = useState({});
  const columns =
    kind === "transactions"
      ? [
          "created_at",
          "kind",
          "product",
          "quantity",
          "location",
          "source_type",
          "actor",
          "result",
        ]
      : [
          "created_at",
          "actor",
          "action",
          "resource",
          "object",
          "source_type",
          "result",
        ];
  const labels = {
    created_at: text("Thời gian", "Time"),
    kind: text("Nghiệp vụ", "Transaction"),
    product: text("Sản phẩm", "Product"),
    quantity: text("Số lượng", "Quantity"),
    location: text("Vị trí", "Location"),
    actor: text("Người thực hiện", "Actor"),
    resource: text("Module", "Module"),
    object: text("Đối tượng", "Object"),
    source_type: text("Nguồn", "Source"),
    action: text("Hành động", "Action"),
    result: text("Kết quả", "Result"),
  };
  const value = (row, key) =>
    ["source_type", "result"].includes(key) ? (
      <StatusBadge value={row[key]} />
    ) : key === "created_at" ? (
      new Date(row[key]).toLocaleString()
    ) : (
      (row[key] ?? "—")
    );
  const filterKeys =
    kind === "transactions"
      ? ["kind", "product", "actor", "location", "result"]
      : ["actor", "resource", "action", "result"];
  const visible = rows.filter((row) =>
    Object.entries(filters).every(
      ([key, val]) =>
        !val ||
        (key === "from"
          ? new Date(row.created_at) >= new Date(val)
          : key === "to"
            ? new Date(row.created_at) <= new Date(val)
            : String(row[key]) === val),
    ),
  );
  return (
    <>
      <div className="filter-bar record-filters">
        {filterKeys.map((key) => (
          <label key={key}>
            {labels[key]}
            <select
              value={filters[key] || ""}
              onChange={(event) =>
                setFilters({ ...filters, [key]: event.target.value })
              }
            >
              <option value="">{text("Tất cả", "All")}</option>
              {[...new Set(rows.map((row) => row[key]).filter(Boolean))].map(
                (val) => (
                  <option key={val} value={val}>
                    {val}
                  </option>
                ),
              )}
            </select>
          </label>
        ))}
        {["from", "to"].map((key) => (
          <label key={key}>
            {key === "from" ? text("Từ", "From") : text("Đến", "To")}
            <input
              type="datetime-local"
              value={filters[key] || ""}
              onChange={(event) =>
                setFilters({ ...filters, [key]: event.target.value })
              }
            />
          </label>
        ))}
        <button className="secondary" onClick={() => setFilters({})}>
          {text("Xóa lọc", "Clear filters")}
        </button>
      </div>
      <DataTable
        rows={visible}
        columns={columns}
        columnLabels={labels}
        renderValue={(val) => (val == null ? "—" : String(val))}
        onSelect={setSelected}
        actions={(row) => (
          <button className="link" onClick={() => setSelected(row)}>
            {text("Chi tiết", "Details")}
          </button>
        )}
      />
      {selected && (
        <DetailDrawer
          title={
            kind === "transactions"
              ? text("Chi tiết giao dịch", "Transaction details")
              : text("Hoạt động", "Activity")
          }
          onClose={() => setSelected(null)}
        >
          <dl>
            {columns.map((key) => (
              <div key={key}>
                <dt>{labels[key] || fieldText(key)}</dt>
                <dd>{value(selected, key)}</dd>
              </div>
            ))}
          </dl>
          {selected.note && <p>{selected.note}</p>}
          <TechnicalDetails>
            <pre>{JSON.stringify(selected, null, 2)}</pre>
          </TechnicalDetails>
        </DetailDrawer>
      )}
    </>
  );
}

export function SettingsPanel({ data, submit }) {
  const lang = useLanguage(),
    text = (vi, en) => (lang === "en" ? en : vi);
  const groups = [
    ["general", "Chung", "General"],
    ["inventory", "Kho hàng", "Inventory"],
    ["devices", "Thiết bị", "Devices"],
    ["environment", "Môi trường", "Environment"],
    ["alerts", "Cảnh báo", "Alerts"],
    ["sync", "Đồng bộ", "Sync"],
    ["technical", "Kết nối kỹ thuật", "Technical connections"],
  ];
  const [tab, setTab] = useState("environment"),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState({}),
    [error, setError] = useState("");
  const classify = (key) =>
    /temperature|humidity|smoke/.test(key)
      ? "environment"
      : /mqtt|serial|heartbeat|timeout/.test(key)
        ? "technical"
        : /sync|retry/.test(key)
          ? "sync"
          : /stock|inventory/.test(key)
            ? "inventory"
            : /alarm|notification|severity/.test(key)
              ? "alerts"
              : /cabinet|rack|device/.test(key)
                ? "devices"
                : "general";
  const entries = Object.entries(data).filter(([key]) => classify(key) === tab);
  return (
    <>
      <div className="settings-tabs" role="tablist">
        {groups.map(([key, vi, en]) => (
          <button
            className={tab === key ? "active" : "secondary"}
            role="tab"
            aria-selected={tab === key}
            key={key}
            onClick={() => {
              setTab(key);
              setError("");
            }}
          >
            {text(vi, en)}
          </button>
        ))}
      </div>
      {!entries.length ? (
        <p className="empty">
          {text(
            "Chưa có cấu hình được Server cung cấp trong nhóm này.",
            "No settings are supplied by the server for this group.",
          )}
        </p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              for (const [key] of entries)
                if (
                  draft[key] !== undefined &&
                  Number(draft[key]) !== Number(data[key])
                )
                  await submit({ key, value: Number(draft[key]) });
              setDraft({});
            } catch {
              setError(
                text(
                  "Không thể lưu cấu hình. Hãy kiểm tra giá trị và thử lại.",
                  "Could not save settings. Check values and try again.",
                ),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="settings-fields">
            {entries.map(([key, val]) => {
              const editable = ["temperature_max", "humidity_max"].includes(
                key,
              );
              return (
                <label key={key}>
                  {fieldText(key)}
                  {editable ? (
                    <input
                      type="number"
                      min="0"
                      max={key === "humidity_max" ? 100 : 200}
                      step="any"
                      required
                      value={draft[key] ?? val}
                      onChange={(event) =>
                        setDraft({ ...draft, [key]: event.target.value })
                      }
                    />
                  ) : (
                    <span>{String(val)}</span>
                  )}
                </label>
              );
            })}
          </div>
          {tab === "environment" && (
            <p className="muted">
              {text(
                "Ngưỡng áp dụng từ mẫu telemetry tiếp theo.",
                "Thresholds apply to the next telemetry sample.",
              )}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {entries.some(([key]) =>
            ["temperature_max", "humidity_max"].includes(key),
          ) && (
            <div className="actions">
              <button disabled={busy}>{text("Lưu", "Save")}</button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setDraft({})}
              >
                {text("Khôi phục", "Reset")}
              </button>
            </div>
          )}
        </form>
      )}
    </>
  );
}
