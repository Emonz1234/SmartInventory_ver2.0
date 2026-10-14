import React, { useEffect, useRef, useState } from "react";
import { LanguageSelector, useLanguage } from "./i18n";
import { Icon } from "./ui.jsx";

const entry = (route, vi, en, mode = "") => ({ route, vi, en, mode });
const groups = [
  [
    "Inventory",
    "Kho hàng",
    "box",
    [
      entry("Inventory", "Sản phẩm", "Products"),
      entry("Categories", "Danh mục", "Categories"),
      entry("Stock Operations", "Nhập / Xuất", "Receive / Issue"),
      entry("Transactions", "Lịch sử giao dịch", "Transaction history"),
    ],
  ],
  [
    "Devices",
    "Thiết bị",
    "device",
    [
      entry("IPC Devices", "Cấu trúc hệ thống", "System structure"),
      entry("Alarms", "Bảo trì", "Maintenance", "maintenance"),
    ],
  ],
  [
    "Environment",
    "Môi trường",
    "climate",
    [
      entry(
        "Environment",
        "Tổng quan môi trường",
        "Environment overview",
        "overview",
      ),
      entry("Environment", "Cảm biến", "Sensors", "sensors"),
      entry(
        "Alarms",
        "Cảnh báo môi trường",
        "Environmental alerts",
        "environment",
      ),
      entry("Environment", "Lịch sử đo", "Measurement history", "history"),
    ],
  ],
  [
    "Monitoring",
    "Giám sát",
    "activity",
    [
      entry("Alarms", "Cảnh báo & sự cố", "Alerts & incidents"),
      entry("Sync", "Đồng bộ dữ liệu", "Data synchronization"),
      entry("Audit Logs", "Nhật ký hoạt động", "Activity log"),
    ],
  ],
  [
    "Access",
    "Người dùng & phân quyền",
    "users",
    [
      entry("Users", "Người dùng", "Users"),
      entry("Roles & Permissions", "Vai trò & quyền", "Roles & permissions"),
    ],
  ],
  [
    "Configuration",
    "Cấu hình",
    "settings",
    [entry("Settings", "Cấu hình hệ thống", "System settings")],
  ],
];

