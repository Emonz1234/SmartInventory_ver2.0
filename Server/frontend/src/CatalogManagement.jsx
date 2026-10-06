import React, { useEffect, useRef, useState, useId } from "react";
import { useLanguage, errorText } from "./i18n";
import { LoadingState, ErrorState, StatusBadge, KpiCard } from "./ui.jsx";
const useText = () => {
  const lang = useLanguage();
  return (vi, en) => (lang === "en" ? en : vi);
};
const grant = (session, p) => session.grants?.[p]?.includes("ALL");
function failure(error, text) {
  const raw = String(error?.response?.data?.error || error?.message || error);
  if (/SKU already exists/i.test(raw))
    return text(
      "SKU này đã tồn tại. Vui lòng sử dụng SKU khác.",
      "This SKU already exists. Use a different SKU.",
    );
  if (/unique|already exists/i.test(raw))
    return text(
      "Mã SKU / mã danh mục hoặc barcode đã tồn tại. Vui lòng chọn mã khác.",
      "SKU, category code or barcode already exists. Choose a different code.",
    );
  if (/protected|referenced/i.test(raw))
    return text(
      "Dữ liệu đã được sử dụng. Hãy ngừng sử dụng thay vì xóa.",
      "This data has references. Deactivate it instead of deleting.",
    );
  if (/inactive/i.test(raw))
    return text(
      "Danh mục đã ngừng sử dụng. Vui lòng chọn danh mục khác.",
      "Category is inactive. Choose another category.",
    );
  return errorText(error);
}
function ConfirmAction({ action, onClose, onConfirm, busy, text }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <h3>{action.title}</h3>
      <p>{action.description}</p>
      <div className="actions">
        <button className="secondary" disabled={busy} onClick={onClose}>
          {text("Hủy", "Cancel")}
        </button>
        <button disabled={busy} onClick={onConfirm}>
          {busy ? text("Đang lưu…", "Saving…") : text("Xác nhận", "Confirm")}
        </button>
      </div>
    </dialog>
  );
}
export function CategoryForm({ api, category, onSave, onCancel }) {
  const text = useText(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const data = Object.fromEntries(new FormData(e.currentTarget));
        if (
          category?.is_active !== false &&
          category &&
          data.is_active === "false" &&
          !window.confirm(
            text(
              "Ngừng sử dụng danh mục? Sản phẩm và lịch sử vẫn được giữ lại.",
              "Deactivate category? Products and history will remain.",
            ),
          )
        )
          return;
        setBusy(true);
        setError("");
        try {
          const response = await api(
            "categories",
            category ? "PATCH" : "POST",
            {
              ...data,
              code:
                data.code.trim() || `CAT-${crypto.randomUUID().slice(0, 8)}`,
              is_active: data.is_active === "true",
              ...(category ? { id: category.id } : {}),
            },
          );
          await onSave({
            ...data,
            id: response.id,
            is_active: data.is_active === "true",
          });
        } catch (e) {
          setError(failure(e, text));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <h3>
          {category
            ? text("Chỉnh sửa danh mục", "Edit category")
            : text("Thêm danh mục", "Add category")}
        </h3>
        <label>
          {text("Tên danh mục *", "Category name *")}
          <input
            name="name"
            required
            maxLength="120"
            defaultValue={category?.name || ""}
          />
        </label>
        <label>
          {text("Mã danh mục", "Category code")}
          <input
            name="code"
            maxLength="64"
            placeholder={text(
              "Để trống để tạo mã tự động",
              "Leave blank for an automatic code",
            )}
            defaultValue={category?.code || ""}
          />
        </label>
        <label>
          {text("Mô tả", "Description")}
          <textarea
            name="description"
            defaultValue={category?.description || ""}
          />
        </label>
        <label>
          {text("Trạng thái", "Status")}
          <select
            name="is_active"
            defaultValue={String(category?.is_active !== false)}
          >
            <option value="true">{text("Đang sử dụng", "Active")}</option>
            <option value="false">{text("Ngừng sử dụng", "Inactive")}</option>
          </select>
        </label>
        <div className="actions">
          <button>{text("Lưu danh mục", "Save category")}</button>
          <button type="button" className="secondary" onClick={onCancel}>
            {text("Hủy", "Cancel")}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
export function ProductEditor({
  api,
  source,
  product,
  session,
  onSave,
  onCancel,
}) {
  const text = useText(),
    [categories, setCategories] = useState([]),
    [category, setCategory] = useState(String(product?.category_id || "")),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const errorId = useId();
  const fieldError = (name) =>
    fieldErrors[name] && (
      <small id={`${errorId}-${name}`} className="error" role="alert">
        {fieldErrors[name]}
      </small>
    );
  useEffect(() => {
    let live = true;
    api("categories?source_type=" + source)
      .then((rows) => {
        if (live) setCategories(rows);
      })
      .catch((e) => {
        if (live) setError(failure(e, text));
      });
    return () => {
      live = false;
    };
  }, [source]);
  const form = useRef(null);
  return (
    <div className="catalog-editor">
      {adding && (
        <CategoryForm
          api={api}
          onCancel={() => setAdding(false)}
          onSave={(row) => {
            setCategories((old) => [...old, row]);
            setCategory(String(row.id));
            setAdding(false);
          }}
        />
      )}
      <form
        onInvalidCapture={(event) => {
          const input = event.target;
          setFieldErrors((old) => ({
            ...old,
            [input.name]: input.validity.valueMissing
              ? text(
                  "Vui lòng điền hoặc chọn trường này.",
                  "Complete this required field.",
                )
              : text("Vui lòng nhập giá trị hợp lệ.", "Enter a valid value."),
          }));
        }}
        onChangeCapture={(event) => {
          const name = event.target.name;
          setFieldErrors((old) => ({ ...old, [name]: "" }));
        }}
        ref={form}
        hidden={adding}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const values = Object.fromEntries(new FormData(e.currentTarget));
          setBusy(true);
          setError("");
          try {
            await api("goods", product ? "PATCH" : "POST", {
              ...values,
              code: values.code.trim(),
              name: values.name.trim(),
              category_id: Number(category),
              min_qty: Number(values.min_qty),
              max_qty: Number(values.max_qty),
              is_active: product?.is_active !== false,
              ...(product ? { id: product.id } : {}),
            });
            await onSave();
          } catch (e) {
            setError(failure(e, text));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <h3>
            {product
              ? text("Chỉnh sửa sản phẩm", "Edit product")
              : text("Thêm sản phẩm", "Add product")}
          </h3>
          <p className="muted">
            {text(
              "Thông tin sản phẩm dùng chung cho REAL và SIMULATION. Tồn kho chỉ thay đổi qua giao dịch.",
              "Product metadata is shared by REAL and SIMULATION. Stock changes only through transactions.",
            )}
          </p>
          <h4>{text("Thông tin cơ bản", "Basic information")}</h4>
          <label>
            {text("Tên sản phẩm *", "Product name *")}
            <input
              aria-label={text("Tên sản phẩm *", "Product name *")}
              aria-invalid={!!fieldErrors.name}
              aria-describedby={
                fieldErrors.name ? `${errorId}-name` : undefined
              }
              name="name"
              required
              maxLength="120"
              defaultValue={product?.name || ""}
            />
            {fieldError("name")}
          </label>
          <label>
            SKU *
            <input
              aria-label={"SKU *"}
              aria-invalid={!!fieldErrors.code}
              aria-describedby={
                fieldErrors.code ? `${errorId}-code` : undefined
              }
              name="code"
              required
              maxLength="64"
              defaultValue={product?.sku || product?.code || ""}
            />
            {fieldError("code")}
          </label>
          <label>
            {text("Danh mục *", "Category *")}
            <select
              aria-label={text("Danh mục *", "Category *")}
              name="category_id"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">
                {text("Chọn danh mục", "Choose category")}
              </option>
              {categories
                .filter(
                  (c) => c.is_active !== false || String(c.id) === category,
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_active === false
                      ? text(" (ngừng sử dụng)", " (inactive)")
                      : ""}
                  </option>
                ))}
            </select>
            {fieldError("category_id")}
          </label>
          {grant(session, "inventory.create") && (
            <button
              type="button"
              className="secondary"
              onClick={() => setAdding(true)}
            >
              {text("+ Tạo danh mục mới", "+ Create category")}
            </button>
          )}
          <label>
            {text("Đơn vị tính *", "Unit *")}
            <input
              aria-label={text("Đơn vị tính *", "Unit *")}
              aria-invalid={!!fieldErrors.unit}
              aria-describedby={
                fieldErrors.unit ? `${errorId}-unit` : undefined
              }
              name="unit"
              required
              maxLength="32"
              defaultValue={product?.unit || "pcs"}
            />
            {fieldError("unit")}
          </label>
          <label>
            {text("Mô tả", "Description")}
            <textarea
              name="description"
              defaultValue={product?.description || ""}
            />
          </label>
          <h4>{text("Quản lý tồn kho", "Stock management")}</h4>
          <label>
            {text("Tồn kho tối thiểu", "Minimum stock")}
            <input
              aria-label={text("Tồn kho tối thiểu", "Minimum stock")}
              aria-invalid={!!fieldErrors.min_qty}
              aria-describedby={
                fieldErrors.min_qty ? `${errorId}-min_qty` : undefined
              }
              name="min_qty"
              type="number"
              min="0"
              step="1"
              required
              defaultValue={product?.min_stock || 0}
            />
            {fieldError("min_qty")}
          </label>
          <label>
            {text(
              "Tồn kho tối đa (0: không giới hạn)",
              "Maximum stock (0: unlimited)",
            )}
            <input
              aria-label={text(
                "Tồn kho tối đa (0: không giới hạn)",
                "Maximum stock (0: unlimited)",
              )}
              aria-invalid={!!fieldErrors.max_qty}
              aria-describedby={
                fieldErrors.max_qty ? `${errorId}-max_qty` : undefined
              }
              name="max_qty"
              type="number"
              min="0"
              step="1"
              required
              defaultValue={product?.max_stock || 0}
            />
            {fieldError("max_qty")}
          </label>
          <h4>{text("Thông tin bổ sung", "Additional information")}</h4>
          <label>
            Barcode / QR
            <input
              aria-label={"Barcode / QR"}
              aria-invalid={!!fieldErrors.barcode}
              aria-describedby={
                fieldErrors.barcode ? `${errorId}-barcode` : undefined
              }
              name="barcode"
              maxLength="64"
              defaultValue={product?.barcode || ""}
            />
            {fieldError("barcode")}
          </label>
          <div className="actions">
            <button>{text("Lưu sản phẩm", "Save product")}</button>
            {onCancel && (
              <button type="button" className="secondary" onClick={onCancel}>
                {text("Hủy", "Cancel")}
              </button>
            )}
          </div>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
export function Categories({ api, source, session }) {
  const text = useText(),
    [rows, setRows] = useState(null),
    [items, setItems] = useState([]),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [editor, setEditor] = useState(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [action, setAction] = useState(null),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const [cats, products] = await Promise.all([
      api("categories?source_type=" + source),
      api("goods?source_type=" + source),
    ]);
    setRows(cats);
    setItems(products);
  };
  useEffect(() => {
    setRows(null);
    load().catch((e) => setError(failure(e, text)));
  }, [source]);
  if (!rows)
    return error ? (
      <ErrorState retry={() => load().catch((e) => setError(failure(e, text)))}>
        {error}
      </ErrorState>
    ) : (
      <LoadingState />
    );
  const visibleCategories = rows.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) &&
      (status === "all" || String(c.is_active !== false) === status),
  );
  return (
    <section className="category-manager">
      <div className="toolbar">
        <input
          aria-label={text("Tìm danh mục", "Search categories")}
          placeholder={text("Tìm danh mục…", "Search categories…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label={text("Trạng thái danh mục", "Category status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">{text("Tất cả", "All")}</option>
          <option value="true">{text("Đang sử dụng", "Active")}</option>
          <option value="false">{text("Ngừng sử dụng", "Inactive")}</option>
        </select>
        {grant(session, "inventory.create") && (
          <button onClick={() => setEditor({})}>
            {text("+ Thêm danh mục", "+ Add category")}
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {editor && (
        <CategoryForm
          key={editor.id || "new"}
          api={api}
          category={editor.id ? editor : null}
          onCancel={() => setEditor(null)}
          onSave={async () => {
            await load();
            setEditor(null);
            setNotice(text("Đã cập nhật danh mục.", "Category saved."));
          }}
        />
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{text("Tên danh mục", "Category")}</th>
              <th>{text("Số sản phẩm", "Products")}</th>
              <th>{text("Trạng thái", "Status")}</th>
              <th>{text("Thao tác", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter(
                (c) =>
                  c.name.toLowerCase().includes(query.toLowerCase()) &&
                  (status === "all" ||
                    String(c.is_active !== false) === status),
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <tr
                  key={c.id}
                  style={{ opacity: c.is_active === false ? 0.55 : 1 }}
                >
                  <td>
                    <strong>{c.name}</strong>
                    <small>{c.description}</small>
                  </td>
                  <td>{items.filter((p) => p.category_id === c.id).length}</td>
                  <td>
                    <StatusBadge
                      value={c.is_active === false ? "Inactive" : "Active"}
                    />
                  </td>
                  <td>
                    <div className="actions">
                      {grant(session, "inventory.update") && (
                        <>
                          <button
                            className="secondary"
                            onClick={() => setEditor(c)}
                          >
                            {text("Chỉnh sửa", "Edit")}
                          </button>
                          <button
                            className="secondary"
                            onClick={() =>
                              setAction({
                                title: `${c.is_active === false ? text("Kích hoạt", "Activate") : text("Ngừng sử dụng", "Deactivate")} ${c.name}?`,
                                description: text(
                                  "Sản phẩm và lịch sử được giữ lại. Danh mục ngừng sử dụng không được chọn cho sản phẩm mới.",
                                  "Products and history remain. Inactive categories cannot be chosen for new products.",
                                ),
                                method: "PATCH",
                                data: {
                                  id: c.id,
                                  is_active: c.is_active === false,
                                },
                              })
                            }
                          >
                            {c.is_active === false
                              ? text("Kích hoạt", "Activate")
                              : text("Ngừng sử dụng", "Deactivate")}
                          </button>
                        </>
                      )}
                      {grant(session, "inventory.delete") && (
                        <button
                          className="secondary"
                          disabled={items.some((p) => p.category_id === c.id)}
                          title={text(
                            "Chỉ xóa danh mục chưa có sản phẩm",
                            "Delete only categories without products",
                          )}
                          onClick={() =>
                            setAction({
                              title: `${text("Xóa", "Delete")} ${c.name}?`,
                              description: text(
                                "Chỉ xóa khi không có dữ liệu tham chiếu.",
                                "Delete only if no references exist.",
                              ),
                              method: "DELETE",
                              data: { id: c.id },
                            })
                          }
                        >
                          {text("Xóa", "Delete")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!visibleCategories.length && (
        <p className="empty">
          {text(
            "Chưa có danh mục phù hợp. Thêm danh mục hoặc thay đổi bộ lọc.",
            "No matching categories. Add a category or change the filters.",
          )}
        </p>
      )}
      {action && (
        <ConfirmAction
          action={action}
          text={text}
          busy={busy}
          onClose={() => setAction(null)}
          onConfirm={async () => {
            if (busy) return;
            setBusy(true);
            try {
              await api("categories", action.method, action.data);
              await load();
              setNotice(text("Đã cập nhật danh mục.", "Category updated."));
              setAction(null);
            } catch (e) {
              setError(failure(e, text));
              setAction(null);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}
export function ProductActions({
  api,
  source,
  session,
  products,
  onSave,
  single = false,
}) {
  const text = useText(),
    [selected, setSelected] = useState([]),
    [category, setCategory] = useState(""),
    [cats, setCats] = useState([]),
    [action, setAction] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setSelected(single ? products.map((p) => p.id) : []);
    api("categories?source_type=" + source)
      .then(setCats)
      .catch(() => {});
  }, [source, single, single ? products[0]?.id : null]);
  const unique = [...new Map(products.map((p) => [p.id, p])).values()];
  if (
    !grant(session, "inventory.update") &&
    !grant(session, "inventory.delete")
  )
    return null;
  const propose = (kind) =>
    setAction({
      kind,
      title: `${kind === "deactivate" ? text("Ngừng sử dụng", "Deactivate") : kind === "delete" ? text("Xóa", "Delete") : kind === "activate" ? text("Kích hoạt", "Activate") : text("Chuyển danh mục", "Move category")} ${selected.length} ${text("sản phẩm", "products")}?`,
      description: unique
        .filter((p) => selected.includes(p.id))
        .map((p) => p.name)
        .join(", "),
    });
  return (
    <details className="catalog-bulk">
      <summary>
        {single
          ? text("Thao tác khác", "More actions")
          : text("Chọn nhiều sản phẩm", "Select multiple products")}
      </summary>
      <div className="catalog-selection">
        {unique.map((p) => (
          <label key={p.id}>
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={(e) =>
                setSelected((old) =>
                  e.target.checked
                    ? [...old, p.id]
                    : old.filter((id) => id !== p.id),
                )
              }
            />
            {p.name} · {p.sku}
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <div className="actions">
          {grant(session, "inventory.update") && (
            <>
              <button onClick={() => propose("activate")}>
                {text("Kích hoạt", "Activate")}
              </button>
              <button
                className="secondary"
                onClick={() => propose("deactivate")}
              >
                {text("Ngừng sử dụng", "Deactivate")}
              </button>
              <select
                aria-label={text("Chuyển danh mục", "Move to category")}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">
                  {text("Chọn danh mục", "Choose category")}
                </option>
                {cats
                  .filter((c) => c.is_active !== false)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <button disabled={!category} onClick={() => propose("category")}>
                {text("Chuyển danh mục", "Move category")}
              </button>
            </>
          )}
          {grant(session, "inventory.delete") && (
            <button className="secondary" onClick={() => propose("delete")}>
              {text("Xóa dữ liệu chưa sử dụng", "Delete unused data")}
            </button>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {action && (
        <ConfirmAction
          action={action}
          text={text}
          busy={busy}
          onClose={() => setAction(null)}
          onConfirm={async () => {
            if (busy) return;
            setBusy(true);
            setError("");
            let done = 0;
            try {
              for (const id of selected) {
                await api(
                  "goods",
                  action.kind === "delete" ? "DELETE" : "PATCH",
                  {
                    id,
                    ...(action.kind === "category"
                      ? { category_id: Number(category) }
                      : action.kind === "delete"
                        ? {}
                        : { is_active: action.kind === "activate" }),
                  },
                );
                done++;
              }
              setSelected([]);
              setNotice(text("Đã cập nhật sản phẩm.", "Products updated."));
            } catch (e) {
              setError(`${done}/${selected.length}: ${failure(e, text)}`);
            } finally {
              try {
                await onSave();
              } catch (e) {
                setError(failure(e, text));
              }
              setAction(null);
              setBusy(false);
            }
          }}
        />
      )}
    </details>
  );
}
export function WarehouseOverview({ api, source, navigate }) {
  const text = useText(),
    [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    api("inventory-overview?source_type=" + source)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [source]);
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!data) return <LoadingState />;
  return (
    <section>
      <div className="metrics">
        <KpiCard
          label={text("Sản phẩm", "Products")}
          value={new Set(data.products.map((p) => p.id)).size}
        />
        <KpiCard
          label={text("Tổng tồn kho", "Total stock")}
          value={data.products.reduce((n, p) => n + p.quantity, 0)}
        />
        <KpiCard
          label={text("Vị trí lưu trữ", "Storage locations")}
          value={data.locations.length}
        />
      </div>
      <div className="quick-actions">
        {[
          ["Inventory", text("Xem sản phẩm", "Browse products")],
          ["Categories", text("Quản lý danh mục", "Manage categories")],
          ["Storage Map", text("Xem vị trí", "Browse locations")],
        ].map(([p, label]) => (
          <button key={p} className="secondary" onClick={() => navigate(p)}>
            {label} →
          </button>
        ))}
      </div>
    </section>
  );
}
