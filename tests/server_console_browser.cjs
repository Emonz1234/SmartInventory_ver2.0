const { chromium } = require("../.tools/ui/node_modules/playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.CONSOLE_TEST_URL || "http://127.0.0.1:3100");
    await page.getByLabel("username", { exact: true }).fill("console-test");
    await page
      .getByLabel("password", { exact: true })
      .fill("isolated-browser-test");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await page.getByRole("heading", { name: "Giám sát rack" }).waitFor();
    fs.mkdirSync("test-results/server-console", { recursive: true });
    await page.screenshot({
      path: "test-results/server-console/dashboard.png",
      fullPage: true,
    });
    const names = [
      "IPC Devices",
      "Cabinets",
      "Environment",
      "Alarms",
      "Goods",
      "Storage Map",
      "Transactions",
      "Audit Logs",
      "Users",
      "Roles & Permissions",
      "Settings",
    ];
    for (const name of names) {
      await page.locator("nav button").filter({ hasText: name }).click();
      await page
        .getByRole("heading", { name, exact: true, level: 1 })
        .waitFor();
      await page.waitForFunction(
        () =>
          !document
            .querySelector('main [role="status"]')
            ?.textContent.includes("Đang tải"),
      );
      assert.equal(
        await page.locator('[role="alert"]').count(),
        0,
        name + " API failure",
      );
    }
    await page.locator("nav button").filter({ hasText: "IPC Devices" }).click();
    await page.getByRole("button", { name: "IPC1", exact: true }).click();
    await page.getByRole("heading", { name: "IPC1 [REAL]" }).waitFor();
    await page
      .getByRole("button", { name: "IPC1 - Group 1", exact: true })
      .click();
    await page.getByRole("button", { name: "Rack 1", exact: true }).click();
    await page.locator(".breadcrumb").waitFor();
    await page.locator("nav button").filter({ hasText: "Storage Map" }).click();
    await page
      .locator(".position")
      .filter({ hasText: "Test Position" })
      .click();
    await page
      .getByRole("cell", { name: "Browser verification part", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Giữ chỗ", exact: true }).click();
    await page
      .getByRole("button", { name: "Bỏ giữ chỗ", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Bỏ giữ chỗ", exact: true }).click();
    await page.getByRole("button", { name: "Giữ chỗ", exact: true }).waitFor();
    await page.screenshot({
      path: "test-results/server-console/storage-map.png",
      fullPage: true,
    });
    await page.locator("nav button").filter({ hasText: "IPC Devices" }).click();
    await page.getByLabel("Nguồn dữ liệu").selectOption("SIMULATION");
    await page.getByRole("button", { name: "IPCSIM", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "IPC1", exact: true }).count(),
      0,
    );
    await page.getByLabel("Nguồn dữ liệu").selectOption("ALL");
    await page.getByRole("button", { name: "IPC1", exact: true }).waitFor();
    await page.getByRole("button", { name: "IPCSIM", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 12 pages, login, source filter, IPC/group/rack drilldown, storage reservation; no browser runtime errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
