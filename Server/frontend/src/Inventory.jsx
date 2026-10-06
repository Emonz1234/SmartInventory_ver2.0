import { ProductEditor, ProductActions } from "./CatalogManagement.jsx";
import { t as uiText, errorText, useLanguage, LanguageSelector } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import { StatusBadge, LoadingState, Pagination, ErrorState } from "./ui.jsx";

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
  navigate,
  initialProduct,
}) {
  const language = useLanguage();
  const stockAction = (pick) =>
    language === "en"
      ? pick
        ? "Issue stock"
        : "Receive stock"
      : pick
        ? "Xuất hàng"
        : "Nhập hàng";
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
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState("");
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
    if (selected && dialog.current && !dialog.current.open) {
      dialog.current.show();
      dialog.current.querySelector("button")?.focus();
    }
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
  const initialOpened = useRef(null);
  useEffect(() => {
    if (
      initialProduct &&
      data &&
      initialOpened.current !== `${initialProduct}:${source}`
    ) {
      const found = data.products.find(
        (p) => String(p.id) === String(initialProduct),
      );
      if (found) {
        initialOpened.current = `${initialProduct}:${source}`;
        open(found);
      }
    }
  }, [initialProduct, data?.products]);
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
      (filters.active_status === "all" ||
        (filters.active_status === "inactive"
          ? p.is_active === false
          : p.is_active !== false)) &&
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
    : [...products].sort(
        (a, b) =>
          (a.source_type === "SIMULATION" ? 1 : 0) -
          (b.source_type === "SIMULATION" ? 1 : 0),
      );
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
      <ErrorState retry={() => setReload((v) => v + 1)}>
        {errorText(error)}
      </ErrorState>
    );
  if (!data)
    return (
      <section>
        <LoadingState>{uiText("Đang tải Inventory…")}</LoadingState>
      </section>
    );
  return (
    <div className="inventory-workspace">
      {catalogNotice && <p role="status">{catalogNotice}</p>}
      {session.grants?.["inventory.create"]?.includes("ALL") && (
        <div className="inv-catalog">
          <button onClick={() => setCreatingProduct((v) => !v)}>
            {language === "en" ? "+ Add product" : "+ Thêm sản phẩm"}
          </button>
          {creatingProduct && (
            <CatalogForm
              api={api}
              session={session}
              source={source}
              onSave={() => {
                setReload((v) => v + 1);
                setCreatingProduct(false);
                setCatalogNotice(
                  language === "en"
                    ? "Product created successfully."
                    : "Đã tạo sản phẩm thành công.",
                );
              }}
            />
          )}
        </div>
      )}
      <ProductActions
        api={api}
        source={source}
        session={session}
        products={data.products}
        onSave={async () =>
          setData(await api("inventory-overview?source_type=" + source))
        }
      />
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
        {navigate && can("inventory.move") && (
          <div className="actions">
            <button
              onClick={() => navigate("Stock Operations", { kind: "PUT" })}
            >
              {stockAction(false)}
            </button>
            <button
              className="secondary"
              onClick={() => navigate("Stock Operations", { kind: "PICK" })}
            >
              {stockAction(true)}
            </button>
          </div>
        )}
      </div>
      <section className="inv-filter">
        <label>
          {language === "en" ? "Product status" : "Trạng thái sản phẩm"}
          <select
            aria-label={
              language === "en" ? "Product status" : "Trạng thái sản phẩm"
            }
            value={filters.active_status || "active"}
            onChange={(e) => change("active_status", e.target.value)}
          >
            <option value="active">{uiText("Active")}</option>
            <option value="inactive">{uiText("Inactive")}</option>
            <option value="all">{language === "en" ? "All" : "Tất cả"}</option>
          </select>
        </label>
        <label>
          {uiText("Search")}
          <input
            placeholder={uiText("Product Name / SKU / Barcode")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
      <p className="muted">
        {" "}
        {uiText(
          "Tồn kho tách theo nguồn. Tổng của sản phẩm bao gồm mọi vị trí trong nguồn đã chọn; bộ lọc IPC/Cabinet giúp tìm nơi chứa hàng. Available loại trừ vị trí BUSY / FAULT.",
        )}{" "}
      </p>
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
                  {productSort?.key === key
                    ? productSort.direction === 1
                      ? "↑"
                      : "↓"
                    : "↕"}
                </span>
              </button>
            ))}
          </div>
          {sortedProducts
            .slice(currentProductPage * 20, (currentProductPage + 1) * 20)
            .map((p) => (
              <article
                style={{ opacity: p.is_active === false ? 0.5 : 1 }}
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
                  <small>
                    {uiText("Available:")} {p.available_quantity}
                  </small>
                </div>
                <div>
                  <strong>
                    {p.locations[0]?.cabinet || uiText("Chưa có vị trí")}
                  </strong>
                  <small>
                    {p.locations[0]?.rack || "—"}
                    {p.locations.length > 1
                      ? ` +${p.locations.length - 1}`
                      : ""}
                  </small>
                  <small>
                    <Chip value={p.source_type} />
                  </small>
                </div>
                <div>
                  <Chip
                    value={p.is_active === false ? "Inactive" : p.stock_status}
                  />
                  <small>
                    <Chip value={p.sync_status} />
                  </small>
                </div>
                <div>
                  <small>{date(p.last_updated)}</small>
                  <button className="link" onClick={() => open(p)}>
                    {" "}
                    {uiText("Xem vị trí")} →
                  </button>
                  {navigate &&
                    can("inventory.move", p.source_type) &&
                    p.is_active !== false && (
                      <button
                        className="secondary"
                        disabled={
                          p.available_quantity <= 0 &&
                          !data.locations.some(
                            (l) =>
                              ["AVAILABLE", "EMPTY"].includes(l.status) &&
                              l.source_type === p.source_type,
                          )
                        }
                        title={
                          language === "en"
                            ? "Requires an available storage location"
                            : "Cần vị trí lưu trữ khả dụng"
                        }
                        onClick={() =>
                          navigate("Stock Operations", {
                            kind: p.available_quantity > 0 ? "PICK" : "PUT",
                            product_id: p.id,
                            source_type: p.source_type,
                          })
                        }
                      >
                        {stockAction(p.available_quantity > 0)}
                      </button>
                    )}
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
            <p className="empty">
              {uiText("Không có sản phẩm phù hợp. Hãy đổi bộ lọc.")}
            </p>
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
                  <summary>
                    {rs[0].cabinet ||
                      `Cabinet ${String(rs[0].cabinet_index).padStart(2, "0")}`}
                  </summary>
                  {Object.entries(groups(rs, "rack_id")).map(([rack, bins]) => (
                    <details key={rack} open>
                      <summary>
                        {bins[0].rack_index
                          ? `Rack ${String(bins[0].rack_index).padStart(2, "0")}`
                          : bins[0].rack}
                      </summary>
                      {bins.map((l) => (
                        <div className="inv-location" key={l.id}>
                          <div>
                            <strong>{l.location_code}</strong>{" "}
                            <Chip value={l.status} />{" "}
                            <Chip value={l.sync_status} />
                            <small>
                              {" "}
                              {uiText("Capacity:")} {l.quantity} /{" "}
                              {l.capacity || "—"}
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
                            <span className="muted">
                              {uiText("Rack trống")}
                            </span>
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
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
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
            >
              {" "}
              {uiText("Đóng ×")}{" "}
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
                <dt>{uiText(k)}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <Chip value={product.stock_status} />
          {navigate &&
            can("inventory.move", product.source_type) &&
            product.is_active !== false && (
              <div className="actions">
                <button
                  disabled={
                    !data.locations.some(
                      (l) =>
                        ["AVAILABLE", "EMPTY"].includes(l.status) &&
                        l.source_type === product.source_type,
                    )
                  }
                  title={
                    language === "en"
                      ? "Requires an available storage location"
                      : "Cần vị trí lưu trữ khả dụng"
                  }
                  onClick={() =>
                    navigate("Stock Operations", {
                      kind: "PUT",
                      product_id: product.id,
                      source_type: product.source_type,
                    })
                  }
                >
                  {stockAction(false)}
                </button>
                <button
                  className="secondary"
                  title={
                    product.available_quantity <= 0
                      ? language === "en"
                        ? "No stock at an available location"
                        : "Không có hàng tại vị trí khả dụng"
                      : ""
                  }
                  disabled={product.available_quantity <= 0}
                  onClick={() =>
                    navigate("Stock Operations", {
                      kind: "PICK",
                      product_id: product.id,
                      source_type: product.source_type,
                    })
                  }
                >
                  {stockAction(true)}
                </button>
              </div>
            )}
          {session.grants?.["inventory.update"]?.includes("ALL") && (
            <details className="inv-catalog">
              <summary>{uiText("Cập nhật thông tin sản phẩm")}</summary>
              <CatalogForm
                key={product.id}
                api={api}
                source={source}
                product={product}
                session={session}
                onSave={async () =>
                  setData(await api("inventory-overview?source_type=" + source))
                }
              />
            </details>
          )}
          {navigate && session.grants?.["audit.view"]?.includes("ALL") && (
            <button
              className="secondary"
              onClick={() => {
                setSource("ALL");
                navigate("Audit Logs", {
                  resource: "items",
                  object_id: product.id,
                });
              }}
            >
              {language === "en"
                ? "Product change history"
                : "Lịch sử thay đổi sản phẩm"}
            </button>
          )}
          <ProductActions
            api={api}
            source={product.source_type}
            session={session}
            products={[product]}
            onSave={async () =>
              setData(await api("inventory-overview?source_type=" + source))
            }
            single
          />
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
                <p>
                  {" "}
                  {uiText("Quantity:")} <b>{l.quantity}</b>{" "}
                  {uiText("· Available:")} {l.available_quantity}{" "}
                  {uiText("· Capacity:")} {l.occupied_quantity} /{" "}
                  {l.capacity || "—"}
                </p>
                <small>
                  {uiText("Last Updated:")} {date(l.last_updated)}
                </small>
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
                    {" "}
                    {uiText("Inventory Adjustment")}{" "}
                  </button>
                )}
              </article>
            ))
          ) : (
            <>
              <p className="muted">
                {" "}
                {uiText(
                  "Sync Status phản ánh xác nhận dataset hiện tại của IPC; Failed là giao dịch offline cần đối soát.",
                )}{" "}
              </p>
              {historyBusy && (
                <p role="status">{uiText("Đang tải giao dịch…")}</p>
              )}
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
                >
                  {" "}
                  {uiText("Tải thêm giao dịch")}{" "}
                </button>
              )}
            </>
          )}
          {tab === "Locations" && !product.locations.length && (
            <p className="empty">
              {uiText("Sản phẩm chưa có vị trí trong nguồn này.")}
            </p>
          )}
          {adjust && (
            <form
              className="inv-adjust"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  !window.confirm(
                    `${uiText("Inventory Adjustment")}: ${product.name} · ${adjust.path} · ${adjust.quantity} → ${quantity}\n${reason}`,
                  )
                )
                  return;
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
              <p>
                {" "}
                {uiText("Current Quantity:")} <b>{adjust.quantity}</b>{" "}
                {uiText("· Difference:")}{" "}
                <b>{Number(quantity) - adjust.quantity}</b>
              </p>
              <p>
                {" "}
                {uiText("User:")} {session.username} {uiText("· Timestamp:")}{" "}
                {date(adjust.reviewed_at)}{" "}
                {uiText(
                  "(thời điểm kiểm đếm; Server lưu thời điểm xác nhận trong lịch sử)",
                )}{" "}
              </p>
              <label>
                {" "}
                {uiText("New Quantity")}{" "}
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
                {" "}
                {uiText("Reason")}{" "}
                <textarea
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
              >
                {" "}
                {uiText("Hủy")}{" "}
              </button>
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
            {translateOptions
              ? uiText(Array.isArray(o) ? o[1] : o)
              : Array.isArray(o)
                ? o[1]
                : o}
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
            <small>
              {" "}
              {uiText("User:")} {t.user} {uiText("· Created:")}{" "}
              {date(t.created_at)} {uiText("· Completed:")}{" "}
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
function CatalogForm({ api, source, product, session, onSave }) {
  return (
    <ProductEditor
      api={api}
      source={source}
      product={product}
      session={session}
      onSave={onSave}
    />
  );
}
