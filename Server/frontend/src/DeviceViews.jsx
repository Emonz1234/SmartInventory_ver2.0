import React, { useEffect, useState } from "react";
import { useLanguage } from "./i18n";
import { StatusBadge, DetailDrawer, TechnicalDetails } from "./ui.jsx";

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

const ordered = (rows) =>
  [...rows].sort((a, b) =>
    String(
      a.cabinet_index ?? a.rack_index ?? a.address ?? a.code ?? a.name ?? a.id,
    ).localeCompare(
      String(
        b.cabinet_index ??
          b.rack_index ??
          b.address ??
          b.code ??
          b.name ??
          b.id,
      ),
      undefined,
      { numeric: true },
    ),
  );
const groupBy = (rows, key) =>
  rows.reduce((map, row) => {
    const value = key(row);
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
    return map;
  }, new Map());
const nodeStatus = (row) =>
  (row.maintenance_status &&
    !["NORMAL", "NONE", "READY"].includes(
      String(row.maintenance_status).toUpperCase(),
    )) ||
  String(row.status).toUpperCase() === "MAINTENANCE"
    ? "Maintenance"
    : deviceStatus(row);
function Aggregate({ rows, fallback }) {
  const statuses = rows.map(nodeStatus);
  const status =
    ["Error", "Warning", "Maintenance", "Offline", "Unconfirmed", "Busy"].find(
      (value) => statuses.includes(value),
    ) ||
    fallback ||
    (statuses.length && statuses.every((value) => value === "Ready")
      ? "Ready"
      : "Online");
  const count = statuses.filter((value) => value === status).length;
  return (
    <span className="device-node-status">
      <StatusBadge value={status} />
      {count > 0 &&
        ["Error", "Warning", "Maintenance", "Offline"].includes(status) && (
          <small>{count}</small>
        )}
    </span>
  );
}
function CabinetBranches({ rows, groups = [], onSelect, text }) {
  const [expanded, setExpanded] = useState(new Set()),
    [selected, setSelected] = useState(null),
    [query, setQuery] = useState("");
  const cabinets = groupBy(rows, (row) => String(row.cabinet_id));
  const all = groups.length
    ? ordered(groups)
    : ordered(
        [...cabinets].map(([id, items]) => ({
          id,
          name: items[0].cabinet,
          code: items[0].cabinet_code,
          cabinet_index: items[0].cabinet_index,
        })),
      );
  return (
    <div className="device-children">
      <input
        type="search"
        aria-label={text("Tìm cabinet / rack", "Search cabinets / racks")}
        placeholder={text("Tìm cabinet / rack", "Search cabinets / racks")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {all
        .filter(
          (cabinet) =>
            !query ||
            JSON.stringify([
              cabinet.name,
              cabinet.code,
              cabinet.cabinet_index,
              ...(cabinets.get(String(cabinet.id)) || []).map((rack) => [
                rack.name,
                rack.code,
                rack.rack_index,
              ]),
            ])
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .map((cabinet) => {
          const racks = ordered(cabinets.get(String(cabinet.id)) || []);
          return (
            <details
              className="cabinet-tree"
              key={cabinet.id}
              onToggle={(event) => {
                if (event.target === event.currentTarget) {
                  const open = event.currentTarget.open;
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    if (open) next.add(cabinet.id);
                    else next.delete(cabinet.id);
                    return next;
                  });
                }
              }}
            >
              <summary>
                <span className="device-node-name">
                  {cabinet.name ||
                    cabinet.code ||
                    `Cabinet ${cabinet.cabinet_index ?? cabinet.id}`}
                </span>
                <small>{racks.length} Rack</small>
                <Aggregate
                  rows={racks}
                  fallback={
                    cabinet.configuration_status?.startsWith("pending")
                      ? "Warning"
                      : racks.length
                        ? undefined
                        : "Unconfirmed"
                  }
                />
                <button
                  className="link device-detail-link"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSelected({ ...cabinet, racks });
                  }}
                >
                  {text("Chi tiết", "Details")}
                </button>
              </summary>
              {expanded.has(cabinet.id) && (
                <div className="device-rack-list">
                  {racks.map((rack) => (
                    <button
                      type="button"
                      className="device-rack-row secondary"
                      key={rack.id}
                      onClick={() => onSelect(rack)}
                    >
                      <span>
                        <strong>
                          {rack.name ||
                            `Rack ${rack.rack_index ?? rack.address ?? rack.id}`}
                        </strong>
                        <small>
                          {rack.last_update
                            ? new Date(rack.last_update).toLocaleString()
                            : text("Chưa có dữ liệu", "No telemetry yet")}
                        </small>
                      </span>
                      <StatusBadge value={nodeStatus(rack)} />
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                  {!racks.length && (
                    <p className="muted">
                      {text("Chưa có rack.", "No racks configured.")}
                    </p>
                  )}
                </div>
              )}
            </details>
          );
        })}
      {selected && (
        <DetailDrawer
          title={selected.name || selected.code || "Cabinet"}
          onClose={() => setSelected(null)}
        >
          <p>{selected.racks[0]?.ipc_id || selected.device_id}</p>
          <Aggregate rows={selected.racks} />
          <p>
            {selected.racks.length} Rack · {text("Khả dụng", "Available")}:{" "}
            {
              selected.racks.filter((row) => deviceStatus(row) === "Ready")
                .length
            }
          </p>
          <div className="cabinet-rack-preview">
            {selected.racks.map((rack) => (
              <button
                className="secondary"
                key={rack.id}
                onClick={() => {
                  setSelected(null);
                  onSelect(rack);
                }}
              >
                {rack.name || `Rack ${rack.rack_index}`}
                <StatusBadge value={nodeStatus(rack)} />
              </button>
            ))}
          </div>
          <TechnicalDetails>
            <pre>{JSON.stringify(selected, null, 2)}</pre>
          </TechnicalDetails>
        </DetailDrawer>
      )}
    </div>
  );
}
function SourceSections({ sources, children, text }) {
  return (
    <div className="device-tree">
      <p className="device-hierarchy">
        Server <span aria-hidden="true">→</span> IPC{" "}
        <span aria-hidden="true">→</span> Cabinet{" "}
        <span aria-hidden="true">→</span> Rack
      </p>
      {[
        "REAL",
        "SIMULATION",
        ...sources.filter((source) => !["REAL", "SIMULATION"].includes(source)),
      ]
        .filter((source) => sources.includes(source))
        .map((source) => (
          <section className="device-source" key={source}>
            <div className="section-heading">
              <h3>{source === "REAL" ? "REAL SYSTEM" : source}</h3>
              <StatusBadge value={source} />
            </div>
            {children(source)}
          </section>
        ))}
      {!sources.length && (
        <p className="empty">
          {text("Không có thiết bị phù hợp.", "No matching devices.")}
        </p>
      )}
    </div>
  );
}
function RackIPCBranch({ ipc, racks, onSelect, text }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="ipc-tree"
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="device-node-name">{ipc}</span>
        <small>
          {new Set(racks.map((row) => row.cabinet_id)).size} Cabinet
        </small>
        <Aggregate rows={racks} />
      </summary>
      {expanded && (
        <CabinetBranches rows={racks} onSelect={onSelect} text={text} />
      )}
    </details>
  );
}
export function DeviceTree({ rows, onSelect }) {
  const lang = useLanguage(),
    text = (vi, en) => (lang === "en" ? en : vi);
  const sources = [...new Set(rows.map((row) => row.source_type || "UNKNOWN"))];
  return (
    <SourceSections sources={sources} text={text}>
      {(source) =>
        [
          ...groupBy(
            rows.filter((row) => (row.source_type || "UNKNOWN") === source),
            (row) => row.ipc_id || "Unassigned",
          ),
        ]
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([ipc, racks]) => (
            <RackIPCBranch
              key={ipc}
              ipc={ipc}
              racks={racks}
              onSelect={onSelect}
              text={text}
            />
          ))
      }
    </SourceSections>
  );
}
function IPCNode({ device, api, can, onSelect, onRackSelect, text, onStatus }) {
  const [expanded, setExpanded] = useState(false),
    [snapshot, setSnapshot] = useState({
      groups: [],
      racks: [],
      loaded: false,
    }),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  const allowed = can("cabinet.view", device.source_type);
  useEffect(() => {
    if (!expanded || !allowed) return;
    let alive = true;
    const load = async () => {
      try {
        const params = new URLSearchParams({
          source_type: device.source_type,
          ipc_id: device.id,
        });
        const [groups, racks] = await Promise.all([
          api(`cabinet-groups?${params}`),
          api(`rack-status?${params}`),
        ]);
        if (alive) {
          setSnapshot({ groups, racks, loaded: true });
          onStatus?.(
            [
              "Error",
              "Warning",
              "Maintenance",
              "Offline",
              "Unconfirmed",
              "Busy",
            ].find(
              (value) =>
                deviceStatus(device) === value ||
                racks.some((row) => nodeStatus(row) === value),
            ) || deviceStatus(device),
          );
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    load();
    const timer = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [expanded, allowed, device.id, device.source_type, api, retry]);
  return (
    <details
      className="ipc-tree"
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="device-node-name">
          {device.id || device.name}
          <small>{device.name !== device.id ? device.name : null}</small>
        </span>
        <StatusBadge value={deviceStatus(device)} />
        {error ? (
          <StatusBadge value="Unconfirmed" />
        ) : (
          snapshot.loaded && <Aggregate rows={snapshot.racks} />
        )}
        <small>
          {device.cabinet_group_count ?? snapshot.groups.length} Cabinet ·{" "}
          {device.racks ?? snapshot.racks.length} Rack
        </small>
        <button
          type="button"
          className="link device-detail-link"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelect(device);
          }}
        >
          {text("Chi tiết", "Details")}
        </button>
      </summary>
      {!allowed ? (
        <p className="muted">
          {text(
            "Không có quyền xem Cabinet/Rack.",
            "Cabinet/Rack access is not permitted.",
          )}
        </p>
      ) : error ? (
        <p role="alert" className="error">
          {text("Không tải được thiết bị.", "Could not load devices.")}{" "}
          <button
            className="link"
            onClick={() => setRetry((value) => value + 1)}
          >
            {text("Thử lại", "Retry")}
          </button>
        </p>
      ) : !snapshot.loaded ? (
        <p role="status" className="muted">
          {text("Đang tải Cabinet/Rack…", "Loading Cabinets/Racks…")}
        </p>
      ) : (
        <CabinetBranches
          rows={snapshot.racks}
          groups={snapshot.groups}
          onSelect={onRackSelect}
          text={text}
        />
      )}
    </details>
  );
}
export function IPCDeviceTree({ rows, api, can, onSelect, onRackSelect }) {
  const lang = useLanguage(),
    text = (vi, en) => (lang === "en" ? en : vi);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [problem, setProblem] = useState(false),
    [childStatuses, setChildStatuses] = useState({});
  const statusOf = (row) =>
    childStatuses[`${row.source_type}:${row.id}`] || deviceStatus(row);
  const visible = rows.filter(
    (row) =>
      (!query ||
        `${row.id} ${row.name}`.toLowerCase().includes(query.toLowerCase())) &&
      (!status || statusOf(row) === status) &&
      (!problem ||
        ["Error", "Warning", "Offline", "Unconfirmed", "Maintenance"].includes(
          statusOf(row),
        )),
  );
  const sources = [
    ...new Set(visible.map((row) => row.source_type || "UNKNOWN")),
  ];
  return (
    <>
      <div className="filter-bar">
        <input
          type="search"
          aria-label={text("Tìm IPC", "Search IPC")}
          placeholder={text("Tìm IPC", "Search IPC")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label={text("Trạng thái thiết bị", "Device status")}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{text("Tất cả trạng thái", "All statuses")}</option>
          {[
            "Online",
            "Ready",
            "Offline",
            "Warning",
            "Error",
            "Busy",
            "Unconfirmed",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={problem}
            onChange={(event) => setProblem(event.target.checked)}
          />
          {text("Chỉ thiết bị cần chú ý", "Problems only")}
        </label>
      </div>
      <SourceSections sources={sources} text={text}>
        {(source) =>
          ordered(
            visible.filter((row) => (row.source_type || "UNKNOWN") === source),
          ).map((device) => (
            <IPCNode
              key={`${source}:${device.id}`}
              device={device}
              api={api}
              can={can}
              onSelect={onSelect}
              onRackSelect={onRackSelect}
              text={text}
              onStatus={(status) =>
                setChildStatuses((previous) =>
                  previous[`${device.source_type}:${device.id}`] === status
                    ? previous
                    : {
                        ...previous,
                        [`${device.source_type}:${device.id}`]: status,
                      },
                )
              }
            />
          ))
        }
      </SourceSections>
    </>
  );
}
