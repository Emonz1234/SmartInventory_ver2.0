import {
  t as uiText,
  errorText,
  statusText,
  useLanguage,
  LanguageSelector,
  fieldText,
  recordError,
} from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import Inventory from "./Inventory.jsx";
import OperationsDashboard from "./OperationsDashboard.jsx";
import StockWizard from "./StockWizard.jsx";
import Navigation from "./Navigation.jsx";
import { Categories, WarehouseOverview } from "./CatalogManagement.jsx";
import { DeviceTree, deviceStatus } from "./DeviceViews.jsx";
import RackCommands from "./RackCommands.jsx";
import {
  SourceBadge,
  DataTable,
  PageHeader,
  KpiCard,
  LoadingState,
  ConfirmButton,
  StatusBadge,
  DetailDrawer,
  TechnicalDetails,
} from "./ui.jsx";

async function api(path, method = "GET", data) {
  const csrf = document.cookie
    .split("; ")
    .find((x) => x.startsWith("csrftoken="))
    ?.split("=")[1];
  const response = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": decodeURIComponent(csrf || ""),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(
      value.error || `Request failed (${response.status})`,
    );
    error.response = { data: value, status: response.status };
    throw recordError(error);
  }
  return value;
}
const key = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(20)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
const pages = [
  ["Dashboard", "dashboard", "dashboard.view"],
  ["IPC Devices", "ipcs", "ipc.view"],
  ["Cabinets", "rack-status", "cabinet.view"],
  ["Racks", "rack-status", "cabinet.view"],
  ["Sync", "ipcs", "ipc.view"],
  ["Stock Operations", "inventory-overview", "inventory.move"],
  ["Environment", "environment", "environment.view"],
  ["Alarms", "alarms", "alarm.view"],
  ["Inventory", "goods", "inventory.view"],
  ["Warehouse Overview", "inventory-overview", "inventory.view"],
  ["Categories", "categories", "inventory.view"],
  ["Storage Map", "storage-locations", "inventory.view"],
  ["Transactions", "inventory-transactions", "inventory.view"],
  ["Audit Logs", "audit-logs", "audit.view"],
  ["Users", "users", "user.view"],
  ["Roles & Permissions", "roles", "role.manage"],
  ["Settings", "settings", "system.manage"],
];
const Badge = SourceBadge;
function Value({ value }) {
  useLanguage();
  if (value === null || value === undefined || value === "")
    return <span className="muted">—</span>;
  if (typeof value === "boolean")
    return (
      <span className={value ? "positive" : "muted"}>
        {value ? uiText("Yes") : uiText("No")}
      </span>
    );
  if (Array.isArray(value))
    return (
      <>
        {value.map((v, i) => (
          <div key={i}>
            <Value value={v} />
          </div>
        ))}
      </>
    );
  if (typeof value === "object")
    return (
      <span className="detail-value">
        {Object.entries(value).map(([k, v]) => (
          <span key={k}>
            <b>{fieldText(k)}:</b>{" "}
            {["error", "error_message", "message", "sync_error"].includes(k) ? (
              errorText(v)
            ) : [
                "state",
                "status",
                "kind",
                "severity",
                "execution_state",
                "operation_status",
                "sync_status",
              ].includes(k) ? (
              statusText(v)
            ) : (
              <Value value={v} />
            )}
            {" · "}
          </span>
        ))}
      </span>
    );
  return String(value);
}
function Table(props) {
  useLanguage();
  return (
    <DataTable {...props} renderValue={(value) => <Value value={value} />} />
  );
}
function Form({
  fields,
  submit,
  initial = {},
  label = "Lưu",
  disabled = false,
}) {
  useLanguage();
  const [working, setWorking] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const el = e.currentTarget;
        const formData = new FormData(el);
        const data = Object.fromEntries(formData);
        for (const f of fields) {
          if (f.multiple) data[f.name] = formData.getAll(f.name).map(Number);
          if (f.type === "number")
            data[f.name] = data[f.name] === "" ? null : Number(data[f.name]);
          if (f.type === "boolean") data[f.name] = data[f.name] === "true";
          if (f.type === "json") {
            try {
              data[f.name] = JSON.parse(data[f.name]);
            } catch {
              el.querySelector(`[name="${f.name}"]`).setCustomValidity(
                "JSON không hợp lệ",
              );
              el.reportValidity();
              return;
            }
          }
        }
        setWorking(true);
        try {
          await submit(data);
        } catch {
        } finally {
          setWorking(false);
        }
      }}
    >
      <fieldset disabled={disabled || working}>
        {fields.map((f) => (
          <label
            key={f.name}
            className={!f.optional ? "required-field" : undefined}
          >
            {f.label ? uiText(f.label) : fieldText(f.name)}
            {f.options ? (
              <select
                name={f.name}
                multiple={f.multiple}
                defaultValue={initial[f.name] ?? (f.multiple ? [] : "")}
                required={!f.optional}
              >
                {f.optional && !f.multiple && <option value="">—</option>}
                {f.options.map((o) => (
                  <option
                    key={typeof o === "object" ? o.value : o}
                    value={typeof o === "object" ? o.value : o}
                  >
                    {typeof o === "object" ? o.label : uiText(o)}
                  </option>
                ))}
              </select>
            ) : f.type === "json" || f.type === "textarea" ? (
              <textarea
                name={f.name}
                multiple={f.multiple}
                defaultValue={
                  typeof initial[f.name] === "object"
                    ? JSON.stringify(initial[f.name], null, 2)
                    : (initial[f.name] ?? "")
                }
                required={!f.optional}
                onChange={(e) => e.target.setCustomValidity("")}
              />
            ) : (
              <input
                name={f.name}
                type={f.type || "text"}
                min={f.type === "number" ? 0 : undefined}
                defaultValue={initial[f.name] ?? (f.multiple ? [] : "")}
                required={!f.optional}
                autoComplete={f.type === "password" ? "new-password" : "off"}
              />
            )}
          </label>
        ))}
        <button type="submit">
          {working ? uiText("Đang lưu…") : uiText(label)}
        </button>
      </fieldset>
    </form>
  );
}
const field = (name) => ({ name });
const number = (name, optional = false) => ({ name, type: "number", optional });
function App() {
  const language = useLanguage();
  const text = (vi, en) => (language === "en" ? en : vi);
  const pageLabels = {
    Dashboard: text("Tổng quan", "Overview"),
    "IPC Devices": "IPC",
    Inventory: text("Sản phẩm", "Products"),
    "Warehouse Overview": text("Tổng quan kho", "Warehouse overview"),
    Categories: text("Danh mục", "Categories"),
    "Stock Operations": text("Nhập / Xuất", "Receive / Issue"),
    Transactions: text("Lịch sử giao dịch", "Transaction history"),
    Cabinets: "Cabinets",
    Racks: "Racks",
    Sync: text("Đồng bộ", "Synchronization"),
    "Audit Logs": text("Nhật ký hệ thống", "System logs"),
    Environment: text("Môi trường", "Environment"),
    Alarms: text("Cảnh báo", "Alerts"),
    Users: text("Người dùng", "Users"),
    "Roles & Permissions": text("Phân quyền", "Permissions"),
    Settings: text("Cấu hình", "Settings"),
    "Storage Map": text("Vị trí kho", "Storage map"),
  };
  const descriptions = {
    Dashboard: text(
      "Tình trạng hệ thống và các việc cần xử lý.",
      "System status and your next actions.",
    ),
    Inventory: text(
      "Tìm hàng, xem vị trí và thực hiện nhập/xuất.",
      "Find products, inspect locations and receive or issue stock.",
    ),
    "Stock Operations": text(
      "Theo dõi từng bước, xác nhận bằng kết quả thực tế.",
      "Follow each step and confirm the actual outcome.",
    ),
    "IPC Devices": text(
      "Kết nối, đồng bộ và thiết bị do từng IPC quản lý.",
      "Connectivity, synchronization and devices managed by each IPC.",
    ),
    Cabinets: text(
      "Chọn cabinet và rack cần kiểm tra hoặc vận hành.",
      "Choose a cabinet and rack to inspect or operate.",
    ),
    Racks: text(
      "Trạng thái của từng rack, ưu tiên vấn đề cần xử lý.",
      "Individual rack status and issues that need attention.",
    ),
    Sync: text(
      "Kiểm tra IPC chưa đồng bộ trước khi vận hành.",
      "Review unsynchronized IPCs before operating.",
    ),
    Alarms: text(
      "Xem vị trí bị ảnh hưởng và xác nhận đã tiếp nhận cảnh báo.",
      "Review affected locations and acknowledge alerts.",
    ),
    Transactions: text(
      "Tra cứu kết quả và thời gian của giao dịch kho.",
      "Review stock transaction outcomes and times.",
    ),
  };
  const [session, setSession] = useState(null),
    [page, setPage] = useState("Dashboard"),
    [source, setSource] = useState("REAL");
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(null),
    [filters, setFilters] = useState({}),
    [version, setVersion] = useState(0);
  const [lookup, setLookup] = useState({}),
    [master, setMaster] = useState("shelves"),
    [edit, setEdit] = useState(false);
  const seq = useRef(0);
  const detailSequence = useRef(0);
  const can = (permission, scope = source) =>
    scope === "ALL"
      ? ["REAL", "SIMULATION", "ALL"].some((s) =>
          session?.grants?.[permission]?.includes(s),
        )
      : session?.grants?.[permission]?.some((s) => s === scope || s === "ALL");
  const canAll = (p) => session?.grants?.[p]?.includes("ALL");
  useEffect(() => {
    api("session")
      .then(setSession)
      .catch((e) => setError(e));
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    const current = pages.find((p) => p[0] === page);
    const target = session.grants?.[current[2]]?.length
      ? current
      : pages.find((p) => session.grants?.[p[2]]?.length);
    if (target) {
      if (target[0] !== page) setPage(target[0]);
      const scopes = session.grants[target[2]];
      if (!scopes.includes("ALL") && !scopes.includes(source))
        setSource(scopes[0]);
    }
  }, [session]);
  useEffect(() => {
    if (!session?.authenticated || !can(pages.find((p) => p[0] === page)[2]))
      return;
    const current = ++seq.current;
    let alive = true;
    const load = async () => {
      try {
        if (
          page === "Inventory" ||
          page === "Stock Operations" ||
          page === "Dashboard"
        ) {
          setData({});
          return;
        }
        const endpoint = pages.find((p) => p[0] === page)[1];
        const params = new URLSearchParams({
          source_type: source,
          ...Object.fromEntries(
            Object.entries(filters).filter(([, v]) => v !== ""),
          ),
        });
        const result = await api(endpoint + "?" + params);
        if (alive && current === seq.current) {
          setData(result);
          if (["Cabinets", "Racks", "Storage Map", "IPC Devices"].includes(page)) {
            setSelection((previous) =>
              previous
                ? result.find((row) => row.id === previous.id) || null
                : null,
            );
          }
          setError("");
        }
      } catch (e) {
        if (alive && current === seq.current) setError(e);
      }
    };
    setData(null);
    setLookup({});
    if (page === "Users" && session.grants["user.manage"]?.includes("ALL")) {
      api("roles")
        .then((roles) => {
          if (alive) setLookup({ roles });
        })
        .catch((e) => {
          if (alive) setError(e);
        });
    }
    load();
    const timer = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session, page, source, filters, version]);
  async function act(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      setNotice("Đã lưu thành công.");
      setVersion((v) => v + 1);
      return result;
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function open(row) {
    const detailRequest = ++detailSequence.current;
    setLookup({});
    setSelection(row);
    setEdit(false);
    if (page === "IPC Devices") {
      const requests = [];
      if (can("cabinet.view", row.source_type))
        requests.push([
          "groups",
          `cabinet-groups?source_type=${row.source_type}&ipc_id=${encodeURIComponent(row.id)}`,
        ]);
      if (can("alarm.view", row.source_type))
        requests.push([
          "alarms",
          `alarms?source_type=${row.source_type}&active=true`,
        ]);
      const result = await Promise.allSettled(
        requests.map(([, path]) => api(path)),
      );
      const details = {};
      requests.forEach(([name], index) => {
        if (result[index].status === "fulfilled")
          details[name] = result[index].value;
        else details[name + "Error"] = result[index].reason;
      });
      if (detailRequest === detailSequence.current) setLookup(details);
    }
  }

  function navigate(p, f = {}) {
    ++detailSequence.current;
    setError("");
    setData(null);
    setPage(p);
    if (f.source_type && ["REAL", "SIMULATION"].includes(f.source_type))
      setSource(f.source_type);
    setFilters(f);
    setSelection(null);
    setLookup({});
    setNotice("");
  }
  async function mutate(endpoint, method, d) {
    return act(() => api(endpoint, method, d));
  }
  if (!session)
    return (
      <main className="login">
        <LanguageSelector />
        <h1>Smart Inventory</h1>
        <p>{errorText(error) || uiText("Đang kết nối Server…")}</p>
      </main>
    );
  if (!session.authenticated)
    return (
      <main className="login">
        <LanguageSelector />
        <div className="logo">SI</div>
        <p className="eyebrow">{uiText("SMART INVENTORY / CONTROL CENTER")}</p>
        <h1>{uiText("Đăng nhập")}</h1>
        <p className="muted">
          {uiText("Quản lý thiết bị và hàng hóa tập trung.")}
        </p>
        {error && (
          <p role="alert" className="error">
            {errorText(error)}
          </p>
        )}
        <Form
          fields={[field("username"), { name: "password", type: "password" }]}
          label={uiText("Đăng nhập")}
          submit={(d) =>
            act(async () => {
              const s = await api("session", "POST", d);
              setSession(s);
              const first = pages.find((p) => s.grants[p[2]]?.length);
              if (first) setPage(first[0]);
            })
          }
        />
      </main>
    );
  const rows = (Array.isArray(data) ? data : []).filter(
    (row) =>
      (!filters.device_id || row.id === filters.device_id) &&
      (!filters.alert_id || String(row.id) === String(filters.alert_id)) &&
      (!filters.transaction_id ||
        String(row.request_key || row.id) === String(filters.transaction_id)),
  );
  const permission = pages.find((p) => p[0] === page)[2];
  return (
    <Navigation session={session} page={page} source={source} labels={pageLabels} pages={pages} can={can} api={api} navigate={navigate}
      logout={() => act(async () => setSession(await api("session", "DELETE"))).catch(() => {})}>
      <main>
        <PageHeader
          title={pageLabels[page] || uiText(page)}
          description={
            descriptions[page] ||
            text(
              "Tra cứu và quản lý dữ liệu theo quyền được cấp.",
              "Review and manage data within your permissions.",
            )
          }
        >
          <label className="source-filter">
            {" "}
            {uiText("Nguồn dữ liệu")}{" "}
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setData(null);
                setLookup({});
                setSelection(null);
                setFilters({});
              }}
            >
              <option value="REAL">{uiText("[REAL] Thực tế")}</option>
              <option value="SIMULATION">{uiText("[SIM] Mô phỏng")}</option>
              <option value="ALL">{uiText("ALL · Tất cả")}</option>
            </select>
          </label>
        </PageHeader>
        <div className="toolbar">
          <span>
            <Badge source={source} />{" "}
            {source === "REAL"
              ? uiText("Ưu tiên dữ liệu thực tế")
              : source === "SIMULATION"
                ? uiText("Dữ liệu mô phỏng")
                : uiText("Thực tế trước, mô phỏng sau")}
          </span>
          <button
            className="secondary"
            onClick={() => setVersion((v) => v + 1)}
          >
            {" "}
            {uiText("Làm mới")}{" "}
          </button>
        </div>
        {error && (
          <div role="alert" className="error">
            <strong>
              {text(
                "Không thể cập nhật màn hình",
                "Could not update this page",
              )}
              : {pageLabels[page]}
            </strong>
            <p>{errorText(error)}</p>
            <p>
              {text(
                "Dữ liệu hiện tại có thể chưa mới nhất. Kiểm tra kết nối rồi thử lại.",
                "Displayed data may be stale. Check connectivity and retry.",
              )}
            </p>
            <button
              className="secondary"
              onClick={() => setVersion((v) => v + 1)}
            >
              {text("Thử lại", "Retry")}
            </button>
          </div>
        )}
        {notice && (
          <p role="status" className="notice">
            {uiText(notice)}
          </p>
        )}
        {busy && <p role="status">{uiText("Đang xử lý…")}</p>}
        {!can(permission) && (
          <p className="empty">
            {" "}
            {uiText(
              "Bạn không có quyền xem nguồn đã chọn. Hãy đổi bộ lọc nguồn.",
            )}{" "}
          </p>
        )}
        {data === null && !error && can(permission) && <LoadingState />}
        {can(permission) && (
          <>
            {page === "Dashboard" && can("dashboard.view") && (
              <OperationsDashboard
                api={api}
                source={source}
                can={can}
                navigate={navigate}
                version={version}
              />
            )}
            {page === "Categories" && <Categories api={api} source={source} session={session} />}
            {page === "Warehouse Overview" && <WarehouseOverview api={api} source={source} navigate={navigate} />}
            {page === "Stock Operations" &&
              can("inventory.view") &&
              can("inventory.move") && (
                <StockWizard
                  key={session.username}
                  api={api}
                  source={source}
                  session={session}
                  can={can}
                  navigate={navigate}
                  initialKind={filters.kind || "PUT"}
                  initialProduct={filters.product_id}
                />
              )}
            {page === "Stock Operations" && !can("inventory.view") && (
              <p className="notice">
                {text(
                  "Cần quyền xem hàng hóa để chọn sản phẩm.",
                  "Inventory view permission is required to select a product.",
                )}
              </p>
            )}
            {page === "Sync" && can("ipc.view") && (
              <section>
                <h2>{text("Trạng thái đồng bộ IPC", "IPC synchronization")}</h2>
                <p className="muted">
                  {text(
                    "Đồng bộ phản ánh xác nhận dữ liệu của IPC, không phải xác nhận hoàn tất giao dịch.",
                    "Synchronization reflects IPC dataset acknowledgement, not physical transaction completion.",
                  )}
                </p>
                <Table
                  rows={rows}
                  columns={[
                    "name",
                    "source_type",
                    "online",
                    "synchronized",
                    "last_sync",
                    "last_seen",
                  ]}
                  onSelect={(row) =>
                    navigate("IPC Devices", { device_id: row.id })
                  }
                />
              </section>
            )}
            {page === "IPC Devices" && (
              <>
                <section>
                  <h2>{uiText("Kết nối và đồng bộ")}</h2>
                  <Table
                    rows={rows.map((row) => ({
                      ...row,
                      status: deviceStatus(row),
                    }))}
                    onSelect={open}
                    columns={[
                      "name",
                      "source_type",
                      "status",
                      "cabinet_group_count",
                      "racks",
                      "synchronized",
                      "last_seen",
                    ]}
                  />
                </section>
                {selection && (
                  <DetailDrawer
                    title={selection.name}
                    onClose={() => setSelection(null)}
                  >
                    <p className="breadcrumb">
                      <button
                        className="link"
                        onClick={() => setSelection(null)}
                      >
                        IPC
                      </button>{" "}
                      → {selection.name}
                    </p>
                    <p>
                      <Badge source={selection.source_type} />{" "}
                      <StatusBadge
                        value={
                          lookup.alarms?.some(
                            (a) => a.device_id === selection.id,
                          )
                            ? "Error"
                            : deviceStatus(selection)
                        }
                      />
                    </p>
                    <dl>
                      <div>
                        <dt>
                          {text("Bản ghi chờ đồng bộ", "Records pending sync")}
                        </dt>
                        <dd>{selection.pending_sync ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>{text("Lỗi đang hoạt động", "Active errors")}</dt>
                        <dd>
                          {selection.active_errors ??
                            (lookup.alarms
                              ? lookup.alarms.filter(
                                  (a) => a.device_id === selection.id,
                                ).length
                              : "—")}
                        </dd>
                      </div>
                      <div>
                        <dt>IPC</dt>
                        <dd>{selection.id}</dd>
                      </div>
                      <div>
                        <dt>{text("Cabinet / Rack", "Cabinet / Rack")}</dt>
                        <dd>
                          {selection.cabinet_group_count} / {selection.racks}
                        </dd>
                      </div>
                      <div>
                        <dt>{text("Lần cuối kết nối", "Last seen")}</dt>
                        <dd>
                          {selection.last_seen
                            ? new Date(selection.last_seen).toLocaleString()
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>{text("Đồng bộ", "Synchronization")}</dt>
                        <dd>
                          <StatusBadge
                            value={
                              selection.synchronized ? "Synced" : "Pending"
                            }
                          />
                        </dd>
                      </div>
                    </dl>
                    {lookup.alarmsError && (
                      <p className="error">
                        {text(
                          "Chưa xác minh được cảnh báo của IPC.",
                          "IPC alerts could not be verified.",
                        )}
                      </p>
                    )}
                    {lookup.groupsError && (
                      <p className="error">
                        {text(
                          "Chưa tải được danh sách cabinet.",
                          "Cabinet list could not be loaded.",
                        )}
                      </p>
                    )}
                    {can("cabinet.view", selection.source_type) && (
                      <Table
                        rows={lookup.groups || []}
                        columns={[
                          "name",
                          "source_type",
                          "code",
                          "configuration_status",
                          "racks",
                        ]}
                        onSelect={(r) =>
                          navigate("Cabinets", {
                            cabinet_id: r.id,
                            ipc_id: selection.id,
                          })
                        }
                      />
                    )}
                    {can("ipc.manage", selection.source_type) && (
                      <Form
                        fields={[
                          field("name"),
                          {
                            name: "enabled",
                            type: "boolean",
                            options: ["true", "false"],
                          },
                        ]}
                        initial={selection}
                        submit={(d) =>
                          mutate("ipcs", "PATCH", {
                            ...d,
                            device_id: selection.id,
                          })
                        }
                      />
                    )}
                    <TechnicalDetails>
                      <Table
                        rows={[selection]}
                        columns={[
                          "id",
                          "mqtt_connected",
                          "serial_connected",
                          "last_sync",
                          "enabled",
                        ]}
                      />
                    </TechnicalDetails>
                  </DetailDrawer>
                )}
                {can("ipc.manage") && (
                  <section>
                    <TechnicalDetails title={uiText("Đăng ký IPC")}>
                      <h2>{uiText("Đăng ký IPC")}</h2>
                      <Form
                        fields={[
                          field("device_id"),
                          field("name"),
                          {
                            name: "source_type",
                            options: ["REAL", "SIMULATION"],
                          },
                        ]}
                        initial={{
                          source_type: source === "ALL" ? "REAL" : source,
                        }}
                        submit={(d) =>
                          act(async () => {
                            await api("ipcs", "POST", d);
                          })
                        }
                      />
                    </TechnicalDetails>
                  </section>
                )}
              </>
            )}
            {["Cabinets", "Racks"].includes(page) && (
              <>
                <section>
                  <h2> {uiText("IPC → Cabinet Group → Rack")} </h2>
                  <Form
                    fields={[
                      { name: "ipc_id", optional: true },
                      number("cabinet_id", true),
                    ]}
                    initial={filters}
                    label={uiText("Lọc")}
                    submit={(d) =>
                      setFilters(
                        Object.fromEntries(
                          Object.entries(d).filter(([, v]) => v),
                        ),
                      )
                    }
                  />
                  {page === "Cabinets" && (
                    <DeviceTree rows={rows.map(row=>({...row,status:deviceStatus(row)}))} onSelect={open} />
                  )}
                  {page === "Racks" && (
                    <Table
                      rows={rows.map(row=>({...row,status:deviceStatus(row)}))}
                      onSelect={open}
                      columns={[
                        "name",
                        "source_type",
                        "ipc_id",
                        "cabinet",
                        "online",
                        "status",
                        "last_update",
                      ]}
                    />
                  )}
                </section>
                {selection && (
                  <DetailDrawer
                    title={selection.name}
                    onClose={() => setSelection(null)}
                  >
                    <p className="breadcrumb">
                      {" "}
                      {uiText("Dashboard →")} {selection.ipc_id} →{" "}
                      {selection.cabinet} → {selection.name}
                    </p>
                    <h2>
                      {selection.name} <Badge source={selection.source_type} />
                    </h2>
                    <p>
                      <StatusBadge value={deviceStatus(selection)} />
                    </p>
                    <TechnicalDetails>
                      <dl>
                        {[
                          "temperature",
                          "humidity",
                          "weight",
                          "smoke",
                          "movement_speed",
                          "displacement",
                          "is_hard_locked",
                          "is_endpoint",
                          "is_obstructed",
                          "is_overload_motor",
                          "is_skewed",
                        ].map((k) => (
                          <div key={k}>
                            <dt>{fieldText(k)}</dt>
                            <dd>
                              {[
                                "error",
                                "error_message",
                                "message",
                                "sync_error",
                              ].includes(k) ? (
                                errorText(selection[k])
                              ) : [
                                  "status",
                                  "status",
                                  "kind",
                                  "severity",
                                  "execution_state",
                                ].includes(k) ? (
                                statusText(selection[k])
                              ) : (
                                <Value value={selection[k]} />
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </TechnicalDetails>
                    <RackCommands
                      key={selection.id}
                      rack={selection}
                      api={api}
                      allowed={can("cabinet.control", selection.source_type)}
                    />
                    <p className="muted">
                      {" "}
                      {uiText(
                        "Lệnh được gửi qua MQTT; trạng thái gửi chưa xác nhận thao tác vật lý.",
                      )}{" "}
                    </p>
                  </DetailDrawer>
                )}
                <OperationPanel
                  initialId={filters.operation_id}
                  source={source}
                  can={can}
                  act={act}
                  version={version}
                />
                {can("ipc.manage") && (
                  <section>
                    <TechnicalDetails title={uiText("Cấu hình cabinet / rack")}>
                      <h2>{uiText("Cấu hình cabinet / rack")}</h2>
                      <Form
                        fields={[
                          number("id"),
                          field("name"),
                          { name: "area", optional: true },
                          { name: "description", optional: true },
                        ]}
                        submit={(d) => mutate("cabinets", "PATCH", d)}
                      />
                      <h3>{uiText("Phân công cabinet cho IPC")}</h3>
                      <Form
                        fields={[
                          number("cabinet_id"),
                          { name: "device_id", optional: true },
                        ]}
                        submit={(d) => mutate("assignments", "POST", d)}
                      />
                    </TechnicalDetails>
                  </section>
                )}
              </>
            )}
            {page === "Environment" && (
              <section className="environment-panel">
                <h2>{uiText("Lịch sử môi trường")}</h2>
                <Form
                  fields={[
                    { name: "ipc_id", optional: true },
                    number("cabinet_id", true),
                    number("rack_id", true),
                    { name: "from", type: "datetime-local", optional: true },
                    { name: "to", type: "datetime-local", optional: true },
                  ]}
                  label={uiText("Lọc dữ liệu")}
                  submit={(d) => {
                    for (const k of ["from", "to"])
                      if (d[k]) d[k] = new Date(d[k]).toISOString();
                    setFilters(
                      Object.fromEntries(
                        Object.entries(d).filter(([, v]) => v),
                      ),
                    );
                  }}
                />
                <Table
                  rows={rows.map((r) => ({ ...r, ...r.values }))}
                  columns={[
                    "created_at",
                    "source_type",
                    "device_id",
                    "rack_id",
                    "temperature",
                    "humidity",
                    "weight",
                    "smoke",
                  ]}
                />
              </section>
            )}
            {page === "Alarms" && (
              <section>
                <h2>{uiText("Cảnh báo")}</h2>
                <select
                  aria-label={uiText("Alarm status")}
                  value={filters.active || ""}
                  onChange={(e) => setFilters({ active: e.target.value })}
                >
                  <option value="">{uiText("Tất cả trạng thái")}</option>
                  <option value="true">{uiText("Active")}</option>
                  <option value="false">{uiText("Cleared")}</option>
                </select>
                <Table
                  rows={rows}
                  columns={[
                    "id",
                    "source_type",
                    "severity",
                    "code",
                    "device_id",
                    "rack_id",
                    "active",
                    "created_at",
                    "acknowledged_at",
                    "cleared_at",
                  ]}
                  actions={(r) => (
                    <>
                      <button
                        className="secondary"
                        onClick={() => setSelection(r)}
                      >
                        {text("Xem chi tiết", "View details")}
                      </button>
                      {can("alarm.acknowledge", r.source_type) && (
                        <button
                          disabled={
                            !!r.acknowledged_at ||
                            busy ||
                            !can("alarm.acknowledge", r.source_type)
                          }
                          onClick={() =>
                            mutate(
                              `alarms/${r.id}/acknowledge`,
                              "POST",
                              {},
                            ).catch(() => {})
                          }
                        >
                          {r.acknowledged_at
                            ? text("Đã tiếp nhận", "Acknowledged")
                            : text("Tiếp nhận cảnh báo", "Acknowledge alert")}
                        </button>
                      )}
                    </>
                  )}
                />
              </section>
            )}
            {page === "Alarms" && selection && (
              <DetailDrawer
                title={selection.code}
                onClose={() => setSelection(null)}
              >
                <p>
                  <StatusBadge value={selection.source_type} />{" "}
                  <StatusBadge value={selection.active ? "Error" : "Ready"} />
                </p>
                <p>
                  {selection.device_id} / Rack {selection.rack_id || "—"}
                </p>
                <p>{new Date(selection.created_at).toLocaleString()}</p>
                <p>
                  {selection.active
                    ? text(
                        "Cảnh báo đang hoạt động. Kiểm tra khu vực bị ảnh hưởng và xử lý nguyên nhân tại thiết bị. Tiếp nhận cảnh báo không tự xóa lỗi.",
                        "Active alert. Inspect the affected area and resolve the cause at the device. Acknowledging does not clear the fault.",
                      )
                    : text(
                        "Cảnh báo đã kết thúc. Kiểm tra thiết bị trước khi tiếp tục thao tác.",
                        "Alert has cleared. Check the device before continuing.",
                      )}
                </p>
                {can("ipc.view", selection.source_type) && (
                  <button
                    onClick={() =>
                      navigate("IPC Devices", {
                        device_id: selection.device_id,
                      })
                    }
                  >
                    {text("Xem thiết bị", "View device")}
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => navigate("Dashboard")}
                >
                  {text("Về tổng quan", "Return to overview")}
                </button>
                <TechnicalDetails>
                  <Value value={selection} />
                </TechnicalDetails>
              </DetailDrawer>
            )}
            {page === "Inventory" && (
              <Inventory
                api={api}
                source={source}
                setSource={setSource}
                session={session}
                can={can}
                version={version}
                navigate={navigate}
                initialProduct={filters.product_id}
              />
            )}
            {page === "Storage Map" && (
              <>
                <section>
                  <h2>{uiText("Vị trí lưu trữ")}</h2>
                  <p className="legend">
                    {uiText("○ Empty · ● Occupied · ▣ Reserved")}
                  </p>
                  {Object.entries(
                    Object.groupBy(
                      rows,
                      (r) =>
                        `${r.source_type} · ${r.area || "Site chưa đặt tên"} / ${r.cabinet} / ${r.rack} / ${r.shelf}`,
                    ),
                  ).map(([group, locations]) => (
                    <div className="storage-group" key={group}>
                      <h3>{uiText(group)}</h3>
                      <div className="positions">
                        {locations.map((r) => (
                          <button
                            className={"position " + r.status}
                            key={r.id}
                            onClick={() => setSelection(r)}
                          >
                            <Badge source={r.source_type} />
                            <strong>{r.code}</strong>
                            <span>{uiText(r.status)}</span>
                            <small>#{r.id}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!rows.length && (
                    <p className="empty">
                      {uiText("Chưa cấu hình vị trí lưu trữ.")}
                    </p>
                  )}
                  {selection && (
                    <DetailDrawer
                      title={selection.code}
                      onClose={() => setSelection(null)}
                    >
                      <h3>
                        {selection.code}{" "}
                        <Badge source={selection.source_type} />
                      </h3>
                      <Table
                        rows={selection.goods}
                        columns={["item_id", "item__name", "quantity"]}
                      />
                      <button
                        disabled={
                          !can("inventory.update", selection.source_type) ||
                          busy
                        }
                        onClick={() =>
                          mutate("storage-locations", "PATCH", {
                            id: selection.id,
                            reserved: selection.status !== "reserved",
                          })
                            .then((r) => setSelection(r))
                            .catch(() => {})
                        }
                      >
                        {selection.status === "reserved"
                          ? uiText("Bỏ giữ chỗ")
                          : uiText("Giữ chỗ")}
                      </button>
                    </DetailDrawer>
                  )}
                </section>
                {can("inventory.create") && (
                  <section>
                    <h2>{uiText("Thêm vị trí theo topology")}</h2>
                    <label>
                      {" "}
                      {uiText("Loại")}{" "}
                      <select
                        value={master}
                        onChange={(e) => setMaster(e.target.value)}
                      >
                        <option value="shelves">
                          {uiText("Shelf / Compartment")}
                        </option>
                        <option value="bins">{uiText("Position")}</option>
                      </select>
                    </label>
                    <Form
                      key={master}
                      fields={
                        master === "shelves"
                          ? [number("rack_id"), field("code"), number("level")]
                          : [
                              number("shelf_id"),
                              field("code"),
                              number("capacity"),
                            ]
                      }
                      submit={(d) => mutate(master, "POST", d)}
                    />
                  </section>
                )}
              </>
            )}
            {page === "Transactions" && (
              <>
                <section>
                  <div className="section-heading">
                    <h2>{text("Nhập / xuất hàng", "Receive / issue stock")}</h2>
                    {can("inventory.move") && (
                      <button onClick={() => navigate("Stock Operations")}>
                        {text("Bắt đầu giao dịch", "Start transaction")}
                      </button>
                    )}
                  </div>
                  {can("inventory.move") && (
                    <TechnicalDetails
                      title={text(
                        "Ghi nhận thủ công / chuyển / mượn / trả",
                        "Manual recording / move / borrow / return",
                      )}
                    >
                      <h3>{uiText("Ghi nhận giao dịch kho")}</h3>
                      <p>
                        {" "}
                        {uiText(
                          "Chỉ xác nhận sau khi kiểm tra hàng hóa thực tế. Để chỉnh tồn, mở Inventory → chi tiết sản phẩm → Inventory Adjustment. RETURN phải tham chiếu giao dịch BORROW.",
                        )}{" "}
                      </p>
                      <Form
                        disabled={!can("inventory.move") || busy}
                        fields={[
                          {
                            name: "kind",
                            options: [
                              "INBOUND",
                              "OUTBOUND",
                              "MOVE",
                              "BORROW",
                              "RETURN",
                            ],
                          },
                          number("item_id"),
                          number("quantity"),
                          number("from_location_id", true),
                          number("to_location_id", true),
                          number("borrow_id", true),
                          field("note"),
                        ]}
                        submit={(d) =>
                          mutate("inventory-transactions", "POST", {
                            ...d,
                            request_key: key(),
                          })
                        }
                      />
                    </TechnicalDetails>
                  )}
                </section>
                <section>
                  <h2>{uiText("Lịch sử giao dịch")}</h2>
                  <Table
                    rows={rows}
                    columns={[
                      "id",
                      "source_type",
                      "kind",
                      "item_id",
                      "quantity",
                      "from_location_id",
                      "to_location_id",
                      "borrow_id",
                      "actor_id",
                      "note",
                      "created_at",
                    ]}
                  />
                </section>
              </>
            )}
            {page === "Audit Logs" && (
              <section>
                <h2>{uiText("Nhật ký kiểm toán")}</h2>
                <Table
                  rows={rows}
                  columns={[
                    "created_at",
                    "source_type",
                    "actor_id",
                    "action",
                    "resource",
                    "object_id",
                    "before",
                    "after",
                    "result",
                  ]}
                />
              </section>
            )}
            {page === "Users" && (
              <section>
                <h2>{uiText("Người dùng")}</h2>
                <Table
                  rows={rows}
                  onSelect={(r) => {
                    setSelection(r);
                    setEdit(true);
                  }}
                  columns={["id", "username", "is_active", "roles"]}
                />
                {canAll("user.manage") && (
                  <>
                    <h3>
                      {edit
                        ? uiText("Cập nhật người dùng")
                        : uiText("Tạo người dùng")}
                    </h3>
                    <button
                      className="secondary"
                      onClick={() => {
                        setEdit(false);
                        setSelection(null);
                      }}
                    >
                      {" "}
                      {uiText("Tạo mới")}{" "}
                    </button>
                    <Form
                      key={edit ? selection?.id : "new"}
                      disabled={!canAll("user.manage")}
                      initial={
                        edit ? selection : { roles: [], is_active: true }
                      }
                      fields={[
                        ...(!edit ? [field("username")] : []),
                        { name: "password", type: "password", optional: edit },
                        {
                          name: "is_active",
                          type: "boolean",
                          options: ["true", "false"],
                        },
                        {
                          name: "roles",
                          label: "Roles",
                          multiple: true,
                          optional: true,
                          options: (lookup.roles || []).map((r) => ({
                            value: r.id,
                            label: r.name,
                          })),
                        },
                      ]}
                      submit={(d) =>
                        mutate("users", edit ? "PATCH" : "POST", {
                          ...d,
                          ...(edit ? { id: selection.id } : {}),
                        })
                      }
                    />
                  </>
                )}
              </section>
            )}
            {page === "Roles & Permissions" && (
              <section>
                <h2>{uiText("Roles & Permissions")}</h2>
                <p>
                  {" "}
                  {uiText(
                    "Scope: REAL, SIMULATION hoặc ALL. Quyền được kiểm tra tại backend.",
                  )}{" "}
                </p>
                <Table
                  rows={rows}
                  onSelect={(r) => {
                    setSelection(r);
                    setEdit(true);
                  }}
                  columns={["id", "name", "permissions"]}
                />
                <h3>{edit ? uiText("Cập nhật role") : uiText("Tạo role")}</h3>
                <button
                  className="secondary"
                  onClick={() => {
                    setEdit(false);
                    setSelection(null);
                  }}
                >
                  {" "}
                  {uiText("Tạo mới")}{" "}
                </button>
                <RoleForm
                  key={edit ? selection?.id : "new"}
                  initial={edit ? selection : null}
                  submit={(d) =>
                    mutate("roles", edit ? "PATCH" : "POST", {
                      ...d,
                      ...(edit ? { id: selection.id } : {}),
                    })
                  }
                />
              </section>
            )}
            {page === "Settings" && data && (
              <section>
                <h2>{uiText("Ngưỡng cảnh báo")}</h2>
                <dl>
                  {Object.entries(data).map(([k, v]) => (
                    <div key={k}>
                      <dt>{fieldText(k)}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <Form
                  fields={[
                    {
                      name: "key",
                      options: ["temperature_max", "humidity_max"],
                    },
                    number("value"),
                  ]}
                  submit={(d) => mutate("settings", "PATCH", d)}
                />
                <p className="muted">
                  {" "}
                  {uiText(
                    "Ngưỡng áp dụng khi nhận mẫu telemetry tiếp theo.",
                  )}{" "}
                </p>
              </section>
            )}
            {["Environment", "Alarms", "Transactions", "Audit Logs"].includes(
              page,
            ) && (
              <div className="toolbar">
                <button
                  className="secondary"
                  disabled={!Number(filters.offset || 0)}
                  onClick={() =>
                    setFilters({
                      ...filters,
                      offset: Math.max(0, Number(filters.offset || 0) - 200),
                    })
                  }
                >
                  {" "}
                  {uiText("Trang trước")}{" "}
                </button>
                <span>
                  {" "}
                  {uiText("Trang")}{" "}
                  {Math.floor(Number(filters.offset || 0) / 200) + 1}
                </span>
                <button
                  className="secondary"
                  disabled={rows.length < 200}
                  onClick={() =>
                    setFilters({
                      ...filters,
                      offset: Number(filters.offset || 0) + 200,
                    })
                  }
                >
                  {" "}
                  {uiText("Trang sau")}{" "}
                </button>
              </div>
            )}
          </>
        )}
        <footer>
          {" "}
          {uiText(
            "SMART INVENTORY · Server-managed inventory · Auto refresh 10s",
          )}{" "}
        </footer>
      </main>
    </Navigation>
  );
}
function RoleForm({ initial, submit }) {
  useLanguage();
  const [permissions, setPermissions] = useState([]),
    [grants, setGrants] = useState(initial?.permissions || []),
    [name, setName] = useState(initial?.name || ""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("permissions")
      .then(setPermissions)
      .catch(() => {});
  }, []);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await submit({ name, permissions: grants });
        } catch {
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {" "}
        {uiText("Role name")}{" "}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <div className="permission-grid">
        {permissions.map((p) => (
          <label key={p}>
            {p}
            <select
              value={grants.find((g) => g.permission === p)?.scope || ""}
              onChange={(e) =>
                setGrants([
                  ...grants.filter((g) => g.permission !== p),
                  ...(e.target.value
                    ? [{ permission: p, scope: e.target.value }]
                    : []),
                ])
              }
            >
              <option value="">{uiText("Không cấp")}</option>
              {["REAL", "SIMULATION", "ALL"].map((s) => (
                <option key={s} value={s}>
                  {uiText(s)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button disabled={busy}>{uiText("Lưu role")}</button>
    </form>
  );
}
function OperationPanel({ source, can, act, version, initialId }) {
  useLanguage();
  const [rows, setRows] = useState([]),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      api("operations?source_type=" + source)
        .then((r) => {
          if (live) {
            setRows(r);
            setSelected(previous => r.find(row => String(row.id) === String(previous?.id || initialId)) || null);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e);
        });
    setSelected(null);
    load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [source, version, initialId]);
  return (
    <section>
      <h2>{uiText("Trạng thái thao tác thiết bị")}</h2>
      {error && <p className="error">{errorText(error)}</p>}
      <Table
        rows={rows}
        columns={[
          "kind",
          "source_type",
          "device_id",
          "rack_id",
          "execution_state",
          "created_at",
        ]}
        onSelect={setSelected}
      />
      {selected && (
        <>
          <h3>
            {uiText("Xác nhận kết quả #")}
            {selected.id}
          </h3>
          <Form
            disabled={
              !can(
                selected.kind &&
                  ["PUT", "PICK", "ADJUST"].includes(selected.kind)
                  ? "inventory.move"
                  : "cabinet.control",
                selected.source_type,
              )
            }
            fields={[
              field("note"),
              { name: "success", type: "boolean", options: ["true", "false"] },
            ]}
            submit={(d) =>
              act(() => api(`operations/${selected.id}/confirm`, "POST", d))
            }
          />
        </>
      )}
    </section>
  );
}
createRoot(document.getElementById("root")).render(<App />);
