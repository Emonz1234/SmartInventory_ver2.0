import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

async function api(path, method = "GET", data) {
  const csrf = document.cookie
    .split("; ")
    .find((v) => v.startsWith("csrftoken="))
    ?.split("=")[1];
  const response = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf || "" },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Request failed");
  return value;
}

function Form({ fields, onSubmit, label = "Lưu", defaults = {}, disabled = false }) {
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const el = e.currentTarget;
        const data = Object.fromEntries(new FormData(el));
        fields.forEach((f) => {
          if (f.type === "boolean") data[f.name] = data[f.name] === "true";
          if (f.type === "number" && data[f.name] !== "")
            data[f.name] = Number(data[f.name]);
          else if (f.type === "number" && f.optional && data[f.name] === "") data[f.name] = null;
        });
        try {
          await onSubmit(data);
          el.reset();
        } catch {}
      }}
    >
      <fieldset disabled={disabled}>{fields.map((f) => (
        <label key={f.name}>
          {f.label || f.name}
          {f.options ? (
            <select
              aria-label={f.label || f.name}
              name={f.name}
              defaultValue={defaults[f.name]}
            >
              {f.options.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={f.label || f.name}
              name={f.name}
              type={f.type || "text"}
              defaultValue={defaults[f.name]}
              required={!f.optional}
              min={f.type === "number" ? 0 : undefined}
              autoComplete={f.type === "password" ? "current-password" : "off"}
            />
          )}
        </label>
      ))}
      <button>{label}</button></fieldset>
    </form>
  );
}

