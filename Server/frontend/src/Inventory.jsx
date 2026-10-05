import { t as uiText, errorText, useLanguage, LanguageSelector } from './i18n';
import React, { useEffect, useRef, useState } from "react";
import {
  StatusBadge,
  KpiCard,
  LoadingState,
  Pagination,
  ErrorState,
} from "./ui.jsx";

const date = (value) => (value ? new Date(value).toLocaleString() : "—");
export const Chip = StatusBadge;
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
  useLanguage();
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
  const [productPage, setProductPage] = useState(0);
  const [productSort, setProductSort] = useState(null);
  useEffect(() => setProductPage(0), [source, query, filters]);
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
          if (live) setError(e);
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
        if (live) setHistoryError(e);
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
  const sortedProducts = productSort
    ? [...products].sort((a, b) => {
        const av = a[productSort.key],
          bv = b[productSort.key];
        return (
          (typeof av === "number"
            ? av - bv
            : String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
                numeric: true,
              })) * productSort.direction
        );
      })
    : products;
  const currentProductPage = Math.min(
    productPage,
    Math.max(0, Math.ceil(products.length / 20) - 1),
  );
  const sortProducts = (key) => {
    setProductSort({
      key,
      direction: productSort?.key === key ? -productSort.direction : 1,
    });
    setProductPage(0);
  };
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
      <ErrorState retry={() => setReload((v) => v + 1)}>{errorText(error)}</ErrorState>
    );
  if (!data)
    return (
      <section>
        <LoadingState>{uiText("Đang tải Inventory…")}</LoadingState>
      </section>
    );
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
            <KpiCard key={label} label={uiText(label)} value={value} />
          ))}
        </div>
        <div className="inv-dashboard">
          <section className="device-overview">
            <h2>{uiText("Device status")}</h2>
            {data.devices.length ? (
              data.devices.map((d) => (
                <div className="device-summary" key={d.id}>
                  <strong>{d.id}</strong>
                  <Chip value={d.source_type} />
                  <Chip value={d.online ? "Online" : "Offline"} />
                </div>
              ))
            ) : (
              <p className="empty">{uiText("Chưa có IPC trong nguồn đã chọn.")}</p>
            )}
          </section>
          <section>
            <h2>{uiText("Low Stock Products")}</h2>
            {data.products
              .filter((p) => p.stock_status === "Low Stock")
              .slice(0, 6)
              .map((p) => (
                <p key={p.id + p.source_type}>
                  {p.name} <Chip value={p.source_type} />{" "}
                  <strong>
                    {p.quantity} {uiText("/ min")} {p.min_stock}
                  </strong>
                </p>
              ))}
          </section>
          <section>
            <h2>{uiText("Inventory Distribution by IPC")}</h2>
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
          <h2>{uiText("Recent PUT / PICK")}</h2>
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
          <summary>{uiText("Thêm sản phẩm vào danh mục")}</summary>
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
              {uiText(v)}
            </button>
          ))}
        </div>
        <label className="inv-toggle">
          <input
            type="checkbox"
            checked={source !== "REAL"}
            onChange={(e) => setSource(e.target.checked ? "ALL" : "REAL")}
          />{" "} {uiText("Show Simulation Data")} </label>
      </div>
      <section className="inv-filter">
        <label> {uiText("Search")} <input
            placeholder={uiText("Product Name / SKU / Barcode")}
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
          label={uiText("Cabinet")}
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
          label={uiText("Category")}
          value={filters.category}
          onChange={(v) => change("category", v)}
          options={[...new Set(data.products.map((p) => p.category))]}
        />
        <Select
          label={uiText("Stock Status")}
          translateOptions
          value={filters.stock_status}
          onChange={(v) => change("stock_status", v)}
          options={["Normal", "Low Stock", "Out of Stock"]}
        />
        <Select
          label={uiText("Sync Status")}
          translateOptions
          value={filters.sync_status}
          onChange={(v) => change("sync_status", v)}
          options={["Synced", "Pending", "Failed"]}
        />
      </section>
      <p className="muted"> {uiText("Tồn kho tách theo nguồn. Tổng của sản phẩm bao gồm mọi vị trí trong nguồn đã chọn; bộ lọc IPC/Cabinet giúp tìm nơi chứa hàng. Available loại trừ vị trí BUSY / FAULT.")} </p>
      {mode === "By Product" ? (
        <section>
          <div className="inv-product-head">
            {[
              ["name", "Product / SKU / Category"],
              ["quantity", "Total / Available"],
              ["source_type", "Locations / Source"],
              ["stock_status", "Stock / Sync"],
              ["last_updated", "Last Updated / Action"],
            ].map(([key, label]) => (
              <button
                key={key}
                className="sort-button"
                onClick={() => sortProducts(key)}
              >
                {uiText(label)}
                <span aria-hidden="true">
                  {productSort?.key === key ? productSort.direction === 1 ? "↑" : "↓" : "↕"}
                </span>
              </button>
            ))}
          </div>
          {sortedProducts
            .slice(currentProductPage * 20, (currentProductPage + 1) * 20)
            .map((p) => (
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
                  <small>{uiText("Available:")} {p.available_quantity}</small>
                </div>
                <div>
                  <strong>{p.locations.length} {uiText("locations")}</strong>
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
                  <button className="link" onClick={() => open(p)}> {uiText("Chi tiết →")} </button>
                </div>
              </article>
            ))}
          {products.length > 20 && (
            <Pagination
              page={currentProductPage}
              total={products.length}
              size={20}
              onChange={setProductPage}
            />
          )}
          {!products.length && (
            <p className="empty">{uiText("Không có sản phẩm phù hợp. Hãy đổi bộ lọc.")}</p>
          )}
        </section>
      ) : (
        <section className="inv-tree">
          {Object.entries(groups(locations, "ipc_id")).map(([ipc, ls]) => (
            <details key={ipc} open>
              <summary>
                {ipc} <Chip value={ls[0].source_type} />
              </summary>
              {Object.entries(groups(ls, "cabinet_id")).map(([cabinet, rs]) => (
                <details key={cabinet} open>
                  <summary>{rs[0].cabinet || `Cabinet ${String(rs[0].cabinet_index).padStart(2, "0")}`}</summary>
                  {Object.entries(groups(rs, "rack_id")).map(([rack, bins]) => (
                    <details key={rack} open>
                      <summary>
                        {bins[0].rack_index ? `Rack ${String(bins[0].rack_index).padStart(2, "0")}` : bins[0].rack}
                      </summary>
                      {bins.map((l) => (
                        <div className="inv-location" key={l.id}>
                          <div>
                            <strong>{l.location_code}</strong>{" "}
                            <Chip value={l.status} />{" "}
                            <Chip value={l.sync_status} />
                            <small> {uiText("Capacity:")} {l.quantity} / {(l.capacity || "—")}
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
                            <span className="muted">{uiText("Rack trống")}</span>
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
            <p className="empty">{uiText("Không có vị trí phù hợp.")}</p>
          )}
        </section>
      )}
      {product && (
        <dialog
          ref={dialog}
          className="inv-drawer"
          aria-label={product.name}
          onCancel={close}
          onClose={close}
        >
          <div className="toolbar">
            <LanguageSelector />
            <div>
              <h2>{product.name}</h2>
              <Chip value={product.source_type} />
            </div>
            <button
              className="secondary"
              onClick={close}
              aria-label={uiText("Đóng chi tiết")}
            > {uiText("Đóng ×")} </button>
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
                <dt>{uiText(k)}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <Chip value={product.stock_status} />
          {session.grants?.["inventory.update"]?.includes("ALL") && (
            <details className="inv-catalog">
              <summary>{uiText("Cập nhật thông tin sản phẩm")}</summary>
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
                {uiText(t)}
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
                <p> {uiText("Quantity:")} <b>{l.quantity}</b> {uiText("· Available:")}{" "}
                  {l.available_quantity} {uiText("· Capacity:")} {l.occupied_quantity} /{" "}
                  {(l.capacity || "—")}
                </p>
                <small>{uiText("Last Updated:")} {date(l.last_updated)}</small>
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
                  > {uiText("Inventory Adjustment")} </button>
                )}
              </article>
            ))
          ) : (
            <>
              <p className="muted"> {uiText("Sync Status phản ánh xác nhận dataset hiện tại của IPC; Failed là giao dịch offline cần đối soát.")} </p>
              {historyBusy && <p role="status">{uiText("Đang tải giao dịch…")}</p>}
              {historyError && (
                <p role="alert" className="error">
                  {errorText(historyError)}
                </p>
              )}
              <History rows={historyRows} />
              {historyMore && (
                <button
                  disabled={historyBusy}
                  onClick={() => setHistoryOffset((v) => v + 100)}
                > {uiText("Tải thêm giao dịch")} </button>
              )}
            </>
          )}
          {tab === "Locations" && !product.locations.length && (
            <p className="empty">{uiText("Sản phẩm chưa có vị trí trong nguồn này.")}</p>
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
                  setSaveError(e);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <h3>{uiText("Inventory Adjustment")}</h3>
              <p>{adjust.path}</p>
              <p> {uiText("Current Quantity:")} <b>{adjust.quantity}</b> {uiText("· Difference:")}{" "}
                <b>{Number(quantity) - adjust.quantity}</b>
              </p>
              <p> {uiText("User:")} {session.username} {uiText("· Timestamp:")} {date(adjust.reviewed_at)}{" "} {uiText("(thời điểm kiểm đếm; Server lưu thời điểm xác nhận trong lịch sử)")} </p>
              <label> {uiText("New Quantity")} <input
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
              <label> {uiText("Reason")} <textarea
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {saveError && (
                <p role="alert" className="error">
                  {errorText(saveError)}
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
                {saving ? uiText("Đang lưu…") : uiText("Xác nhận adjustment")}
              </button>{" "}
              <button
                type="button"
                className="secondary"
                disabled={saving}
                onClick={() => setAdjust(null)}
              > {uiText("Hủy")} </button>
            </form>
          )}
        </dialog>
      )}
    </div>
  );
}
function Select({ label, value, onChange, options, translateOptions = false }) {
  useLanguage();
  return (
    <label>
      {uiText(label)}
      <select
        aria-label={uiText(label)}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{uiText("Tất cả")}</option>
        {options.map((o) => (
          <option
            key={Array.isArray(o) ? o[0] : o}
            value={Array.isArray(o) ? o[0] : o}
          >
            {translateOptions ? uiText(Array.isArray(o) ? o[1] : o) : Array.isArray(o) ? o[1] : o}
          </option>
        ))}
      </select>
    </label>
  );
}
function History({ rows, compact = false }) {
  useLanguage();
  return rows.length ? (
    <div className={"inv-history" + (compact ? " compact" : "")}>
      {rows.map((t) => (
        <article key={t.id}>
          <div>
            <strong>
              {uiText(t.kind)} · {t.product} × {t.quantity}
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
            <small> {uiText("User:")} {t.user} {uiText("· Created:")} {date(t.created_at)} {uiText("· Completed:")}{" "}
              {date(t.completed_at)}
            </small>
          )}
          {compact && <small>{date(t.created_at)}</small>}
          {!compact && t.reason && <small>{t.reason}</small>}
        </article>
      ))}
    </div>
  ) : (
    <p className="empty">{uiText("Chưa có giao dịch trong nguồn đã chọn.")}</p>
  );
}
function CatalogForm({ api, source, product, onSave }) {
  useLanguage();
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
        if (live) setError(e);
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
          setError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <p> {uiText("Danh mục dùng chung giữa REAL và SIMULATION. Số lượng chỉ thay đổi qua Inventory Adjustment hoặc giao dịch.")} </p>
        {[
          ["name", "Product Name", product?.name],
          ["code", "SKU", product?.sku],
          ["barcode", "Barcode", product?.barcode],
          ["unit", "Unit", product?.unit || "pcs"],
          ["min_qty", "Min Stock", product?.min_stock || 0],
          ["max_qty", "Max Stock", product?.max_stock || 0],
        ].map(([name, label, value]) => (
          <label key={name}>
            {uiText(label)}
            <input
              name={name}
              defaultValue={value ?? ""}
              required={name !== "barcode"}
              type={name.endsWith("_qty") ? "number" : "text"}
              min={name.endsWith("_qty") ? 0 : undefined}
            />
          </label>
        ))}
        <label> {uiText("Category")} <select name="category_id" defaultValue={product?.category_id || ""}>
            <option value="">{uiText("Uncategorized")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label> {uiText("Catalog Status")} <select
            name="is_active"
            defaultValue={String(product?.is_active ?? true)}
          >
            <option value="true">{uiText("Active")}</option>
            <option value="false">{uiText("Inactive")}</option>
          </select>
        </label>
        <label> {uiText("Description")} <textarea
            name="description"
            defaultValue={product?.description || ""}
          />
        </label>
        <button>{busy ? uiText("Đang lưu…") : uiText("Lưu danh mục")}</button>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {errorText(error)}
        </p>
      )}
      {notice && <p role="status">{uiText(notice)}</p>}
    </form>
  );
}