export default function Navigation({
  session,
  page,
  source,
  filters = {},
  labels,
  pages,
  can,
  api,
  navigate,
  logout,
  children,
}) {
  const language = useLanguage();
  const text = (vi, en) => (language === "en" ? en : vi);
  const mode = filters.ui_mode || (page === "Environment" ? "overview" : "");
  const activeGroup =
    groups.find((group) =>
      group[3].some((item) => item.route === page && item.mode === mode),
    )?.[0] || (["Cabinets", "Racks"].includes(page) ? "Devices" : null);
  const currentEntry = groups
    .flatMap((group) => group[3])
    .find((item) => item.route === page && item.mode === mode);
  const currentLabel = currentEntry
    ? text(currentEntry.vi, currentEntry.en)
    : labels[page];
  const [expanded, setExpanded] = useState(activeGroup);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [alertError, setAlertError] = useState(false);
  const top = useRef(null);
  const toggle = useRef(null);
  const account = useRef(null);
  useEffect(() => {
    setExpanded(collapsed ? null : activeGroup);
    setMobileOpen(false);
    setMenu(null);
  }, [page, mode, collapsed]);
  useEffect(() => {
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "keydown" || !top.current?.contains(event.target))
        setMenu(null);
      if (event.type === "keydown") {
        setMobileOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  const alertAllowed = can("alarm.view", source);
  useEffect(() => {
    let live = true;
    setAlerts([]);
    setAlertError(false);
    if (!alertAllowed) return;
    const load = () =>
      api(`alarms?source_type=${encodeURIComponent(source)}&active=true`)
        .then((rows) => {
          if (live) {
            setAlerts(
              Array.isArray(rows) ? rows.filter((row) => row.active) : [],
            );
            setAlertError(false);
          }
        })
        .catch(() => {
          if (live) setAlertError(true);
        });
    load();
    const timer = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [source, alertAllowed, session]);
  useEffect(() => {
    if (accountOpen) account.current?.showModal();
  }, [accountOpen]);
  const go = (name, filters) => {
    if (collapsed) setExpanded(null);
    setMobileOpen(false);
    setMenu(null);
    navigate(name, filters);
  };
  const permitted = (name) => {
    const route = pages.find((p) => p[0] === name);
    return !!route && can(route[2], "ALL");
  };
  const item = (entry, icon) => {
    const active =
      (entry.route === page && (entry.mode || "") === mode) ||
      (["IPC Devices", "Cabinets"].includes(entry.route) &&
        ["Cabinets", "Racks"].includes(page));
    const label = text(entry.vi, entry.en);
    return (
      <button
        key={`${entry.route}:${entry.mode}`}
        title={label}
        aria-current={active ? "page" : undefined}
        className={active ? "active" : ""}
        onClick={() =>
          go(entry.route, entry.mode ? { ui_mode: entry.mode } : {})
        }
      >
        <Icon name={icon} />
        <span className="nav-text">{label}</span>
      </button>
    );
  };
  return (
    <div
      className={`shell operator-navigation${collapsed ? " collapsed" : ""}${mobileOpen ? " drawer-open" : ""}`}
    >
      <header className="operator-topbar" ref={top}>
        <button
          ref={toggle}
          className="topbar-toggle"
          aria-label={text("Thu/phóng điều hướng", "Toggle navigation")}
          aria-controls="server-navigation"
          aria-expanded={mobileOpen || !collapsed}
          onClick={() =>
            window.matchMedia("(max-width: 800px)").matches
              ? setMobileOpen((v) => !v)
              : setCollapsed((v) => !v)
          }
        >
          <Icon name="list" />
        </button>
        <strong className="system-name">Smart Inventory</strong>
        <div className="topbar-actions">
          <LanguageSelector />
          {alertAllowed && (
            <div className="topbar-dropdown">
              <button
                aria-label={text("Cảnh báo đang hoạt động", "Active alerts")}
                aria-expanded={menu === "alerts"}
                onClick={() => setMenu(menu === "alerts" ? null : "alerts")}
              >
                <svg
                  className="ui-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 20h4" />
                </svg>
                {!alertError && alerts.length > 0 && (
                  <span className="notification-count">{alerts.length}</span>
                )}
              </button>
              {menu === "alerts" && (
                <div className="topbar-menu notification-menu">
                  <strong>
                    {text("Cảnh báo đang hoạt động", "Active alerts")}
                  </strong>
                  {alertError ? (
                    <p role="alert">
                      {text(
                        "Không tải được cảnh báo.",
                        "Unable to load alerts.",
                      )}
                    </p>
                  ) : alerts.length === 0 ? (
                    <p>{text("Không có cảnh báo.", "No active alerts.")}</p>
                  ) : (
                    [...alerts]
                      .sort((a, b) =>
                        String(b.created_at).localeCompare(
                          String(a.created_at),
                        ),
                      )
                      .slice(0, 8)
                      .map((row) => (
                        <button
                          key={row.id}
                          onClick={() =>
                            go("Alarms", {
                              alert_id: row.id,
                              source_type: row.source_type,
                            })
                          }
                        >
                          <span>{row.code || row.message}</span>
                          <small>
                            {row.device_id}
                            {row.rack_id ? ` · Rack ${row.rack_id}` : ""}
                          </small>
                        </button>
                      ))
                  )}
                </div>
              )}
            </div>
          )}
          <div className="topbar-dropdown">
            <button
              className="user-trigger"
              aria-expanded={menu === "user"}
              aria-label={text("Menu tài khoản", "User menu")}
              onClick={() => setMenu(menu === "user" ? null : "user")}
            >
              <Icon name="users" />
              <span>{session.username}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {menu === "user" && (
              <div className="topbar-menu">
                <strong>{session.username}</strong>
                <button
                  onClick={() => {
                    setMenu(null);
                    setAccountOpen(true);
                  }}
                >
                  {text("Thông tin tài khoản", "Account information")}
                </button>
                <button className="logout-action" onClick={logout}>
                  {text("Đăng xuất", "Logout")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {mobileOpen && (
        <button
          className="navigation-backdrop"
          aria-label={text("Đóng điều hướng", "Close navigation")}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside id="server-navigation">
        <nav aria-label={text("Điều hướng chính", "Main navigation")}>
          {permitted("Dashboard") &&
            item(
              entry("Dashboard", labels.Dashboard, labels.Dashboard),
              "grid",
            )}
          {groups.map(([name, vi, icon, names]) => {
            const candidates = names.map((item) =>
              item.route === "IPC Devices" &&
              !permitted("IPC Devices") &&
              permitted("Cabinets")
                ? { ...item, route: "Cabinets" }
                : item,
            );
            const visible = candidates.filter((item) => permitted(item.route));
            if (!visible.length) return null;
            const open = expanded === name;
            return (
              <div
                className={`nav-group${open ? " open" : ""}${activeGroup === name ? " current-group" : ""}`}
                key={name}
              >
                <button
                  className="nav-group-trigger"
                  title={text(vi, name)}
                  aria-label={text(vi, name)}
                  aria-expanded={open}
                  aria-controls={`nav-${name}`}
                  onClick={() => setExpanded(open ? null : name)}
                >
                  <Icon name={icon} />
                  <span className="nav-text">{text(vi, name)}</span>
                  <span className="nav-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
                {open && (
                  <div id={`nav-${name}`} className="nav-submenu">
                    {visible.map((p) =>
                      item(p, p.route === "Settings" ? "settings" : icon),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="navigation-content">
        <div
          className="navigation-breadcrumb"
          aria-label={text("Vị trí trang", "Current location")}
        >
          {activeGroup && (
            <span>
              {text(groups.find((g) => g[0] === activeGroup)[1], activeGroup)}{" "}
              /{" "}
            </span>
          )}
          {currentLabel}
        </div>
        {children}
      </div>
      {accountOpen && (
        <dialog
          ref={account}
          className="account-dialog"
          onCancel={() => setAccountOpen(false)}
          onClose={() => setAccountOpen(false)}
        >
          <h2>{text("Thông tin tài khoản", "Account information")}</h2>
          <p>{session.username}</p>
          <button
            onClick={() => {
              account.current.close();
              setAccountOpen(false);
            }}
          >
            {text("Đóng", "Close")}
          </button>
        </dialog>
      )}
    </div>
  );
}