function Table({ rows, columns }) {
  if (!rows.length) return <p className="empty">Chưa có dữ liệu.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || r.device_id || i}>
              {columns.map((c) => (
                <td key={c}>
                  {typeof r[c] === "boolean" ? (
                    <span className={r[c] ? "good" : "muted"}>
                      {r[c] ? "Có" : "Không"}
                    </span>
                  ) : typeof r[c] === "object" ? (
                    JSON.stringify(r[c])
                  ) : (
                    String(r[c] ?? "—")
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const schemas = {
  cabinets: [
    { name: "code" },
    { name: "name" },
    { name: "description", optional: true },
    { name: "domain", options: ["IPC", "IPCSIM"] },
    { name: "group", optional: true },
  ],
  racks: [
    { name: "cabinet_id", type: "number" },
    { name: "address", type: "number" },
    { name: "name" },
  ],
  shelves: [
    { name: "rack_id", type: "number" },
    { name: "code" },
    { name: "level", type: "number" },
  ],
  bins: [
    { name: "shelf_id", type: "number" },
    { name: "code" },
    { name: "capacity", type: "number" },
  ],
  items: [
    { name: "code" },
    { name: "name" },
    { name: "unit" },
    { name: "category_id", type: "number", optional: true },
    { name: "description", optional: true },
    { name: "is_active", type: "boolean", options: ["true", "false"] },
    { name: "min_qty", type: "number" },
    { name: "max_qty", type: "number" },
  ],
  categories: [{ name: "code" }, { name: "name" }, { name: "description", optional: true }],
};

function App() {
  const [session, setSession] = useState(null),
    [page, setPage] = useState("Tổng quan"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [devices, setDevices] = useState([]),
    [stock, setStock] = useState([]),
    [ops, setOps] = useState([]),
    [events, setEvents] = useState([]),
    [ledger, setLedger] = useState([]);
  const [domain, setDomain] = useState("IPC"),
    [resource, setResource] = useState("items"),
    [records, setRecords] = useState([]),
    [busy, setBusy] = useState(false);
  const [selectedOp, setSelectedOp] = useState("");
  const [editId, setEditId] = useState('');
  const [auditRows, setAuditRows] = useState([]);
  const can = (permission) => session?.permissions?.includes('inventory.' + permission);
  const modelName = resource === 'categories' ? 'category' : resource.slice(0, -1);
  const [dataReady, setDataReady] = useState(false);
  const loadSequence = useRef(0);
  useEffect(() => {
    api("session")
      .then(setSession)
      .catch((e) => setError(e.message));
  }, []);
  async function load() {
    const sequence = ++loadSequence.current;
    try {
      const [d, s, o] = await Promise.all([
        api("devices"),
        api("inventory?domain=" + domain),
        api("operations"),
      ]);
      const master = page === "Danh mục" ? await api(resource) : [];
      const logs =
        page === "Nhật ký"
          ? await Promise.all([api("events"), api("ledger")])
          : [[], []];
      if (sequence !== loadSequence.current) return;
      setDevices(d);
      setStock(s);
      setOps(o);
      setRecords(master);
      setEvents(logs[0]);
      setLedger(logs[1]);
      if (page === 'Nhật ký' && can('view_auditlog')) setAuditRows(await api('audit'));
      setDataReady(true);
    } catch (e) {
      if (sequence === loadSequence.current) setError(e.message);
    }
  }
  useEffect(() => {
    if (!session?.authenticated) return;
    setDataReady(false);
    load();
    const id = setInterval(load, 5000);
    return () => {
      clearInterval(id);
      ++loadSequence.current;
    };
  }, [session, domain, page, resource]);
  async function act(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await fn();
      await load();
      return value;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  if (session === null)
    return (
      <main className="login">
        <h1>Control Center</h1>
        <p role="status">Đang kết nối Server…</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </main>
    );
  if (!session?.authenticated)
    return (
      <main className="login">
        <div className="brand">SI / SMART INVENTORY</div>
        <h1>Control Center</h1>
        <p>Đăng nhập tài khoản quản lý kho.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Form
          fields={[
            { name: "username", label: "Tên đăng nhập" },
            { name: "password", label: "Mật khẩu", type: "password" },
          ]}
          label="Đăng nhập"
          onSubmit={(d) =>
            act(async () => setSession(await api("session", "POST", d)))
          }
        />
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">SI / INVENTORY</div>
        <p className="muted">CONTROL CENTER</p>
        <nav>
          {["Tổng quan", "Thiết bị", "Danh mục", "Vận hành", "Nhật ký"].map(
            (p) => (
              <button
                className={p === page ? "active" : ""}
                key={p}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ),
          )}
        </nav>
        <small>{session.username}</small>
        <button
          onClick={() =>
            act(async () => setSession(await api("session", "DELETE"))).catch(
              () => {},
            )
          }
        >
          Đăng xuất
        </button>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">SMART INVENTORY SYSTEM</p>
            <h1>{page}</h1>
          </div>
          <label>
            Tồn kho hiển thị
            <select value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="IPC">Kho thực tế</option>
              <option value="IPCSIM">Mô phỏng</option>
            </select>
          </label>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="notice">{notice}</p>}
        {busy && <p role="status">Đang xử lý…</p>}
        {!dataReady && <p role="status">Đang tải dữ liệu…</p>}
        {dataReady && page === "Tổng quan" && (
          <>
            <section className="metrics">
              <article>
                <span>Thiết bị online</span>
                <strong>
                  {devices.filter((d) => d.online).length} / {devices.length}
                </strong>
              </article>
              <article>
                <span>Đang chờ xử lý</span>
                <strong>
                  {
                    ops.filter(
                      (o) =>
                        !["confirmed", "failed", "cancelled"].includes(o.state),
                    ).length
                  }
                </strong>
              </article>
              <article>
                <span>Tồn kho · {domain}</span>
                <strong>{stock.reduce((n, s) => n + s.quantity, 0)}</strong>
              </article>
            </section>
            <section>
              <h2>Tồn kho {domain === "IPC" ? "thực tế" : "mô phỏng"}</h2>
              <Table
                rows={stock}
                columns={["item__code", "item__name", "bin__code", "quantity"]}
              />
            </section>
          </>
        )}
        {dataReady && page === "Thiết bị" && (
          <>
            <section>
              <h2>Thiết bị và đồng bộ</h2>
              <Table
                rows={devices}
                columns={[
                  "device_id",
                  "device_type",
                  "name",
                  "online",
                  "revision",
                  "acknowledged_revision",
                ]}
              />
            </section>
            <section>
              <h2>Đăng ký thiết bị</h2>
              <Form
                disabled={!can('add_device')}
                fields={[
                  { name: "device_id" },
                  { name: "device_type", options: ["IPC", "IPCSIM"] },
                  { name: "name" },
                ]}
                onSubmit={(d) =>
                  act(async () => {
                    const value = await api("devices", "POST", d);
                    setNotice(
                      "Lưu secret vào cấu hình thiết bị và nơi bảo mật: " +
                        value.device_secret,
                    );
                  })
                }
              />
            </section>
            <section>
              <h2>Phân công tủ</h2>
              <Form
                disabled={!can('change_cabinet')}
                fields={[
                  { name: "cabinet_id", type: "number" },
                  { name: "device_id", optional: true },
                ]}
                onSubmit={(d) => act(() => api("assignments", "POST", d))}
              />
              <p>
                Để trống thiết bị để thu hồi phân công. Giải quyết operation
                đang chờ trước khi thay đổi.
              </p>
            </section>
          </>
        )}
        {dataReady && page === "Danh mục" && (
          <section>
            <h2>Danh mục tập trung</h2>
            <select
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              {Object.keys(schemas).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <Table
              rows={records}
              columns={["id", ...schemas[resource].map((f) => f.name)]}
            />
            <h3>Thêm bản ghi</h3>
            <Form
              key={resource}
              disabled={!can('add_' + modelName)}
              fields={schemas[resource]}
              onSubmit={(d) => act(() => api(resource, "POST", d))}
            />
            <details>
              <summary>Sửa thông tin bản ghi</summary>
              <label>Chọn bản ghi <select value={editId} onChange={e => setEditId(e.target.value)}>
                <option value="">Chọn</option>{records.map(r => <option key={r.id} value={r.id}>{r.id} · {r.name || r.code}</option>)}
              </select></label>
              {records.some(r => String(r.id) === editId) &&
              <Form
                key={"edit" + resource + editId}
                disabled={!can('change_' + modelName)}
                defaults={records.find(r => String(r.id) === editId)}
                fields={schemas[resource]}
                onSubmit={(d) => act(() => api(resource, "PATCH", { ...d, id: Number(editId) }))}
              />}
            </details>
          </section>
        )}
        {dataReady && page === "Vận hành" && (
          <>
            <section>
              <h2>Tạo thao tác</h2>
              <p>
                Thiết bị phải online và đã đồng bộ. Tồn kho chỉ thay đổi sau khi
                xác nhận kết quả thực tế.
              </p>
              <Form
                disabled={!can('add_operation')}
                fields={[
                  { name: "device_id" },
                  { name: "rack_id", type: "number" },
                  {
                    name: "kind",
                    options: [
                      "PICK",
                      "PUT",
                      "ADJUST",
                      "OPEN",
                      "CLOSE",
                      "VENTILATE",
                      "LIGHT",
                    ],
                  },
                  { name: "item_id", type: "number", optional: true },
                  { name: "bin_id", type: "number", optional: true },
                  { name: "quantity", type: "number" },
                ]}
                label="Gửi thao tác"
                onSubmit={(d) =>
                  act(() =>
                    api("operations", "POST", {
                      ...d,
                      item_id: d.item_id || null,
                      bin_id: d.bin_id || null,
                      request_key: Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join(''),
                    }),
                  )
                }
              />
            </section>
            <section>
              <h2>Trạng thái thao tác</h2>
              <Table
                rows={ops}
                columns={[
                  "id",
                  "device_id",
                  "kind",
                  "quantity",
                  "state",
                  "execution_state",
                  "created_at",
                ]}
              />
              <h3>Xác nhận nghiệp vụ</h3>
              <label>
                Operation
                <select
                  value={selectedOp}
                  onChange={(e) => setSelectedOp(e.target.value)}
                >
                  <option value="">Chọn thao tác</option>
                  {ops
                    .filter((o) =>
                      ["sent", "uncertain", "expired"].includes(o.state),
                    )
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.device_id} · {o.kind} · {o.id}
                      </option>
                    ))}
                </select>
              </label>
              <Form
                disabled={!can('change_operation')}
                fields={[
                  {
                    name: "note",
                    label: "Kết quả kiểm tra / số lượng thực tế",
                  },
                  {
                    name: "outcome",
                    label: "Kết quả",
                    options: ["Thành công", "Không thực hiện"],
                  },
                ]}
                label="Xác nhận kết quả"
                onSubmit={(d) =>
                  act(() => {
                    if (!selectedOp) throw new Error("Chọn operation");
                    return api(
                      "operations/" + selectedOp + "/confirm",
                      "POST",
                      { note: d.note, success: d.outcome === "Thành công" },
                    );
                  })
                }
              />
            </section>
          </>
        )}
        {dataReady && page === "Nhật ký" && (
          <>
            <section><h2>Audit dữ liệu nền</h2><Table rows={auditRows} columns={['actor_id', 'action', 'resource', 'object_id', 'before', 'after', 'created_at']} /></section>
            <section>
              <h2>Giao dịch đã xác nhận</h2>
              <Table
                rows={ledger}
                columns={[
                  "operation_id",
                  "delta",
                  "quantity_after",
                  "created_at",
                ]}
              />
            </section>
            <section>
              <h2>Telemetry và sự kiện</h2>
              <Table
                rows={events}
                columns={["device_id", "created_at", "payload"]}
              />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
