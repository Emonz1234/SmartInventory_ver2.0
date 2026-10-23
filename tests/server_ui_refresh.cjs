// Isolated UI contract checks: every API request is intercepted; no live DB writes.
const { chromium } = require("../.tools/ui/node_modules/playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const permissionNames = [
  "dashboard.view",
  "ipc.view",
  "ipc.manage",
  "cabinet.view",
  "cabinet.control",
  "environment.view",
  "alarm.view",
  "alarm.acknowledge",
  "inventory.view",
  "inventory.create",
  "inventory.manage",
  "inventory.move",
  "audit.view",
  "user.view",
  "user.manage",
  "role.manage",
  "system.manage",
];
const grants = Object.fromEntries(permissionNames.map((p) => [p, ["ALL"]]));
const devices = ["REAL", "SIMULATION"].map((source_type, i) => ({
  id: i ? "IPCSIM01" : "IPC01",
  name: i ? "Simulator" : "Physical IPC",
  source_type,
  online: !i,
  mqtt_connected: !i,
  serial_connected: !i,
  synchronized: !i,
  last_seen: "2026-10-04T09:00:00Z",
  last_sync: "2026-10-04T09:00:00Z",
  cabinet_group_count: 1,
  racks: [1, 2],
}));
const location = (source) => ({
  id: source === "REAL" ? 1 : 2,
  source_type: source,
  ipc_id: source === "REAL" ? "IPC01" : "IPCSIM01",
  cabinet_id: 1,
  cabinet: "Cabinet 01",
  rack_id: 1,
  rack: "Rack 01",
  path: "IPC / Cabinet 01 / Rack 01",
  location_code: "A01",
  capacity: 100,
  quantity: 5,
  status: "AVAILABLE",
  sync_status: "Synced",
  goods: [{ item_id: 1, name: "Bearing", quantity: 5 }],
});
const products = (sources) =>
  sources.flatMap((source_type) =>
    Array.from({ length: 24 }, (_, i) => ({
      id: i + 1,
      source_type,
      name: i ? `Product ${i + 1}` : "Bearing",
      sku: `SKU-${i + 1}`,
      barcode: `BAR-${i + 1}`,
      category: "Parts",
      unit: "pcs",
      quantity: 5,
      available_quantity: 5,
      min_stock: 10,
      max_stock: 100,
      stock_status: "Low Stock",
      sync_status: "Synced",
      last_updated: "2026-10-04T09:00:00Z",
      locations: [location(source_type)],
    })),
  );
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  const errors = [],
    writes = [];
  let authenticated = false,
    restricted = false,
    failure = false,
    empty = false;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      name = url.pathname.slice(5),
      method = req.method();
    const sources =
      url.searchParams.get("source_type") === "ALL"
        ? ["REAL", "SIMULATION"]
        : [url.searchParams.get("source_type") || "REAL"];
    let body;
    if (name === "session") {
      if (method === "POST") authenticated = true;
      if (method === "DELETE") authenticated = false;
      body = {
        authenticated,
        username: "UI reviewer",
        grants: restricted ? { "inventory.view": ["REAL"] } : grants,
      };
    } else if (failure)
      return route.fulfill({
        status: 503,
        json: { error: "Server disconnected" },
      });
    else if (method !== "GET") {
      writes.push({ name, method, body: req.postDataJSON() });
      body = {};
    } else if (name === "inventory-overview")
      body = {
        products: empty ? [] : products(sources),
        locations: empty ? [] : sources.map(location),
        devices: devices.filter((d) => sources.includes(d.source_type)),
        transactions: [],
        pending_sync: 1,
      };
    else if (name === "ipcs")
      body = devices.filter((d) => sources.includes(d.source_type));
    else if (name === "rack-status")
      body = [
        {
          id: 1,
          name: "Rack 01",
          source_type: sources[0],
          ipc_id: "IPC01",
          cabinet: "Cabinet 01",
          online: true,
          state: "IDLE",
          temperature: 20,
        },
      ];
    else if (name === "settings")
      body = { temperature_max: 40, humidity_max: 80 };
    else if (name === "users")
      body = [{ id: 1, username: "operator", is_active: true, roles: [] }];
    else if (name === "roles")
      body = [{ id: 1, name: "Operator", permissions: {} }];
    else if (name === "categories") body = [{ id: 1, name: "Parts" }];
    else if (name === "alarms")
      body = [
        {
          id: 1,
          source_type: sources[0],
          severity: "HIGH",
          code: "TEST",
          active: true,
        },
      ];
    else body = [];
    await route.fulfill({ status: 200, json: body });
  });
  const nav = (name) =>
    page.locator("nav button").filter({ hasText: name }).click();
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  try {
    await page.goto("http://127.0.0.1:3101");
    await page.getByLabel("username", { exact: true }).fill("reviewer");
    await page.getByLabel("password", { exact: true }).fill("test-only");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.getByRole("heading", { name: "Device status" }).waitFor();
    fs.mkdirSync("test-results/server-ui-refresh", { recursive: true });
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await noOverflow();
      await page.screenshot({
        path: `test-results/server-ui-refresh/dashboard-${size.width}.png`,
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Thu gọn sidebar" }).click();
    assert.equal(await page.locator(".shell.collapsed").count(), 1);
    await page.getByRole("button", { name: "Mở rộng sidebar" }).click();
    for (const name of [
      "Inventory",
      "IPC Devices",
      "Cabinets",
      "Environment",
      "Alarms",
      "Storage Map",
      "Transactions",
      "Audit Logs",
      "Users",
      "Roles & Permissions",
      "Settings",
    ]) {
      await nav(name);
      await page
        .getByRole("heading", { name, exact: true, level: 1 })
        .waitFor();
      await noOverflow();
    }
    await nav("Inventory");
    await page.getByTestId("product-SKU-1-REAL").waitFor();
    assert.equal(await page.locator(".inv-product-row").count(), 20);
    await page.getByRole("button", { name: "Sau", exact: true }).click();
    assert.equal(await page.locator(".inv-product-row").count(), 4);
    await page.getByPlaceholder("Product Name / SKU / Barcode").fill("Bearing");
    await page.getByRole("button", { name: "Bearing", exact: true }).click();
    await page.locator("dialog").waitFor();
    assert.match(await page.locator("dialog").innerText(), /Cabinet 01/);
    await page.getByRole("button", { name: "Đóng chi tiết" }).click();
    await page.getByLabel("Nguồn dữ liệu").selectOption("SIMULATION");
    await page.getByTestId("product-SKU-1-SIMULATION").waitFor();
    assert.equal(await page.getByTestId("product-SKU-1-REAL").count(), 0);
    await page.getByLabel("Nguồn dữ liệu").selectOption("ALL");
    await page.getByTestId("product-SKU-1-REAL").waitFor();
    await nav("IPC Devices");
    await page.getByRole("button", { name: "IPC01", exact: true }).waitFor();
    await page.getByRole("searchbox").fill("IPCSIM");
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.getByRole("searchbox").fill("");
    await page.getByRole("button", { name: /Heartbeat/ }).click();
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await noOverflow();
      await page.screenshot({
        path: `test-results/server-ui-refresh/ipcs-${size.width}.png`,
        fullPage: true,
      });
    }
    await nav("Cabinets");
    await page.getByRole("button", { name: "Rack 01", exact: true }).click();
    await page.getByRole("button", { name: "OPEN", exact: true }).click();
    await page.getByRole("heading", { name: "Xác nhận thao tác" }).waitFor();
    await page.getByRole("button", { name: "Hủy", exact: true }).click();
    assert.equal(writes.length, 0);
    await nav("Users");
    await page.getByLabel("username", { exact: true }).fill("new-operator");
    await page.getByLabel("password", { exact: true }).fill("test-only");
    await page
      .locator("form")
      .getByRole("button", { name: "Lưu", exact: true })
      .click();
    await page.getByText("Đã lưu thành công.").waitFor();
    assert.equal(writes.at(-1).name, "users");
    assert.equal(writes.at(-1).method, "POST");
    await page.getByRole("button", { name: "1", exact: true }).click();
    await page
      .getByLabel("password", { exact: true })
      .fill("updated-test-only");
    await page
      .locator("form")
      .getByRole("button", { name: "Lưu", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector('[role="status"]')
        ?.textContent.includes("thành công"),
    );
    assert.equal(writes.at(-1).method, "PATCH");
    assert.equal(writes.at(-1).body.id, 1);
    await nav("Settings");
    await page.getByLabel("value", { exact: true }).fill("45");
    await page
      .locator("form")
      .getByRole("button", { name: "Lưu", exact: true })
      .click();
    await page.getByText("Đã lưu thành công.").waitFor();
    assert.deepEqual(writes.at(-1), {
      name: "settings",
      method: "PATCH",
      body: { key: "temperature_max", value: 45 },
    });
    await page.getByRole("button", { name: "Đăng xuất" }).click();
    await page
      .getByRole("heading", { name: "Đăng nhập", exact: true })
      .waitFor();
    restricted = true;
    authenticated = true;
    await page.reload();
    await page.locator("nav").waitFor();
    await nav("Inventory");
    assert.equal(await page.locator("nav button").count(), 3);
    await page.getByLabel("Nguồn dữ liệu").selectOption("SIMULATION");
    await page
      .getByText("Bạn không có quyền xem nguồn đã chọn. Hãy đổi bộ lọc nguồn.")
      .waitFor();
    restricted = false;
    failure = true;
    await page.reload();
    await nav("IPC Devices");
    await page
      .getByRole("alert")
      .filter({ hasText: "Server disconnected" })
      .waitFor();
    failure = false;
    empty = true;
    await nav("Inventory");
    await page
      .getByText("Không có sản phẩm phù hợp. Hãy đổi bộ lọc.")
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 12 pages, login/logout, permissions, source filtering, tables, pagination, drawer, command cancellation, mocked CRUD, error/empty, 1366/1920 without document overflow. No live API writes.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
