import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

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
  if (!response.ok)
    throw new Error(value.error || `Request failed (${response.status})`);
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
  ["Environment", "environment", "environment.view"],
  ["Alarms", "alarms", "alarm.view"],
  ["Goods", "goods", "inventory.view"],
  ["Storage Map", "storage-locations", "inventory.view"],
  ["Transactions", "inventory-transactions", "inventory.view"],
  ["Audit Logs", "audit-logs", "audit.view"],
  ["Users", "users", "user.view"],
  ["Roles & Permissions", "roles", "role.manage"],
  ["Settings", "settings", "system.manage"],
];
function Badge({ source }) {
  return source ? (
    <span className={"badge " + (source === "SIMULATION" ? "sim" : "real")}>
      [{source === "SIMULATION" ? "SIM" : source}]
    </span>
  ) : null;
}
function Value({ value }) {
  if (value === null || value === undefined || value === "")
    return <span className="muted">—</span>;
  if (typeof value === "boolean")
    return (
      <span className={value ? "positive" : "muted"}>
        {value ? "Yes" : "No"}
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
            <b>{k.replaceAll("_", " ")}:</b> <Value value={v} />
            {" · "}
          </span>
        ))}
      </span>
    );
  return String(value);
}
function Table({ rows = [], columns, onSelect, actions }) {
  if (!rows.length)
    return <div className="empty">Không có dữ liệu phù hợp với bộ lọc.</div>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c.replaceAll("_", " ")}</th>
            ))}
            {actions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.id || i}
              className={r.source_type === "SIMULATION" ? "simulation" : ""}
            >
              {columns.map((c) => (
                <td key={c}>
                  {c === "source_type" ? (
                    <Badge source={r[c]} />
                  ) : c === columns[0] && onSelect ? (
                    <button className="link" onClick={() => onSelect(r)}>
                      <Value value={r[c]} />
                    </button>
                  ) : (
                    <Value value={r[c]} />
                  )}
                </td>
              ))}
              {actions && <td className="actions">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Form({
  fields,
  submit,
  initial = {},
  label = "Lưu",
  disabled = false,
}) {
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
          <label key={f.name}>
            {f.label || f.name.replaceAll("_", " ")}
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
                    {typeof o === "object" ? o.label : o}
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
        <button type="submit">{working ? "Đang lưu…" : label}</button>
      </fieldset>
    </form>
  );
}
const text = (name) => ({ name });
const number = (name, optional = false) => ({ name, type: "number", optional });
const goodsFields = [
  text("code"),
  text("name"),
  text("unit"),
  number("category_id", true),
  { name: "description", optional: true },
  { name: "is_active", type: "boolean", options: ["true", "false"] },
];
function App() {
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
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    const current = ++seq.current;
    let alive = true;
    const load = async () => {
      try {
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
          if (["Cabinets", "Storage Map"].includes(page)) {
            setSelection((previous) =>
              previous
                ? result.find((row) => row.id === previous.id) || null
                : null,
            );
          }
          setError("");
        }
      } catch (e) {
        if (alive && current === seq.current) setError(e.message);
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
          if (alive) setError(e.message);
        });
    }
    if (page === "Goods") {
      api("categories?source_type=" + source)
        .then((categories) => {
          if (alive) setLookup({ categories });
        })
        .catch((e) => {
          if (alive) setError(e.message);
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
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function open(row) {
    setSelection(row);
    setEdit(false);
    if (page === "IPC Devices") {
      try {
        setLookup({
          groups: await api(
            "cabinet-groups?source_type=" +
              row.source_type +
              "&ipc_id=" +
              encodeURIComponent(row.id),
          ),
        });
      } catch (e) {
        setError(e.message);
      }
    }
  }
  function navigate(p, f = {}) {
    setData(null);
    setPage(p);
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
        <h1>Smart Inventory</h1>
        <p>{error || "Đang kết nối Server…"}</p>
      </main>
    );
  if (!session.authenticated)
    return (
      <main className="login">
        <div className="logo">SI</div>
        <p className="eyebrow">SMART INVENTORY / CONTROL CENTER</p>
        <h1>Đăng nhập</h1>
        <p className="muted">Quản lý thiết bị và hàng hóa tập trung.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Form
          fields={[text("username"), { name: "password", type: "password" }]}
          label="Đăng nhập"
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
  const rows = Array.isArray(data) ? data : [];
  const permission = pages.find((p) => p[0] === page)[2];
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="logo">SI</span>
          <div>
            Smart Inventory<small>CONTROL CENTER</small>
          </div>
        </div>
        <nav>
          {pages
            .filter((p) => can(p[2], "ALL"))
            .map((p, i) => (
              <button
                key={p[0]}
                className={p[0] === page ? "active" : ""}
                onClick={() => navigate(p[0])}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                {p[0]}
              </button>
            ))}
        </nav>
        <div className="account">
          <strong>{session.username}</strong>
          <button
            className="secondary"
            onClick={() =>
              act(async () => setSession(await api("session", "DELETE"))).catch(
                () => {},
              )
            }
          >
            Đăng xuất
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">OPERATIONS WORKSPACE</p>
            <h1>{page}</h1>
            <p className="muted">
              Thiết bị, dữ liệu và tồn kho trong một hệ thống.
            </p>
          </div>
          <label className="source-filter">
            Nguồn dữ liệu
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setSelection(null);
                setFilters({});
              }}
            >
              <option value="REAL">[REAL] Thực tế</option>
              <option value="SIMULATION">[SIM] Mô phỏng</option>
              <option value="ALL">ALL · Tất cả</option>
            </select>
          </label>
        </header>
        <div className="toolbar">
          <span>
            <Badge source={source} />{" "}
            {source === "REAL"
              ? "Ưu tiên dữ liệu thực tế"
              : source === "SIMULATION"
                ? "Dữ liệu mô phỏng"
                : "Thực tế trước, mô phỏng sau"}
          </span>
          <button
            className="secondary"
            onClick={() => setVersion((v) => v + 1)}
          >
            Làm mới
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {busy && <p role="status">Đang xử lý…</p>}
        {!can(permission) && (
          <p className="empty">
            Bạn không có quyền xem nguồn đã chọn. Hãy đổi bộ lọc nguồn.
          </p>
        )}
        {data === null && !error && <p role="status">Đang tải…</p>}
        {page === "Dashboard" && data && (
          <>
            <div className="metrics">
              {[
                ["IPC online", `${data.online} / ${data.ipcs}`],
                ["Cabinet groups", data.cabinet_groups],
                ["Racks", data.racks],
                ["Active alarms", data.active_alarms],
                ["Inventory quantity", data.quantity],
              ].map(([title, value]) => (
                <article key={title}>
                  <span>{title}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>
            <section>
              <h2>Giám sát rack</h2>
              <Table
                rows={data.environment}
                columns={[
                  "name",
                  "source_type",
                  "ipc_id",
                  "online",
                  "temperature",
                  "humidity",
                  "weight",
                  "smoke",
                  "last_update",
                ]}
              />
            </section>
          </>
        )}
        {page === "IPC Devices" && (
          <>
            <section>
              <h2>Kết nối và đồng bộ</h2>
              <Table
                rows={rows}
                onSelect={open}
                columns={[
                  "id",
                  "source_type",
                  "name",
                  "cabinet_group_count",
                  "online",
                  "mqtt_connected",
                  "serial_connected",
                  "last_seen",
                  "last_sync",
                  "synchronized",
                  "racks",
                ]}
              />
            </section>
            {selection && (
              <section>
                <h2>
                  {selection.name} <Badge source={selection.source_type} />
                </h2>
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
                {can("ipc.manage", selection.source_type) && (
                  <Form
                    fields={[
                      text("name"),
                      {
                        name: "enabled",
                        type: "boolean",
                        options: ["true", "false"],
                      },
                    ]}
                    initial={selection}
                    submit={(d) =>
                      mutate("ipcs", "PATCH", { ...d, device_id: selection.id })
                    }
                  />
                )}
              </section>
            )}
            {can("ipc.manage") && (
              <section>
                <h2>Đăng ký IPC</h2>
                <Form
                  fields={[
                    text("device_id"),
                    text("name"),
                    { name: "source_type", options: ["REAL", "SIMULATION"] },
                  ]}
                  initial={{ source_type: source === "ALL" ? "REAL" : source }}
                  submit={(d) =>
                    act(async () => {
                      const r = await api("ipcs", "POST", d);
                      setLookup({ secret: r.device_secret });
                    })
                  }
                />
                {lookup.secret && (
                  <p className="notice">
                    Lưu secret vào cấu hình IPC: <code>{lookup.secret}</code>
                  </p>
                )}
              </section>
            )}
          </>
        )}
        {page === "Cabinets" && (
          <>
            <section>
              <h2>IPC → Cabinet Group → Rack</h2>
              <Form
                fields={[
                  { name: "ipc_id", optional: true },
                  number("cabinet_id", true),
                ]}
                initial={filters}
                label="Lọc"
                submit={(d) =>
                  setFilters(
                    Object.fromEntries(Object.entries(d).filter(([, v]) => v)),
                  )
                }
              />
              <Table
                rows={rows}
                onSelect={open}
                columns={[
                  "name",
                  "source_type",
                  "ipc_id",
                  "cabinet",
                  "address",
                  "online",
                  "state",
                  "last_update",
                ]}
              />
            </section>
            {selection && (
              <section>
                <p className="breadcrumb">
                  Dashboard → {selection.ipc_id} → {selection.cabinet} →{" "}
                  {selection.name}
                </p>
                <h2>
                  {selection.name} <Badge source={selection.source_type} />
                </h2>
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
                      <dt>{k.replaceAll("_", " ")}</dt>
                      <dd>
                        <Value value={selection[k]} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="actions">
                  {["OPEN", "CLOSE", "VENTILATE"].map((command) => (
                    <button
                      key={command}
                      disabled={
                        busy ||
                        !selection.online ||
                        !can("cabinet.control", selection.source_type)
                      }
                      onClick={() =>
                        mutate(`racks/${selection.id}/commands`, "POST", {
                          command,
                          request_key: key(),
                        }).catch(() => {})
                      }
                    >
                      {command}
                    </button>
                  ))}
                </div>
                <p className="muted">
                  Lệnh được gửi qua MQTT; trạng thái gửi chưa xác nhận thao tác
                  vật lý.
                </p>
              </section>
            )}
            <OperationPanel
              source={source}
              can={can}
              act={act}
              version={version}
            />
            {can("ipc.manage") && (
              <section>
                <h2>Cấu hình cabinet / rack</h2>
                <Form
                  fields={[
                    number("id"),
                    text("name"),
                    { name: "area", optional: true },
                    { name: "description", optional: true },
                  ]}
                  submit={(d) => mutate("cabinets", "PATCH", d)}
                />
                <h3>Phân công cabinet cho IPC</h3>
                <Form
                  fields={[
                    number("cabinet_id"),
                    { name: "device_id", optional: true },
                  ]}
                  submit={(d) => mutate("assignments", "POST", d)}
                />
              </section>
            )}
          </>
        )}
        {page === "Environment" && (
          <section>
            <h2>Lịch sử môi trường</h2>
            <Form
              fields={[
                { name: "ipc_id", optional: true },
                number("cabinet_id", true),
                number("rack_id", true),
                { name: "from", type: "datetime-local", optional: true },
                { name: "to", type: "datetime-local", optional: true },
              ]}
              label="Lọc dữ liệu"
              submit={(d) => {
                for (const k of ["from", "to"])
                  if (d[k]) d[k] = new Date(d[k]).toISOString();
                setFilters(
                  Object.fromEntries(Object.entries(d).filter(([, v]) => v)),
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
            <h2>Cảnh báo</h2>
            <select
              aria-label="Alarm status"
              value={filters.active || ""}
              onChange={(e) => setFilters({ active: e.target.value })}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="true">Active</option>
              <option value="false">Cleared</option>
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
                "acknowledged_by_id",
                "acknowledged_at",
                "cleared_at",
              ]}
              actions={(r) => (
                <button
                  disabled={
                    !!r.acknowledged_at ||
                    busy ||
                    !can("alarm.acknowledge", r.source_type)
                  }
                  onClick={() =>
                    mutate(`alarms/${r.id}/acknowledge`, "POST", {}).catch(
                      () => {},
                    )
                  }
                >
                  {r.acknowledged_at ? "Acknowledged" : "Acknowledge"}
                </button>
              )}
            />
          </section>
        )}
        {page === "Goods" && (
          <>
            <section>
              <h2>
                Danh mục hàng hóa{" "}
                <small>Dùng chung · tồn kho tách theo nguồn</small>
              </h2>
              <Table
                rows={rows}
                onSelect={open}
                columns={[
                  "code",
                  "name",
                  "category",
                  "unit",
                  "status",
                  "quantity",
                ]}
              />
              {selection && (
                <div className="inset">
                  <h3>
                    {selection.name} · #{selection.id}
                  </h3>
                  {selection.locations.map((l, i) => (
                    <p key={i}>
                      <Badge source={l.source_type} /> Position #{l.location_id}{" "}
                      · {l.quantity} {selection.unit}
                    </p>
                  ))}
                  {canAll("inventory.update") && (
                    <Form
                      key={selection.id}
                      fields={goodsFields.map((f) =>
                        f.name === "category_id"
                          ? {
                              ...f,
                              options: (lookup.categories || []).map((c) => ({
                                value: c.id,
                                label: c.name,
                              })),
                            }
                          : f,
                      )}
                      initial={{
                        ...selection,
                        is_active: selection.status === "active",
                      }}
                      submit={(d) =>
                        mutate("goods", "PATCH", { ...d, id: selection.id })
                      }
                    />
                  )}
                  <button
                    className="danger"
                    disabled={!canAll("inventory.delete") || busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Xóa hàng hóa? Dữ liệu đã có lịch sử sẽ được bảo vệ.",
                        )
                      )
                        mutate("goods", "DELETE", { id: selection.id })
                          .then(() => setSelection(null))
                          .catch(() => {});
                    }}
                  >
                    Xóa hàng hóa
                  </button>
                </div>
              )}
            </section>
            {canAll("inventory.create") && (
              <section>
                <h2>Thêm hàng hóa</h2>
                <Form
                  fields={goodsFields.map((f) =>
                    f.name === "category_id"
                      ? {
                          ...f,
                          options: (lookup.categories || []).map((c) => ({
                            value: c.id,
                            label: c.name,
                          })),
                        }
                      : f,
                  )}
                  submit={(d) => mutate("goods", "POST", d)}
                />
                <h3>Thêm category</h3>
                <Form
                  fields={[text("code"), text("name")]}
                  submit={(d) => mutate("categories", "POST", d)}
                />
              </section>
            )}
          </>
        )}
        {page === "Storage Map" && (
          <>
            <section>
              <h2>Vị trí lưu trữ</h2>
              <p className="legend">○ Empty · ● Occupied · ▣ Reserved</p>
              {Object.entries(
                Object.groupBy(
                  rows,
                  (r) =>
                    `${r.source_type} · ${r.area || "Site chưa đặt tên"} / ${r.cabinet} / ${r.rack} / ${r.shelf}`,
                ),
              ).map(([group, locations]) => (
                <div className="storage-group" key={group}>
                  <h3>{group}</h3>
                  <div className="positions">
                    {locations.map((r) => (
                      <button
                        className={"position " + r.status}
                        key={r.id}
                        onClick={() => setSelection(r)}
                      >
                        <Badge source={r.source_type} />
                        <strong>{r.code}</strong>
                        <span>{r.status}</span>
                        <small>#{r.id}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!rows.length && (
                <p className="empty">Chưa cấu hình vị trí lưu trữ.</p>
              )}
              {selection && (
                <div className="inset">
                  <h3>
                    {selection.code} <Badge source={selection.source_type} />
                  </h3>
                  <Table
                    rows={selection.goods}
                    columns={["item_id", "item__name", "quantity"]}
                  />
                  <button
                    disabled={
                      !can("inventory.update", selection.source_type) || busy
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
                    {selection.status === "reserved" ? "Bỏ giữ chỗ" : "Giữ chỗ"}
                  </button>
                </div>
              )}
            </section>
            {can("inventory.create") && (
              <section>
                <h2>Thêm vị trí theo topology</h2>
                <label>
                  Loại
                  <select
                    value={master}
                    onChange={(e) => setMaster(e.target.value)}
                  >
                    <option value="shelves">Shelf / Compartment</option>
                    <option value="bins">Position</option>
                  </select>
                </label>
                <Form
                  key={master}
                  fields={
                    master === "shelves"
                      ? [number("rack_id"), text("code"), number("level")]
                      : [number("shelf_id"), text("code"), number("capacity")]
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
              <h2>Ghi nhận giao dịch kho</h2>
              <p>
                Chỉ xác nhận sau khi kiểm tra hàng hóa thực tế. ADJUST là số
                lượng tồn mới; RETURN phải tham chiếu giao dịch BORROW.
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
                      "ADJUST",
                    ],
                  },
                  number("item_id"),
                  number("quantity"),
                  number("from_location_id", true),
                  number("to_location_id", true),
                  number("borrow_id", true),
                  text("note"),
                ]}
                submit={(d) =>
                  mutate("inventory-transactions", "POST", {
                    ...d,
                    request_key: key(),
                  })
                }
              />
            </section>
            <section>
              <h2>Lịch sử giao dịch</h2>
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
            <h2>Nhật ký kiểm toán</h2>
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
            <h2>Người dùng</h2>
            <Table
              rows={rows}
              onSelect={(r) => {
                setSelection(r);
                setEdit(true);
              }}
              columns={["id", "username", "is_active", "roles"]}
            />
            <h3>{edit ? "Cập nhật người dùng" : "Tạo người dùng"}</h3>
            <button
              className="secondary"
              onClick={() => {
                setEdit(false);
                setSelection(null);
              }}
            >
              Tạo mới
            </button>
            <Form
              key={edit ? selection?.id : "new"}
              disabled={!canAll("user.manage")}
              initial={edit ? selection : { roles: [], is_active: true }}
              fields={[
                ...(!edit ? [text("username")] : []),
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
          </section>
        )}
        {page === "Roles & Permissions" && (
          <section>
            <h2>Roles & Permissions</h2>
            <p>
              Scope: REAL, SIMULATION hoặc ALL. Quyền được kiểm tra tại backend.
            </p>
            <Table
              rows={rows}
              onSelect={(r) => {
                setSelection(r);
                setEdit(true);
              }}
              columns={["id", "name", "permissions"]}
            />
            <h3>{edit ? "Cập nhật role" : "Tạo role"}</h3>
            <button
              className="secondary"
              onClick={() => {
                setEdit(false);
                setSelection(null);
              }}
            >
              Tạo mới
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
            <h2>Ngưỡng cảnh báo</h2>
            <dl>
              {Object.entries(data).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <Form
              fields={[
                { name: "key", options: ["temperature_max", "humidity_max"] },
                number("value"),
              ]}
              submit={(d) => mutate("settings", "PATCH", d)}
            />
            <p className="muted">
              Ngưỡng áp dụng khi nhận mẫu telemetry tiếp theo.
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
              Trang tr??c
            </button>
            <span>
              Trang {Math.floor(Number(filters.offset || 0) / 200) + 1}
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
              Trang sau
            </button>
          </div>
        )}
        <footer>
          SMART INVENTORY · Server-managed inventory · Auto refresh 10s
        </footer>
      </main>
    </div>
  );
}
function RoleForm({ initial, submit }) {
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
        Role name
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
              <option value="">Không cấp</option>
              {["REAL", "SIMULATION", "ALL"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button disabled={busy}>Lưu role</button>
    </form>
  );
}
function OperationPanel({ source, can, act, version }) {
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
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    setSelected(null);
    load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [source, version]);
  return (
    <section>
      <h2>Trạng thái lệnh MQTT</h2>
      {error && <p className="error">{error}</p>}
      <Table
        rows={rows}
        columns={[
          "id",
          "source_type",
          "device_id",
          "kind",
          "state",
          "execution_state",
          "created_at",
        ]}
        onSelect={setSelected}
      />
      {selected && (
        <>
          <h3>Xác nhận kết quả #{selected.id}</h3>
          <Form
            disabled={!can("cabinet.control", selected.source_type)}
            fields={[
              text("note"),
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
