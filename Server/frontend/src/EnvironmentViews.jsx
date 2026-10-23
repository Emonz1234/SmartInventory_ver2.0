import React, { useState } from "react";
import { useLanguage } from "./i18n";
import {
  StatusBadge,
  DataTable,
  DetailDrawer,
  TechnicalDetails,
} from "./ui.jsx";

const metrics = [
  ["temperature", "Nhiệt độ", "Temperature", "°C"],
  ["humidity", "Độ ẩm", "Humidity", "%"],
  ["smoke", "Khói", "Smoke", ""],
  ["weight", "Tải trọng", "Load", "kg"],
  ["gas", "Khí", "Gas", ""],
];
const reading = (row, key) => row.values?.[key] ?? row[key];
const validNumber = (value) =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value));
export function MeasurementHistory({ rows, metric, onMetric }) {
  const lang = useLanguage(),
    text = (vi, en) => (lang === "en" ? en : vi);
  const groups = new Map();
  rows.forEach((row) => {
    const key = `${row.source_type}:${row.device_id}:${row.rack_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const [location, setLocation] = useState("");
  const selected = groups.has(location) ? location : [...groups.keys()][0];
  const points = (groups.get(selected) || [])
    .filter(
      (row) =>
        validNumber(reading(row, metric)) &&
        Number.isFinite(Date.parse(row.created_at)),
    )
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const values = points.map((row) => Number(reading(row, metric))),
    min = Math.min(...values),
    max = Math.max(...values);
  const first = points.length ? Date.parse(points[0].created_at) : 0,
    last = points.length ? Date.parse(points.at(-1).created_at) : 0;
  const plot = points
    .map(
      (row) =>
        `${40 + ((Date.parse(row.created_at) - first) / Math.max(1, last - first)) * 720},${180 - ((Number(reading(row, metric)) - min) / Math.max(1, max - min)) * 140}`,
    )
    .join(" ");
  return (
    <>
      <div className="filter-bar">
        <label>
          {text("Loại dữ liệu", "Metric")}
          <select
            value={metric}
            disabled={!onMetric}
            onChange={(event) => onMetric?.(event.target.value)}
          >
            {metrics.map(([key, vi, en]) => (
              <option key={key} value={key}>
                {text(vi, en)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("Vị trí cảm biến", "Sensor location")}
          <select
            value={selected || ""}
            onChange={(event) => setLocation(event.target.value)}
          >
            {[...groups].map(([key, entries]) => (
              <option key={key} value={key}>
                {entries[0].location ||
                  `${entries[0].device_id} / Rack ${entries[0].rack_index ?? entries[0].rack_id}`}{" "}
                · {entries[0].source_type}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!points.length ? (
        <p className="empty">
          {text("Không có số đo phù hợp.", "No matching readings.")}
        </p>
      ) : (
        <>
          <div className="environment-kpis">
            {[
              [text("Nhỏ nhất", "Minimum"), min],
              [text("Lớn nhất", "Maximum"), max],
              [
                text("Trung bình", "Average"),
                values.reduce((a, b) => a + b, 0) / values.length,
              ],
            ].map(([label, val]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>
                  {val.toFixed(1)}{" "}
                  {metrics.find(([key]) => key === metric)?.[3]}
                </strong>
              </article>
            ))}
          </div>
          <svg
            className="measurement-chart"
            viewBox="0 0 800 230"
            role="img"
            aria-label={`${metric}: ${points.length} readings`}
          >
            <line
              x1="40"
              y1="180"
              x2="760"
              y2="180"
              stroke="currentColor"
              opacity=".25"
            />
            <text x="4" y="45">
              {max.toFixed(1)}
            </text>
            <text x="4" y="180">
              {min.toFixed(1)}
            </text>
            <polyline
              points={plot}
              fill="none"
              stroke="var(--primary, #087f86)"
              strokeWidth="3"
            />
            {points.map((row, index) => (
              <circle
                key={row.id ?? index}
                cx={
                  40 +
                  ((Date.parse(row.created_at) - first) /
                    Math.max(1, last - first)) *
                    720
                }
                cy={
                  180 -
                  ((Number(reading(row, metric)) - min) /
                    Math.max(1, max - min)) *
                    140
                }
                r="3"
                fill="var(--primary, #087f86)"
              >
                <title>
                  {new Date(row.created_at).toLocaleString()}:{" "}
                  {reading(row, metric)}
                </title>
              </circle>
            ))}
            <text x="40" y="215">
              {new Date(first).toLocaleString()}
            </text>
            <text x="760" y="215" textAnchor="end">
              {new Date(last).toLocaleString()}
            </text>
          </svg>
        </>
      )}
      <TechnicalDetails title={text("Số đo chi tiết", "Raw readings")}>
        <DataTable
          rows={points.map((row) => ({
            ...row,
            [metric]: reading(row, metric),
          }))}
          columns={["created_at", "location", "source_type", metric]}
        />
      </TechnicalDetails>
    </>
  );
}
export default function EnvironmentViews({ rows, mode }) {
  const lang = useLanguage(),
    text = (vi, en) => (lang === "en" ? en : vi);
  const [sensor, setSensor] = useState(null),
    [type, setType] = useState("");
  const valid = (value) =>
    value != null && value !== "" && Number.isFinite(Number(value));
  const latest = new Map();
  [...rows]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((row) => {
      const key = `${row.source_type}:${row.device_id}:${row.rack_id}`;
      if (!latest.has(key)) latest.set(key, row);
    });
  const readings = [...latest.values()],
    devices = [
      ...new Set(readings.map((row) => `${row.source_type}:${row.device_id}`)),
    ];
  const metric = (row, key) => row.values?.[key] ?? row[key];
  if (mode === "sensors") {
    const sensors = readings.flatMap((row) =>
      metrics
        .filter(([key]) => !type || type === key)
        .map(([key, vi, en, unit]) => ({
          ...row,
          id: `${row.id}:${key}`,
          reading_id: row.id,
          sensor_key: key,
          sensor_name: text(vi, en),
          current: validNumber(metric(row, key))
            ? `${metric(row, key)} ${unit}`
            : "—",
          status: row.sensor_status || "Unconfirmed",
        })),
    );
    return (
      <>
        <div className="filter-bar">
          <label>
            {text("Loại cảm biến", "Sensor type")}
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="">{text("Tất cả", "All")}</option>
              {metrics.map(([key, vi, en]) => (
                <option key={key} value={key}>
                  {text(vi, en)}
                </option>
              ))}
            </select>
          </label>
          <span className="muted">
            {text(
              "Trạng thái kết nối cảm biến chưa được API cung cấp.",
              "Sensor connectivity is not supplied by the API.",
            )}
          </span>
        </div>
        <DataTable
          rows={sensors}
          columns={[
            "sensor_name",
            "location",
            "current",
            "status",
            "created_at",
            "source_type",
          ]}
          onSelect={setSensor}
        />
        {sensor && (
          <DetailDrawer
            title={sensor.sensor_name}
            onClose={() => setSensor(null)}
          >
            <p>{sensor.location || sensor.device_id}</p>
            <strong>{sensor.current}</strong>
            <p>
              <StatusBadge value={sensor.status} />
            </p>
            <p>
              {text("Ngưỡng", "Threshold")}:{" "}
              {sensor.current_thresholds?.[sensor.sensor_key] ??
                sensor.values?.[`${sensor.sensor_key}_max`] ??
                "—"}
              <small className="muted">
                {" "}
                · {text("Ngưỡng hiện tại", "Current threshold")}
              </small>
            </p>
            <MeasurementHistory
              rows={rows.filter(
                (row) =>
                  row.rack_id === sensor.rack_id &&
                  row.device_id === sensor.device_id &&
                  row.source_type === sensor.source_type,
              )}
              metric={sensor.sensor_key}
            />
            <TechnicalDetails>
              <pre>{JSON.stringify(sensor, null, 2)}</pre>
            </TechnicalDetails>
          </DetailDrawer>
        )}
      </>
    );
  }
  return (
    <div className="environment-views">
      {mode === "overview" && (
        <div className="environment-kpis">
          {[
            ["temperature", text("Nhiệt độ", "Temperature"), "°C"],
            ["humidity", text("Độ ẩm", "Humidity"), "%"],
          ].map(([key, label, unit]) => {
            const values = readings
              .map((row) => metric(row, key))
              .filter(valid)
              .map(Number);
            return (
              <article key={key}>
                <span>{label}</span>
                <strong>
                  {values.length
                    ? (
                        values.reduce((a, b) => a + b, 0) / values.length
                      ).toFixed(1)
                    : "—"}{" "}
                  {unit}
                </strong>
                <small>
                  {text(
                    "Trung bình các số đo gần nhất",
                    "Average of latest readings",
                  )}
                </small>
              </article>
            );
          })}
          <article>
            <span>{text("Phát hiện khói", "Smoke detected")}</span>
            <strong>
              {
                readings.filter((row) =>
                  [true, 1, "1"].includes(metric(row, "smoke")),
                ).length
              }
            </strong>
            <small>
              {text("Theo số đo đã nhận", "From received readings")}
            </small>
          </article>
        </div>
      )}
      {devices.map((key) => {
        const entries = readings.filter(
          (row) => `${row.source_type}:${row.device_id}` === key,
        );
        return (
          <details className="environment-device" key={key}>
            <summary>
              {entries[0].device_id || text("Chưa xác định IPC", "Unknown IPC")}{" "}
              <StatusBadge value={entries[0].source_type} />{" "}
              <small>{entries.length} Rack</small>
            </summary>
            <div className="environment-sensor-grid">
              {entries.map((row) => (
                <article key={row.id ?? row.rack_id}>
                  <h3>
                    {row.location ||
                      `Rack ${row.rack_index ?? row.rack_id ?? "—"}`}
                  </h3>
                  <StatusBadge
                    value={
                      ["temperature", "humidity", "smoke"].some(
                        (key) =>
                          validNumber(metric(row, key)) &&
                          validNumber(row.current_thresholds?.[key]) &&
                          Number(metric(row, key)) >
                            Number(row.current_thresholds[key]),
                      )
                        ? [true, 1, "1"].includes(metric(row, "smoke"))
                          ? "Error"
                          : "Warning"
                        : ["temperature", "humidity", "smoke"].every(
                              (key) =>
                                validNumber(metric(row, key)) &&
                                validNumber(row.current_thresholds?.[key]),
                            )
                          ? "Normal"
                          : "Unconfirmed"
                    }
                  />
                  {[
                    ["temperature", text("Nhiệt độ", "Temperature"), "°C"],
                    ["humidity", text("Độ ẩm", "Humidity"), "%"],
                    ["smoke", text("Khói", "Smoke"), ""],
                  ].map(([key, label, unit]) => (
                    <div className="environment-sensor-value" key={key}>
                      <span>{label}</span>
                      <strong>
                        {key === "smoke"
                          ? metric(row, key) == null
                            ? "—"
                            : [true, 1, "1"].includes(metric(row, key))
                              ? text("Có khói", "Detected")
                              : text("Không có khói", "No smoke")
                          : valid(metric(row, key))
                            ? `${Number(metric(row, key)).toFixed(1)} ${unit}`
                            : "—"}
                      </strong>
                    </div>
                  ))}
                  <small>
                    {row.created_at
                      ? new Date(row.created_at).toLocaleString()
                      : "—"}
                  </small>
                  <p className="muted">
                    {text(
                      "Số đo cuối đã nhận; trạng thái online sensor chưa được API cung cấp.",
                      "Last received reading; sensor online status is not supplied by the API.",
                    )}
                  </p>
                </article>
              ))}
            </div>
          </details>
        );
      })}
      {!readings.length && (
        <p className="empty">
          {text("Chưa có số đo phù hợp.", "No matching readings.")}
        </p>
      )}
    </div>
  );
}
