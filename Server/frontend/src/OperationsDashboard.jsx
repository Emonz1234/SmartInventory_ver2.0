import React, { useEffect, useState } from "react";
import { useLanguage, errorText } from "./i18n";
import { StatusBadge, KpiCard, LoadingState, ErrorState } from "./ui.jsx";
import { deviceStatus } from "./DeviceViews.jsx";

export default function OperationsDashboard({
  api,
  source,
  can,
  navigate,
  version,
}) {
  const lang = useLanguage(),
    text = (vi, en) => (lang === "en" ? en : vi);
  const [data, setData] = useState(null),
    [errors, setErrors] = useState({}),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null);
    const load = async () => {
      const endpoints = { summary: "dashboard" };
      if (can("inventory.view")) endpoints.inventory = "inventory-overview";
      if (can("ipc.view")) endpoints.devices = "ipcs";
      if (can("cabinet.view")) endpoints.racks = "rack-status";
      if (can("cabinet.view")) endpoints.operations = "operations?pending=true";
      if (can("alarm.view")) endpoints.alarms = "alarms?active=true";
      const results = await Promise.allSettled(
        Object.values(endpoints).map((path) =>
          api(`${path}${path.includes("?") ? "&" : "?"}source_type=${source}`),
        ),
      );
      if (!live) return;
      const next = {},
        failures = {};
      Object.keys(endpoints).forEach((key, index) => {
        const result = results[index];
        if (result.status === "fulfilled") next[key] = result.value;
        else failures[key] = result.reason;
      });
      setData(next);
      setErrors(failures);
    };
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, source, version, reload]);
  if (!data) return <LoadingState />;
  const devices = data.devices || data.inventory?.devices || [],
    racks = data.racks || [];
  const alarms = data.alarms || [],
    low = (data.inventory?.products || []).filter(
      (p) => p.stock_status !== "Normal" && p.is_active !== false,
    );
  const offline = devices.filter((d) => !d.online),
    pending = devices.filter((d) => d.synchronized === false);
  const blockers = (data.operations || []).filter(op => !["confirmed", "failed", "cancelled"].includes(op.state));
  const faultCount = data.summary?.active_alarms;
  const abnormal =
    Number(faultCount) > 0 ||
    offline.length > 0 ||
    pending.length > 0 ||
    low.length > 0 || blockers.length > 0;
  const unknown = Object.keys(errors).length > 0;
  const go = (page, filters = {}) => navigate(page, filters);
  return (
    <div className="operations-dashboard">
      <section
        className={`system-health ${Number(faultCount) > 0 ? "danger" : unknown || abnormal ? "warning" : "healthy"}`}
        aria-label={text("Sức khỏe hệ thống", "System health")}
      >
        <div>
          <span className="eyebrow">
            {text("SỨC KHỎE HỆ THỐNG", "SYSTEM HEALTH")}
          </span>
          <h2>
            {unknown
              ? text(
                  "Chưa xác minh đủ trạng thái",
                  "Some status could not be verified",
                )
              : abnormal
                ? text("Có mục cần kiểm tra", "Attention required")
                : text(
                    "Không có cảnh báo trong dữ liệu được phép xem",
                    "No warnings in your accessible data",
                  )}
          </h2>
          <p>
            {text(
              "Trạng thái theo nguồn đang chọn. Thiết bị chỉ sẵn sàng khi kết nối và đồng bộ đầy đủ.",
              "Status for the selected source. Devices are ready only when connected and synchronized.",
            )}
          </p>
        </div>
        <StatusBadge
          value={
            Number(faultCount) > 0
              ? "Error"
              : unknown
                ? "Unconfirmed"
                : abnormal
                  ? "Warning"
                  : "Ready"
          }
        />
      </section>
      {Object.entries(errors).map(([key, error]) => (
        <ErrorState
          key={key}
          retry={() => setReload((v) => v + 1)}
        >{`${text("Không tải được trạng thái", "Could not load status")}: ${key}. ${errorText(error)}`}</ErrorState>
      ))}
      <div className="metrics operational-metrics">
        {[
          [
            text("IPC online / offline", "IPC online / offline"),
            data.summary
              ? `${data.summary.online} / ${data.summary.ipcs - data.summary.online}`
              : "—",
          ],
          [
            text("Cabinet khả dụng", "Available cabinets"),
            data.racks
              ? [...Map.groupBy(racks, (r) => r.cabinet_id).values()].filter(
                  (group) => group.every((r) => deviceStatus(r) === "Ready"),
                ).length
              : "—",
          ],
          [
            text("Rack khả dụng", "Available racks"),
            data.racks
              ? racks.filter((r) => deviceStatus(r) === "Ready").length
              : "—",
          ],
          [text("Lỗi đang hoạt động", "Active errors"), faultCount ?? "—"],
          [
            text("Bản ghi chờ đồng bộ", "Records pending sync"),
            data.inventory?.pending_sync ?? "—",
          ],
          [
            text("Cảnh báo tồn kho", "Stock warnings"),
            data.inventory ? low.length : "—",
          ],
        ].map(([label, value]) => (
          <KpiCard key={label} label={label} value={value} />
        ))}
      </div>
      <section>
        <h2>{text("Thao tác nhanh", "Quick actions")}</h2>
        <div className="quick-actions">
          {[
            [
              "Stock Operations",
              "inventory.move",
              text("Nhập hàng", "Receive stock"),
              "PUT",
            ],
            [
              "Stock Operations",
              "inventory.move",
              text("Xuất hàng", "Issue stock"),
              "PICK",
            ],
            [
              "Inventory",
              "inventory.view",
              text("Tra cứu hàng / vị trí", "Find products / locations"),
            ],
            ["IPC Devices", "ipc.view", text("Xem thiết bị", "View devices")],
            ["Alarms", "alarm.view", text("Xem cảnh báo", "View alerts")],
          ]
            .filter(([, permission]) => can(permission))
            .map(([page, , label, kind]) => (
              <button
                className="secondary"
                key={label}
                onClick={() => go(page, kind ? { kind } : {})}
              >
                {label}
                <span aria-hidden="true"> →</span>
              </button>
            ))}
        </div>
      </section>
      <div className="dashboard-columns">
        <section>
          <h2>{text("Cần chú ý", "Needs attention")}</h2>
          <div className="attention-list">
            {blockers.map(op => <article key={op.id} className="attention-item">
              <div>
                <strong>{text('Thao tác đang chờ', 'Pending operation')}: {op.kind} · {op.device_id}</strong>
                <p>{text('Đang chặn lệnh mới trên IPC này. Kiểm tra kết quả thực tế và xác nhận thao tác trước khi gửi lại.', 'Blocks new commands on this IPC. Inspect the actual outcome and confirm this operation before sending another.')}</p>
                <small>{op.rack__cabinet__name || ''} / {op.rack__name || `Rack ${op.rack_id}`} {op.item__name ? ` · ${op.item__name} × ${op.quantity}` : ''}</small>
                <p><StatusBadge value={op.state} /> <StatusBadge value={op.execution_state} /> <StatusBadge value={op.source_type} /></p>
                {op.error && <p className="error">{errorText(op.error)}</p>}
                <small>{new Date(op.created_at).toLocaleString()} · {op.requested_by__username || ''}</small>
                <small style={{ display: 'block', overflowWrap: 'anywhere' }}>{text('Mã lệnh', 'Command ID')}: {op.id}</small>
              </div>
              <button className="secondary" onClick={() => go('Racks', { operation_id: op.id, source_type: op.source_type })}>{text('Kiểm tra thao tác', 'Review operation')}</button>
            </article>)}

            {alarms.slice(0, 4).map((a) => (
              <article key={a.id} className="attention-item danger">
                <div>
                  <strong>
                    {a.device_id || text("Thiết bị", "Device")} · {a.code}
                  </strong>
                  <p>
                    {text(
                      "Có cảnh báo đang hoạt động. Kiểm tra vị trí và thiết bị trước khi vận hành.",
                      "Active alert. Inspect the location and device before operating.",
                    )}
                  </p>
                  <small>
                    {a.rack_id ? `Rack ${a.rack_id} · ` : ""}
                    {new Date(a.created_at).toLocaleString()}
                  </small>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    go("Alarms", { alert_id: a.id, source_type: a.source_type })
                  }
                >
                  {text("Xem cảnh báo", "Review alert")}
                </button>
              </article>
            ))}
            {offline.slice(0, 3).map((d) => (
              <article key={d.id} className="attention-item">
                <div>
                  <strong>
                    {d.name || d.id} · {text("Mất kết nối", "Offline")}
                  </strong>
                  <p>
                    {text(
                      "Không thể gửi lệnh. Kiểm tra nguồn điện và kết nối tại IPC.",
                      "Commands are unavailable. Check IPC power and connectivity.",
                    )}
                  </p>
                </div>
                {can("ipc.view", d.source_type) && (
                  <button
                    className="secondary"
                    onClick={() =>
                      go("IPC Devices", {
                        device_id: d.id,
                        source_type: d.source_type,
                      })
                    }
                  >
                    {text("Xem thiết bị", "View device")}
                  </button>
                )}
              </article>
            ))}
            {low.slice(0, 3).map((p) => (
              <article
                key={`${p.id}-${p.source_type}`}
                className="attention-item"
              >
                <div>
                  <strong>
                    {p.name} <StatusBadge value={p.source_type} />
                  </strong>
                  <p>
                    {text("Tồn kho thấp / hết hàng", "Low / out of stock")} ·{" "}
                    {p.quantity} {p.unit}
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    go("Inventory", {
                      product_id: p.id,
                      source_type: p.source_type,
                    })
                  }
                >
                  {text("Xem hàng hóa", "View product")}
                </button>
              </article>
            ))}
            {!!data.inventory?.pending_sync && (
              <article className="attention-item">
                <div>
                  <strong>
                    {data.inventory.pending_sync}{" "}
                    {text("bản ghi chờ đồng bộ", "records pending sync")}
                  </strong>
                  <p>
                    {text(
                      "Kiểm tra IPC và giao dịch cần đối soát.",
                      "Review IPC synchronization and unresolved transactions.",
                    )}
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() => go(can("ipc.view") ? "Sync" : "Transactions")}
                >
                  {text("Kiểm tra đồng bộ", "Review sync")}
                </button>
              </article>
            )}
            {pending.length > 0 && can("ipc.view") && (
              <article className="attention-item">
                <div>
                  <strong>
                    {pending.map((d) => d.name || d.id).join(", ")}
                  </strong>
                  <p>
                    {text(
                      "IPC chưa xác nhận đồng bộ. Kiểm tra trước khi gửi lệnh.",
                      "IPC synchronization is not confirmed. Review before issuing commands.",
                    )}
                  </p>
                </div>
                <button className="secondary" onClick={() => go("Sync")}>
                  {text("Kiểm tra đồng bộ", "Review sync")}
                </button>
              </article>
            )}
            {!abnormal && !unknown && (
              <p className="empty">
                {text("Không có mục cần xử lý.", "No items need attention.")}
              </p>
            )}
          </div>
        </section>
        <section>
          <h2>{text("Trạng thái thiết bị", "Device status")}</h2>
          <div className="device-cards">
            {devices.map((d) => (
              <button
                className="device-card secondary"
                key={d.id}
                disabled={!can("ipc.view", d.source_type)}
                onClick={() =>
                  go("IPC Devices", {
                    device_id: d.id,
                    source_type: d.source_type,
                  })
                }
              >
                <strong>{d.name || d.id}</strong>
                <small>{d.id}</small>
                <span>
                  <StatusBadge value={d.source_type} />{" "}
                  <StatusBadge
                    value={
                      alarms.some((a) => a.device_id === d.id)
                        ? "Error"
                        : deviceStatus(d)
                    }
                  />
                </span>
              </button>
            ))}
            {!devices.length && (
              <p className="empty">
                {text(
                  "Không có thiết bị được phép xem.",
                  "No accessible devices.",
                )}
              </p>
            )}
          </div>
        </section>
      </div>
      {data.inventory && (
        <section>
          <div className="section-heading">
            <h2>{text("Hoạt động gần đây", "Recent activity")}</h2>
            <button className="link" onClick={() => go("Transactions")}>
              {text("Xem lịch sử →", "View history →")}
            </button>
          </div>
          <div className="activity-list">
            {data.inventory.transactions.slice(0, 5).map((row, index) => (
              <button
                key={`${row.id}-${index}`}
                className="activity-row secondary"
                onClick={() =>
                  go("Transactions", {
                    transaction_id: row.id,
                    source_type: row.source_type,
                  })
                }
              >
                <span>
                  <strong>{row.product}</strong>
                  <small>
                    {row.ipc_id} / {row.cabinet} / {row.rack}
                  </small>
                </span>
                <span>
                  <StatusBadge value={row.source_type} />{" "}
                  <StatusBadge value={row.kind} /> {row.quantity}
                </span>
                <span>
                  <StatusBadge value={row.operation_status} />
                  <small>{new Date(row.created_at).toLocaleString()}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
