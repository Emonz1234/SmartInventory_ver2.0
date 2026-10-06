import React, { useEffect, useRef, useState } from "react";
import { useLanguage, errorText } from "./i18n";
import { StatusBadge, LoadingState, ErrorState } from "./ui.jsx";

export default function StockWizard({
  api,
  source,
  session,
  can,
  initialKind = "PUT",
  initialProduct,
  navigate,
}) {
  const lang = useLanguage(),
    text = (vi, en) => (lang === "en" ? en : vi);
  const storageKey = `server-stock-workflow:${session.username}`;
  const [workflow, setWorkflow] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey));
      return (
        (saved?.attempted ? saved : null) || {
          kind: initialKind,
          step: 0,
          quantity: 1,
          productId: initialProduct || "",
          source,
        }
      );
    } catch {
      return {
        kind: initialKind,
        step: 0,
        quantity: 1,
        productId: initialProduct || "",
        source,
      };
    }
  });
  const [data, setData] = useState(null),
    [devices, setDevices] = useState([]),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState(null),
    [note, setNote] = useState(""),
    [checked, setChecked] = useState(false),
    [showSuccess, setShowSuccess] = useState(false);
  const inFlight = useRef(false),
    dialog = useRef(null);
  const activeSource = workflow.attempted ? workflow.source : source;
  const update = (patch) => setWorkflow((old) => ({ ...old, ...patch }));
  useEffect(() => {
    if (workflow.attempted)
      sessionStorage.setItem(storageKey, JSON.stringify(workflow));
    else sessionStorage.removeItem(storageKey);
  }, [workflow, storageKey]);
  useEffect(() => {
    if (!workflow.attempted)
      update({ kind: initialKind, productId: initialProduct || "", step: 0 });
  }, [initialKind, initialProduct]);
  useEffect(() => {
    if (!workflow.attempted)
      update({
        source,
        productId: initialProduct || "",
        locationId: "",
        step: 0,
      });
  }, [source]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const value = await api(
          `inventory-overview?source_type=${activeSource}`,
        );
        const ipcs = can("ipc.view", activeSource)
          ? await api(`ipcs?source_type=${activeSource}`)
          : [];
        if (live) {
          setData(value);
          setDevices(ipcs);
        }
      } catch (e) {
        if (live) setError(e);
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, activeSource]);
  useEffect(() => {
    if (!workflow.commandId) return;
    let live = true;
    const load = async () => {
      try {
        const rows = await api(
          `operations?source_type=${workflow.source}&device_id=${encodeURIComponent(workflow.location.ipc_id)}`,
        );
        const current = rows.find((row) => row.id === workflow.commandId);
        if (live) {
          setOperation(current || null);
          if (current?.state === "confirmed" && workflow.step < 5) {
            update({
              step: 5,
              completedAt: current.execution_updated_at || current.created_at,
            });
            setShowSuccess(true);
          }
          setError(
            current
              ? null
              : new Error(
                  text(
                    "Không tìm thấy lệnh trong cửa sổ lịch sử. Kiểm tra thiết bị trước khi tiếp tục.",
                    "Command is outside the history window. Inspect the device before continuing.",
                  ),
                ),
          );
        }
      } catch (e) {
        if (live) {
          setError(e);
          setOperation(null);
        }
      }
    };
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, workflow.commandId, workflow.source]);
  useEffect(() => {
    if (showSuccess && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [showSuccess]);
  const products =
    data?.products.filter(
      (p) => p.is_active !== false && can("inventory.move", p.source_type),
    ) || [];
  const product =
    products.find(
      (p) =>
        String(p.id) === String(workflow.productId) &&
        p.source_type === workflow.source,
    ) ||
    (workflow.source === "ALL"
      ? products.find((p) => String(p.id) === String(workflow.productId))
      : null) ||
    workflow.product;
  const locations = (data?.locations || []).filter(
    (l) =>
      l.source_type === product?.source_type &&
      !["FAULT", "BUSY"].includes(l.status) &&
      l.ipc_id &&
      (workflow.kind === "PUT"
        ? !l.capacity || l.quantity + Number(workflow.quantity) <= l.capacity
        : l.goods.some(
            (g) =>
              g.item_id === product.id &&
              g.available_quantity >= Number(workflow.quantity),
          )),
  );
  const location =
    locations.find((l) => String(l.id) === String(workflow.locationId)) ||
    (workflow.attempted ? workflow.location : null);
  const device = devices.find((d) => d.id === location?.ipc_id);
  const steps = [
    text("Sản phẩm", "Product"),
    text("Số lượng", "Quantity"),
    text("Vị trí", "Location"),
    text("Xác nhận", "Review"),
    text("IPC thực hiện", "Device execution"),
    text("Hoàn tất", "Complete"),
  ];
  const ready =
    operation?.execution_state === "completed" &&
    ["sent", "uncertain"].includes(operation.state) &&
    !error;
  async function dispatch() {
    if (
      inFlight.current ||
      !product ||
      !location ||
      !can("inventory.move", product.source_type) ||
      !can("cabinet.view", product.source_type)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const command = workflow.requestKey
      ? workflow
      : {
          ...workflow,
          requestKey: crypto.randomUUID(),
          source: product.source_type,
          product,
          location,
        };
    update({ ...command, attempted: true, step: 4 });
    try {
      const result = await api("operations", "POST", {
        device_id: command.location.ipc_id,
        rack_id: command.location.rack_id,
        item_id: command.product.id,
        bin_id: command.location.id,
        kind: command.kind,
        quantity: Number(command.quantity),
        request_key: command.requestKey,
      });
      update({ commandId: result.id });
    } catch (e) {
      setError(e);
      if (
        !workflow.attempted &&
        e.response?.status >= 400 &&
        e.response?.status < 500
      )
        update({ attempted: false, step: 3, requestKey: null });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (inFlight.current || !ready || !checked || !note.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api(
        `operations/${workflow.commandId}/confirm`,
        "POST",
        { success: true, note: note.trim() },
      );
      if (result.state !== "confirmed")
        throw new Error(
          text(
            "Kết quả chưa được xác nhận.",
            "Outcome has not been confirmed.",
          ),
        );
      update({ step: 5, completedAt: new Date().toISOString() });
      setShowSuccess(true);
    } catch (e) {
      setError(e);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function finish() {
    setShowSuccess(false);
    sessionStorage.removeItem(storageKey);
    setWorkflow({
      kind: initialKind,
      step: 0,
      quantity: 1,
      productId: "",
      source,
    });
    setOperation(null);
    setChecked(false);
    setNote("");
    navigate("Transactions");
  }
  if (!data)
    return error ? (
      <ErrorState retry={() => window.location.reload()}>
        {errorText(error)}
      </ErrorState>
    ) : (
      <LoadingState />
    );
  return (
    <section className="stock-wizard">
      <h2>
        {text("Nhập / xuất theo từng bước", "Receive / issue step by step")}
      </h2>
      {workflow.attempted && workflow.source !== source && (
        <p className="notice">
          {text(
            "Đang tiếp tục giao dịch đã lưu. Nguồn và vị trí của lệnh được giữ nguyên.",
            "Continuing the saved transaction. Its source and location remain unchanged.",
          )}{" "}
          <StatusBadge value={workflow.source} />
        </p>
      )}
      <ol className="wizard-steps">
        {steps.map((label, index) => (
          <li
            key={label}
            className={
              index === workflow.step
                ? "current"
                : index < workflow.step
                  ? "done"
                  : ""
            }
            aria-current={index === workflow.step ? "step" : undefined}
          >
            <span>{index < workflow.step ? "✓" : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && <ErrorState>{errorText(error)}
        {String(error?.response?.data?.error || error?.message || '').includes('Resolve pending operation before sending another command') && can('dashboard.view', activeSource) &&
          <button className="secondary" onClick={() => navigate('Dashboard', { source_type: activeSource })}>{text('Xem thao tác đang chờ tại Dashboard', 'Review pending operations on Dashboard')}</button>}
      </ErrorState>}
      {workflow.step < 4 && (
        <div className="wizard-body">
          {workflow.step === 0 && (
            <>
              <div className="inv-tabs">
                {["PUT", "PICK"].map((kind) => (
                  <button
                    key={kind}
                    className={workflow.kind === kind ? "" : "secondary"}
                    onClick={() => update({ kind })}
                  >
                    {kind === "PUT"
                      ? text("Nhập hàng", "Receive stock")
                      : text("Xuất hàng", "Issue stock")}
                  </button>
                ))}
              </div>
              <label>
                {text("Sản phẩm", "Product")}
                <select
                  aria-label={text("Sản phẩm", "Product")}
                  value={`${workflow.productId}:${workflow.source}`}
                  onChange={(e) => {
                    const [id, scope] = e.target.value.split(":");
                    update({ productId: id, source: scope, locationId: "" });
                  }}
                >
                  <option value="">
                    {text("Chọn sản phẩm", "Select a product")}
                  </option>
                  {products.map((p) => (
                    <option
                      key={`${p.id}:${p.source_type}`}
                      value={`${p.id}:${p.source_type}`}
                    >
                      {p.name} · {p.sku} · {p.source_type}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {workflow.step === 1 && (
            <>
              <h3>{product?.name}</h3>
              <label>
                {text("Số lượng", "Quantity")}
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={workflow.quantity}
                  onChange={(e) =>
                    update({ quantity: e.target.value, locationId: "" })
                  }
                />
              </label>
              <p className="muted">
                {text(
                  "Nhập số lượng thực tế cần giao dịch.",
                  "Enter the actual quantity to transact.",
                )}{" "}
                · {product?.unit}
              </p>
            </>
          )}
          {workflow.step === 2 && (
            <>
              <label>
                {text("Vị trí giao dịch", "Transaction location")}
                <select
                  aria-label={text("Vị trí giao dịch", "Transaction location")}
                  value={workflow.locationId || ""}
                  onChange={(e) => update({ locationId: e.target.value })}
                >
                  <option value="">
                    {text("Chọn vị trí", "Select a location")}
                  </option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.path} / {l.location_code} · {l.quantity}
                    </option>
                  ))}
                </select>
              </label>
              {!locations.length && (
                <p className="empty">
                  {text(
                    "Không có vị trí phù hợp với số lượng và trạng thái hiện tại.",
                    "No location matches the quantity and current state.",
                  )}
                </p>
              )}
              {location && (
                <p>
                  {location.path} <StatusBadge value={location.source_type} />{" "}
                  <StatusBadge value={location.status} />
                </p>
              )}
            </>
          )}
          {workflow.step === 3 && (
            <>
              <h3>
                {text("Kiểm tra trước khi gửi lệnh", "Review before sending")}
              </h3>
              <dl>
                <div>
                  <dt>{text("Sản phẩm", "Product")}</dt>
                  <dd>
                    {product?.name} · {product?.sku}
                  </dd>
                </div>
                <div>
                  <dt>{text("Số lượng", "Quantity")}</dt>
                  <dd>
                    {workflow.quantity} {product?.unit}
                  </dd>
                </div>
                <div>
                  <dt>{text("Vị trí", "Location")}</dt>
                  <dd>
                    {location?.path} / {location?.location_code}
                  </dd>
                </div>
              </dl>
              <p>
                <StatusBadge value={product?.source_type} />{" "}
                <StatusBadge
                  value={device?.online ? "Online" : "Unconfirmed"}
                />
              </p>
              <p>
                {text(
                  "IPC sẽ mở rack. Kiểm tra hàng thực tế trước khi xác nhận giao dịch; tồn kho chưa thay đổi khi chỉ gửi lệnh.",
                  "IPC will open the rack. Verify the physical goods before confirming; sending the command does not change stock.",
                )}
              </p>
              {!can("cabinet.view", product?.source_type) && (
                <p className="notice">
                  {text(
                    "Cần quyền xem cabinet để theo dõi lệnh thiết bị. Nhờ người quản trị cấp quyền phù hợp.",
                    "Cabinet view permission is required to track device execution. Ask your administrator for access.",
                  )}
                </p>
              )}
            </>
          )}
          <div className="wizard-actions">
            {workflow.step > 0 && (
              <button
                className="secondary"
                onClick={() => update({ step: workflow.step - 1 })}
              >
                {text("Quay lại", "Back")}
              </button>
            )}
            <button
              disabled={
                busy ||
                (workflow.step === 0 && !product) ||
                (workflow.step === 1 &&
                  (!Number.isInteger(Number(workflow.quantity)) ||
                    Number(workflow.quantity) < 1)) ||
                (workflow.step >= 2 && !location) ||
                (workflow.step === 3 &&
                  !can("cabinet.view", product?.source_type))
              }
              onClick={() =>
                workflow.step === 3
                  ? void dispatch()
                  : update({ step: workflow.step + 1 })
              }
            >
              {workflow.step === 3
                ? text("Gửi lệnh tới IPC", "Send to IPC")
                : text("Tiếp tục", "Continue")}
            </button>
          </div>
        </div>
      )}
      {workflow.step === 4 && (
        <div className="wizard-body">
          <h3>
            {workflow.product?.name} · {workflow.quantity}{" "}
            {workflow.product?.unit}
          </h3>
          <p>
            {workflow.location?.path} / {workflow.location?.location_code}
          </p>
          <StatusBadge value={operation?.execution_state || "Unconfirmed"} />
          <p>
            {ready
              ? text(
                  "Rack đã mở. Thực hiện nhập/xuất, kiểm đếm rồi xác nhận kết quả.",
                  "Rack is open. Receive/issue the goods, count them and confirm the outcome.",
                )
              : text(
                  "Đang chờ kết quả thật từ IPC. Không gửi lại lệnh hoặc xác nhận khi chưa kiểm tra thiết bị.",
                  "Waiting for actual IPC feedback. Do not repeat or confirm before checking the device.",
                )}
          </p>
          {operation?.error && (
            <ErrorState>{errorText(operation.error)}</ErrorState>
          )}
          {ready && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                {text(
                  "Đã kiểm đếm và hoàn thành thao tác hàng hóa",
                  "I counted the goods and completed the physical operation",
                )}
              </label>
              <label>
                {text("Ghi nhận kết quả thực tế", "Record the actual outcome")}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  required
                />
              </label>
              <button
                disabled={busy || !checked || !note.trim()}
                onClick={() => void confirm()}
              >
                {busy
                  ? text("Đang xác nhận…", "Confirming…")
                  : text(
                      "Xác nhận giao dịch hoàn tất",
                      "Confirm completed transaction",
                    )}
              </button>
            </>
          )}
          {["failed", "cancelled"].includes(operation?.state) && (
            <button
              className="secondary"
              onClick={() => {
                sessionStorage.removeItem(storageKey);
                setWorkflow({
                  kind: initialKind,
                  step: 0,
                  quantity: 1,
                  productId: "",
                  source,
                });
                setOperation(null);
                setError(null);
              }}
            >
              {text("Kết thúc giao dịch đã hủy", "Close resolved transaction")}
            </button>
          )}
          {!workflow.commandId && (
            <button disabled={busy} onClick={() => void dispatch()}>
              {text("Kiểm tra lại yêu cầu", "Reconcile request")}
            </button>
          )}
          <details>
            <summary>{text("Chi tiết kỹ thuật", "Technical details")}</summary>
            <p>{workflow.commandId || workflow.requestKey}</p>
            <p>
              {text(
                "Khi mất phản hồi, kiểm tra lại dùng cùng mã yêu cầu để tránh tạo lệnh trùng.",
                "Reconciliation reuses the same request key to avoid duplicate commands.",
              )}
            </p>
          </details>
          <button
            className="secondary"
            onClick={() =>
              navigate("Cabinets", {
                ipc_id: workflow.location.ipc_id,
                cabinet_id: workflow.location.cabinet_id,
                source_type: workflow.source,
              })
            }
          >
            {text(
              "Xem thiết bị và xử lý lệnh",
              "Inspect device and resolve command",
            )}
          </button>
        </div>
      )}
      {workflow.step === 5 && (
        <div className="wizard-body">
          <StatusBadge value="Completed" />
          <h3>{text("Giao dịch đã hoàn tất", "Transaction completed")}</h3>
          <p>
            {text(
              "Cabinet giữ trạng thái hiện tại. Kiểm tra khu vực và đóng rack tại trang thiết bị khi cần.",
              "Cabinet retains its current state. Inspect the area and close the rack on the devices page when needed.",
            )}
          </p>
          <button onClick={finish}>
            {text("Xem lịch sử", "View history")}
          </button>
        </div>
      )}
      {showSuccess && (
        <dialog
          ref={dialog}
          className="confirm-dialog transaction-success"
          onCancel={finish}
          aria-label={text("Giao dịch hoàn tất", "Transaction completed")}
        >
          <StatusBadge value="Completed" />
          <h2>
            {workflow.kind === "PUT"
              ? text("Nhập hàng thành công", "Stock received")
              : text("Xuất hàng thành công", "Stock issued")}
          </h2>
          <p>
            <strong>{workflow.product?.name}</strong> · {workflow.quantity}{" "}
            {workflow.product?.unit}
          </p>
          <p>{workflow.location?.path}</p>
          <time>{new Date(workflow.completedAt).toLocaleString()}</time>
          <div className="actions">
            <button onClick={finish}>{text("Xong", "Done")}</button>
          </div>
        </dialog>
      )}
    </section>
  );
}
