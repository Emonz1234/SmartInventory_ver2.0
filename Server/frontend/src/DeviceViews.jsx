import React from "react";
import { useLanguage } from "./i18n";
import { StatusBadge } from "./ui.jsx";

export function deviceStatus(device) {
  if (!device.online) return "Offline";
  if (
    Number(device.active_errors) > 0 ||
    device.fault ||
    device.is_obstructed ||
    device.is_skewed ||
    device.is_overload_motor ||
    device.smoke ||
    ["FAULT", "ERROR"].includes(
      String(device.status || device.state).toUpperCase(),
    ) ||
    Number(device.state) === -2
  )
    return "Error";
  if (
    device.serial_connected === false ||
    device.synchronized === false ||
    device.configuration_status?.startsWith("pending")
  )
    return "Warning";
  if (
    device.is_hard_locked ||
    device.is_moving ||
    device.is_endpoint === false ||
    ["MOVING", "OPENING", "CLOSING"].includes(device.state)
  )
    return "Busy";
  if (device.cabinet_id && !device.last_update) return "Unconfirmed";
  if (device.cabinet_group_count != null && device.active_errors == null)
    return "Online";
  return device.serial_connected === true && device.synchronized === true
    ? "Ready"
    : "Online";
}

export function DeviceTree({ rows, onSelect }) {
  const lang = useLanguage(),
    text = (vi, en) => (lang === "en" ? en : vi);
  const grouped = Map.groupBy(
    rows,
    (row) => `${row.source_type}:${row.ipc_id || "Unassigned"}`,
  );
  return (
    <div className="device-tree">
      {[...grouped].map(([key, racks]) => (
        <article key={key}>
          <div className="section-heading">
            <h3>
              {racks[0].ipc_id || text("Chưa phân công IPC", "Unassigned IPC")}
            </h3>
            <StatusBadge value={racks[0].source_type} />
          </div>
          {[...Map.groupBy(racks, (row) => row.cabinet_id)].map(
            ([cabinet, items]) => (
              <details
                className="cabinet-tree"
                key={cabinet}
                open={
                  cabinet === racks[0].cabinet_id ||
                  items.some((r) => deviceStatus(r) === "Error")
                }
              >
                <summary>
                  {items[0].cabinet} <small>{items.length} racks</small>
                  <StatusBadge
                    value={
                      items.some((r) => deviceStatus(r) === "Error")
                        ? "Error"
                        : items.every((r) => deviceStatus(r) === "Ready")
                          ? "Ready"
                          : items.every((r) => !r.online)
                            ? "Offline"
                            : "Warning"
                    }
                  />
                </summary>
                <div className="rack-cards">
                  {items.map((r) => (
                    <button
                      className="rack-card secondary"
                      key={r.id}
                      onClick={() => onSelect(r)}
                    >
                      <strong>{r.name}</strong>
                      <StatusBadge value={deviceStatus(r)} />
                      <small>
                        {r.last_update
                          ? new Date(r.last_update).toLocaleString()
                          : text("Chưa có dữ liệu", "No telemetry yet")}
                      </small>
                    </button>
                  ))}
                </div>
              </details>
            ),
          )}
        </article>
      ))}
      {!rows.length && (
        <p className="empty">
          {text(
            "Không có thiết bị phù hợp. Hãy đổi nguồn hoặc bộ lọc.",
            "No matching devices. Change the source or filters.",
          )}
        </p>
      )}
    </div>
  );
}
