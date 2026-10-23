import React, { useState } from "react";
import { useLanguage } from "./i18n";
import { DataTable } from "./ui.jsx";

export const environmentalAlarm = (row) =>
  /TEMPERATURE|TEMP_HIGH|TEMP_LOW|HIGH_TEMP|LOW_TEMP|HUMID|SMOKE|GAS|ENVIRONMENT|DHT|MQ2|ENV_SENSOR/.test(
    String(row.code || "").toUpperCase(),
  );
export const maintenanceAlarm = (row) =>
  /MAINTENANCE|INSPECTION|REPEATED|RECURRENCE/.test(
    String(row.code || "").toUpperCase(),
  ) || !!row.maintenance_status;
export default function MaintenanceView({ rows, onSelect }) {
  const lang = useLanguage(),
    text = (vi, en) => (lang === "en" ? en : vi);
  const [tab, setTab] = useState("attention");
  const groups = new Map(),
    since = Date.now() - 30 * 60 * 1000;
  rows
    .filter(
      (row) =>
        !environmentalAlarm(row) &&
        !/COMMUNICATION|OFFLINE|CONNECTION/.test(row.code || "") &&
        Date.parse(row.created_at) >= since,
    )
    .forEach((row) => {
      const key = `${row.source_type}:${row.device_id}:${row.rack_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
  const repeated = [...groups.values()]
    .filter((items) => items.length >= 3)
    .map((items) => ({
      ...items[0],
      code: text(
        "Lỗi lặp lại · nên kiểm tra",
        "Repeated fault · inspection advised",
      ),
      recent_count: items.length,
      maintenance_state: "Warning",
      created_at: items.reduce(
        (last, row) =>
          Date.parse(row.created_at) > Date.parse(last) ? row.created_at : last,
        items[0].created_at,
      ),
    }));
  const explicit = rows
    .filter(maintenanceAlarm)
    .filter((row) =>
      tab === "history"
        ? !row.active
        : tab === "maintenance"
          ? String(row.maintenance_status).toUpperCase() === "IN_PROGRESS"
          : row.active,
    );
  const display = [...(tab === "attention" ? repeated : []), ...explicit].map(
    (row) => ({
      ...row,
      maintenance_state:
        row.maintenance_state ||
        row.maintenance_status ||
        (row.active ? "Warning" : "Cleared"),
    }),
  );
  return (
    <>
      <div className="settings-tabs">
        {[
          ["attention", "Cần chú ý", "Needs attention"],
          ["maintenance", "Đang bảo trì", "In maintenance"],
          ["history", "Lịch sử bảo trì", "Maintenance history"],
        ].map(([key, vi, en]) => (
          <button
            key={key}
            className={tab === key ? "active" : "secondary"}
            onClick={() => setTab(key)}
          >
            {text(vi, en)}
          </button>
        ))}
      </div>
      <p className="muted">
        {text(
          "Khuyến nghị kiểm tra khi có ≥3 lỗi thiết bị trong 30 phút, dựa trên các bản ghi đã tải. Không tính mất kết nối. Đây là gợi ý, không tự thay đổi trạng thái thiết bị.",
          "Inspection advisory for ≥3 device faults in 30 minutes, based on loaded records. Connectivity failures are excluded. This does not change device state.",
        )}
      </p>
      <DataTable
        rows={display}
        columns={[
          "location",
          "code",
          "recent_count",
          "maintenance_state",
          "created_at",
          "source_type",
        ]}
        onSelect={onSelect}
        actions={(row) => (
          <button className="link" onClick={() => onSelect(row)}>
            {text("Chi tiết", "Details")}
          </button>
        )}
      />
    </>
  );
}
