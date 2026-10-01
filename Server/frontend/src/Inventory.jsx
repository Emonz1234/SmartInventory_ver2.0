import React, { useEffect, useRef, useState } from "react";

const date = (value) => (value ? new Date(value).toLocaleString() : "—");
export function Chip({ value }) {
  return (
    <span
      className={"inv-chip " + String(value).toLowerCase().replaceAll(" ", "-")}
    >
      {value}
    </span>
  );
}
const groups = (rows, field) =>
  rows.reduce(
    (all, row) => ({ ...all, [row[field]]: [...(all[row[field]] || []), row] }),
    {},
  );

export default function Inventory({
  api,
  source,
  setSource,
  session,
  can,
  version,
  dashboard = false,
}) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const [mode, setMode] = useState("By Product"),
    [query, setQuery] = useState(""),
    [filters, setFilters] = useState({});
  const [selected, setSelected] = useState(null),
    [tab, setTab] = useState("Locations");
  const [historyRows, setHistoryRows] = useState([]),
    [historyOffset, setHistoryOffset] = useState(0),
    [historyMore, setHistoryMore] = useState(false),
    [historyBusy, setHistoryBusy] = useState(false),
    [historyError, setHistoryError] = useState("");
  const [adjust, setAdjust] = useState(null),
    [quantity, setQuantity] = useState(""),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  const dialog = useRef(null),
    opener = useRef(null),
    requestKey = useRef(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    setSelected(null);
    setAdjust(null);
    setFilters({});
    const load = () =>
      api("inventory-overview?source_type=" + source)
        .then((value) => {
          if (live) {
            setData(value);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    load();
    const timer = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [source, version, reload]);
  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [selected]);
  useEffect(() => {
    if (!selected || tab !== "Transactions") return;
    let live = true;
    setHistoryBusy(true);
    setHistoryError("");
    api(
      `inventory-overview?source_type=${selected.source_type}&item_id=${selected.id}&offset=${historyOffset}`,
    )
      .then((value) => {
        if (live) {
          setHistoryRows((old) =>
            historyOffset
              ? [...old, ...value.transactions]
              : value.transactions,
          );
          setHistoryMore(value.transactions.length === 100);
        }
      })
      .catch((e) => {
        if (live) setHistoryError(e.message);
      })
      .finally(() => {
        if (live) setHistoryBusy(false);
      });
    return () => {
      live = false;
    };
  }, [selected, tab, historyOffset]);
  const product = data?.products.find(
    (p) => p.id === selected?.id && p.source_type === selected?.source_type,
  );
  const open = (p) => {
    opener.current = document.activeElement;
    setSelected(p);
    setTab("Locations");
    setAdjust(null);
    setSaveError("");
    setHistoryRows([]);
    setHistoryOffset(0);
  };
  const close = () => {
    setSelected(null);
    setAdjust(null);
    opener.current?.focus();
  };
  const change = (field, value) =>
    setFilters((old) => ({
      ...old,
      [field]: value,
      ...(field === "ipc_id" ? { cabinet_id: "" } : {}),
    }));
  const matchesLocation = (l) =>
    (!filters.ipc_id || l.ipc_id === filters.ipc_id) &&
    (!filters.cabinet_id || String(l.cabinet_id) === filters.cabinet_id);
  const products = (data?.products || []).filter(
    (p) =>
      [p.name, p.sku, p.barcode].some((v) =>
        v.toLowerCase().includes(query.toLowerCase()),
      ) &&
      (!filters.category || p.category === filters.category) &&
      (!filters.stock_status || p.stock_status === filters.stock_status) &&
      (!filters.sync_status || p.sync_status === filters.sync_status) &&
      (!(filters.ipc_id || filters.cabinet_id) ||
        p.locations.some(matchesLocation)),
  );
  const locations = (data?.locations || []).filter(
    (l) =>
      matchesLocation(l) &&
      (!filters.sync_status || l.sync_status === filters.sync_status) &&
      ((!query && !filters.category && !filters.stock_status) ||
        l.goods.some((g) =>
          products.some(
            (p) => p.id === g.item_id && p.source_type === l.source_type,
          ),
        )),
  );
  if (error)
    return (
      <section role="alert" className="error">
        {error} <button onClick={() => setReload((v) => v + 1)}>Thử lại</button>
      </section>
    );
  if (!data) return <section role="status">Đang tải Inventory…</section>;
  if (dashboard)
    return (
      <>
        <div className="metrics inventory-metrics">
          {[
            ["Total Products", new Set(data.products.map((p) => p.id)).size],
            [
              "REAL Inventory",
              source === "SIMULATION"
                ? "Ẩn"
                : data.products
                    .filter((p) => p.source_type === "REAL")
                    .reduce((n, p) => n + p.quantity, 0),
            ],
            [
              "Simulation Inventory",
              source === "REAL"
                ? "Ẩn"
                : data.products
                    .filter((p) => p.source_type === "SIMULATION")
                    .reduce((n, p) => n + p.quantity, 0),
            ],
            [
              "Low Stock",
              data.products.filter((p) => p.stock_status === "Low Stock")
                .length,
            ],
            [
              "Out of Stock",
              data.products.filter((p) => p.stock_status === "Out of Stock")
                .length,
            ],
            ["Pending Sync", data.pending_sync],
            ["Active IPC", data.devices.filter((d) => d.online).length],
            ["Offline IPC", data.devices.filter((d) => !d.online).length],
          ].map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
        <div className="inv-dashboard">
          <section>
            <h2>Low Stock Products</h2>
            {data.products
              .filter((p) => p.stock_status === "Low Stock")
              .slice(0, 6)
              .map((p) => (
                <p key={p.id + p.source_type}>
                  {p.name} <Chip value={p.source_type} />{" "}
                  <strong>
                    {p.quantity} / min {p.min_stock}
                  </strong>
                </p>
              ))}
          </section>
          <section>
            <h2>Inventory Distribution by IPC</h2>
            {data.devices.map((d) => (
              <p key={d.id}>
                {d.id} <Chip value={d.source_type} />{" "}
                <strong>
                  {data.locations
                    .filter((l) => l.ipc_id === d.id)
                    .reduce((n, l) => n + l.quantity, 0)}
                </strong>
              </p>
            ))}
          </section>
        </div>
        <section>
          <h2>Recent PUT / PICK</h2>
          <History
            compact
            rows={data.transactions
              .filter((t) => ["PUT", "PICK"].includes(t.kind))
              .slice(0, 5)}
          />
        </section>
      </>
    );
  return (
    <div className="inventory-workspace">
      {session.grants?.["inventory.create"]?.includes("ALL") && (
        <details className="inv-catalog">
          <summary>Thêm sản phẩm vào danh mục</summary>
          <CatalogForm
            api={api}
            source={source}
            onSave={() => setReload((v) => v + 1)}
          />
        </details>
      )}
      <div className="toolbar">
        <div className="inv-tabs">
          {["By Product", "By Location"].map((v) => (
            <button
              key={v}
              className={mode === v ? "" : "secondary"}
              aria-pressed={mode === v}
              onClick={() => setMode(v)}
            >
              {v}
            </button>
          ))}
        </div>
        <label className="inv-toggle">
          <input
            type="checkbox"
            checked={source !== "REAL"}
            onChange={(e) => setSource(e.target.checked ? "ALL" : "REAL")}
          />{" "}
          Show Simulation Data
        </label>
      </div>
      <section className="inv-filter">
        <label>
          Search
          <input
            placeholder="Product Name / SKU / Barcode"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Select
          label="IPC"
          value={filters.ipc_id}
          onChange={(v) => change("ipc_id", v)}
          options={data.devices.map((d) => [d.id, d.id + " · " + d.name])}
        />
        <Select
          label="Cabinet"
          value={filters.cabinet_id}
          onChange={(v) => change("cabinet_id", v)}
          options={[
            ...new Map(
              data.locations
                .filter((l) => !filters.ipc_id || l.ipc_id === filters.ipc_id)
                .map((l) => [l.cabinet_id, [String(l.cabinet_id), l.cabinet]]),
            ).values(),
          ]}
        />
        <Select
          label="Category"
          value={filters.category}
          onChange={(v) => change("category", v)}
          options={[...new Set(data.products.map((p) => p.category))]}
        />
        <Select
          label="Stock Status"
          value={filters.stock_status}
          onChange={(v) => change("stock_status", v)}
          options={["Normal", "Low Stock", "Out of Stock"]}
        />
        <Select
          label="Sync Status"
          value={filters.sync_status}
          onChange={(v) => change("sync_status", v)}
          options={["Synced", "Pending", "Failed"]}
        />
      </section>
      <p className="muted">
        Tồn kho tách theo nguồn. Tổng của sản phẩm bao gồm mọi vị trí trong
        nguồn đã chọn; bộ lọc IPC/Cabinet giúp tìm nơi chứa hàng. Available loại
        trừ vị trí BUSY / FAULT.
      </p>
      {mode === "By Product" ? (
        <section>
          <div className="inv-product-head">
            <span>Product / SKU / Category</span>
            <span>Total / Available</span>
            <span>Locations / Source</span>
            <span>Stock / Sync</span>
            <span>Last Updated / Action</span>
          </div>
          {products.map((p) => (
            <article
              className="inv-product-row"
              key={p.id + p.source_type}
              data-testid={"product-" + p.sku + "-" + p.source_type}
            >
              <div>
                <button className="link" onClick={() => open(p)}>
                  {p.name}
                </button>
                <small>
                  {p.sku} · {p.category}
                </small>
              </div>
              <div>
                <strong>{p.quantity}</strong> {p.unit}
                <small>Available: {p.available_quantity}</small>
              </div>
              <div>
                <strong>{p.locations.length} locations</strong>
                <small>
                  <Chip value={p.source_type} />
                </small>
              </div>
              <div>
                <Chip value={p.stock_status} />
                <small>
                  <Chip value={p.sync_status} />
                </small>
              </div>
              <div>
                <small>{date(p.last_updated)}</small>
                <button className="link" onClick={() => open(p)}>
                  Chi tiết →
                </button>
              </div>
            </article>
          ))}
          {!products.length && (
            <p className="empty">Không có sản phẩm phù hợp. Hãy đổi bộ lọc.</p>
          )}
        </section>
      ) : (
        <section className="inv-tree">
          {Object.entries(groups(locations, "ipc_id")).map(([ipc, ls]) => (
            <details key={ipc} open>
              <summary>
                {ipc} <Chip value={ls[0].source_type} />
              </summary>
              {Object.entries(groups(ls, "cabinet")).map(([cabinet, rs]) => (
                <details key={cabinet} open>
                  <summary>{cabinet}</summary>
                  {Object.entries(groups(rs, "rack_id")).map(([rack, bins]) => (
                    <details key={rack} open>
                      <summary>Rack {bins[0].rack}</summary>
                      {bins.map((l) => (
                        <div className="inv-location" key={l.id}>
                          <div>
                            <strong>{l.location_code}</strong>{" "}
                            <Chip value={l.status} />{" "}
                            <Chip value={l.sync_status} />
                            <small>
                              Capacity: {l.quantity} / {l.capacity || "—"}
                            </small>
                          </div>
                          {l.goods
                            .filter((g) =>
                              products.some(
                                (p) =>
                                  p.id === g.item_id &&
                                  p.source_type === l.source_type,
                              ),
                            )
                            .map((g) => (
                              <button
                                className="link"
                                key={g.item_id}
                                onClick={() =>
                                  open(
                                    data.products.find(
                                      (p) =>
                                        p.id === g.item_id &&
                                        p.source_type === l.source_type,
                                    ),
                                  )
                                }
                              >
                                {g.name} × {g.quantity}
                              </button>
                            ))}
                          {!l.goods.length && (
                            <span className="muted">Rack trống</span>
                          )}
                        </div>
                      ))}
                    </details>
                  ))}
                </details>
              ))}
            </details>
          ))}
          {!locations.length && (
            <p className="empty">Không có vị trí phù hợp.</p>
          )}
        </section>
      )}
      {product && (
        <dialog
          ref={dialog}
          className="inv-drawer"
          onCancel={close}
          onClose={close}
        >
          <div className="toolbar">
            <div>
              <h2>{product.name}</h2>
              <Chip value={product.source_type} />
            </div>
            <button
              className="secondary"
              onClick={close}
              aria-label="Đóng chi tiết"
            >
              Đóng ×
            </button>
          </div>
          <dl className="inv-overview">
            {Object.entries({
              SKU: product.sku,
              Barcode: product.barcode || "—",
              Category: product.category,
              Unit: product.unit,
              "Total Quantity": product.quantity,
              "Available Quantity": product.available_quantity,
              "Min Stock": product.min_stock,
              "Max Stock": product.max_stock || "—",
            }).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <Chip value={product.stock_status} />
          {session.grants?.["inventory.update"]?.includes("ALL") && (
            <details className="inv-catalog">
              <summary>Cập nhật thông tin sản phẩm</summary>
              <CatalogForm
                key={product.id}
                api={api}
                source={source}
                product={product}
                onSave={async () =>
                  setData(await api("inventory-overview?source_type=" + source))
                }
              />
            </details>
          )}
          <div className="inv-tabs">
            {["Locations", "Transactions"].map((t) => (
              <button
                key={t}
                className={tab === t ? "" : "secondary"}
                onClick={() => {
                  setTab(t);
                  setHistoryOffset(0);
                }}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "Locations" ? (
            product.locations.map((l) => (
              <article className="inv-location" key={l.id}>
                <strong>{l.path}</strong>
                <small>
                  {l.shelf} / {l.location_code}
                </small>
                <div>
                  <Chip value={l.source_type} /> <Chip value={l.status} />{" "}
                  <Chip value={l.sync_status} />
                </div>
                <p>
                  Quantity: <b>{l.quantity}</b> · Available:{" "}
                  {l.available_quantity} · Capacity: {l.occupied_quantity} /{" "}
                  {l.capacity || "—"}
                </p>
                <small>Last Updated: {date(l.last_updated)}</small>
                {can("inventory.move", l.source_type) && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setAdjust({
                        ...l,
                        reviewed_at: new Date().toISOString(),
                      });
                      setQuantity(String(l.quantity));
                      setReason("");
                      setSaveError("");
                      requestKey.current = crypto.randomUUID();
                    }}
                  >
                    Inventory Adjustment
                  </button>
                )}
              </article>
            ))
          ) : (
            <>
              <p className="muted">
                Sync Status phản ánh xác nhận dataset hiện tại của IPC; Failed
                là giao dịch offline cần đối soát.
              </p>
              {historyBusy && <p role="status">Đang tải giao dịch…</p>}
              {historyError && (
                <p role="alert" className="error">
                  {historyError}
                </p>
              )}
              <History rows={historyRows} />
              {historyMore && (
                <button
                  disabled={historyBusy}
                  onClick={() => setHistoryOffset((v) => v + 100)}
                >
                  Tải thêm giao dịch
                </button>
              )}
            </>
          )}
          {tab === "Locations" && !product.locations.length && (
            <p className="empty">Sản phẩm chưa có vị trí trong nguồn này.</p>
          )}
          {adjust && (
            <form
              className="inv-adjust"
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                setSaveError("");
                try {
                  await api("inventory-transactions", "POST", {
                    kind: "ADJUST",
                    item_id: product.id,
                    to_location_id: adjust.id,
                    quantity: Number(quantity),
                    expected_quantity: adjust.quantity,
                    note: reason.trim(),
                    source_type: product.source_type,
                    request_key: requestKey.current,
                  });
                  setData(
                    await api("inventory-overview?source_type=" + source),
                  );
                  setAdjust(null);
                } catch (e) {
                  setSaveError(e.message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <h3>Inventory Adjustment</h3>
              <p>{adjust.path}</p>
              <p>
                Current Quantity: <b>{adjust.quantity}</b> · Difference:{" "}
                <b>{Number(quantity) - adjust.quantity}</b>
              </p>
              <p>
                User: {session.username} · Timestamp: {date(adjust.reviewed_at)}{" "}
                (thời điểm kiểm đếm; Server lưu thời điểm xác nhận trong lịch
                sử)
              </p>
              <label>
                New Quantity
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    requestKey.current = crypto.randomUUID();
                  }}
                />
              </label>
              <label>
                Reason
                <textarea
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {saveError && (
                <p role="alert" className="error">
                  {saveError}
                </p>
              )}
              <button
                disabled={
                  saving ||
                  !reason.trim() ||
                  quantity === "" ||
                  Number(quantity) === adjust.quantity
                }
              >
                {saving ? "Đang lưu…" : "Xác nhận adjustment"}
              </button>{" "}
              <button
                type="button"
                className="secondary"
                disabled={saving}
                onClick={() => setAdjust(null)}
              >
                Hủy
              </button>
            </form>
          )}
        </dialog>
      )}
    </div>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Tất cả</option>
        {options.map((o) => (
          <option
            key={Array.isArray(o) ? o[0] : o}
            value={Array.isArray(o) ? o[0] : o}
          >
            {Array.isArray(o) ? o[1] : o}
          </option>
        ))}
      </select>
    </label>
  );
}
function History({ rows, compact = false }) {
  return rows.length ? (
    <div className={"inv-history" + (compact ? " compact" : "")}>
      {rows.map((t) => (
        <article key={t.id}>
          <div>
            <strong>
              {t.kind} · {t.product} × {t.quantity}
            </strong>
            {!compact && <small>{t.id}</small>}
          </div>
          <div>
            <Chip value={t.source_type} /> <Chip value={t.operation_status} />{" "}
            <Chip value={t.sync_status} />
          </div>
          <p>
            {t.ipc_id} / {t.cabinet} / {t.rack}
          </p>
          {!compact && (
            <small>
              User: {t.user} · Created: {date(t.created_at)} · Completed:{" "}
              {date(t.completed_at)}
            </small>
          )}
          {compact && <small>{date(t.created_at)}</small>}
          {!compact && t.reason && <small>{t.reason}</small>}
        </article>
      ))}
    </div>
  ) : (
    <p className="empty">Chưa có giao dịch trong nguồn đã chọn.</p>
  );
}
function CatalogForm({ api, source, product, onSave }) {
  const [categories, setCategories] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    api("categories?source_type=" + source)
      .then((v) => {
        if (live) setCategories(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [source]);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        setError("");
        setNotice("");
        try {
          await api("goods", product ? "PATCH" : "POST", {
            ...values,
            ...(product ? { id: product.id } : {}),
            min_qty: Number(values.min_qty),
            max_qty: Number(values.max_qty),
            category_id: values.category_id ? Number(values.category_id) : null,
            is_active: values.is_active === "true",
          });
          await onSave();
          setNotice("Đã lưu thông tin sản phẩm.");
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <p>
          Danh mục dùng chung giữa REAL và SIMULATION. Số lượng chỉ thay đổi qua
          Inventory Adjustment hoặc giao dịch.
        </p>
        {[
          ["name", "Product Name", product?.name],
          ["code", "SKU", product?.sku],
          ["barcode", "Barcode", product?.barcode],
          ["unit", "Unit", product?.unit || "pcs"],
          ["min_qty", "Min Stock", product?.min_stock || 0],
          ["max_qty", "Max Stock", product?.max_stock || 0],
        ].map(([name, label, value]) => (
          <label key={name}>
            {label}
            <input
              name={name}
              defaultValue={value ?? ""}
              required={name !== "barcode"}
              type={name.endsWith("_qty") ? "number" : "text"}
              min={name.endsWith("_qty") ? 0 : undefined}
            />
          </label>
        ))}
        <label>
          Category
          <select name="category_id" defaultValue={product?.category_id || ""}>
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Catalog Status
          <select
            name="is_active"
            defaultValue={String(product?.is_active ?? true)}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
        <label>
          Description
          <textarea
            name="description"
            defaultValue={product?.description || ""}
          />
        </label>
        <button>{busy ? "Đang lưu…" : "Lưu danh mục"}</button>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
