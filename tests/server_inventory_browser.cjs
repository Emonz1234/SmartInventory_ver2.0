const { chromium } = require("../.tools/ui/node_modules/playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("http://127.0.0.1:3100");
    await page.getByLabel("username", { exact: true }).fill("inventory-demo");
    await page
      .getByLabel("password", { exact: true })
      .fill("local-demo-only-2026");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page
      .getByRole("heading", { name: "Inventory Distribution by IPC" })
      .waitFor();
    assert.equal(await page.locator(".inventory-metrics article").count(), 8);
    fs.mkdirSync("test-results/server-inventory", { recursive: true });
    await page.screenshot({
      path: "test-results/server-inventory/dashboard.png",
      fullPage: true,
    });
    await page.locator("nav button").filter({ hasText: "Inventory" }).click();
    const search = page.getByPlaceholder("Product Name / SKU / Barcode");
    await search.fill("Bearing A01");
    await page.getByTestId("product-BR-A01-REAL").waitFor();
    assert.equal(await page.locator(".inv-product-row").count(), 1);
    assert.match(
      await page.getByTestId("product-BR-A01-REAL").innerText(),
      /35 pcs/,
    );
    await page
      .getByRole("button", { name: "Bearing A01", exact: true })
      .click();
    const drawer = page.locator("dialog");
    assert.equal(await drawer.locator(".inv-location").count(), 2);
    assert.match(await drawer.innerText(), /IPC01 \/ Physical Cabinet 01 \/ REAL-R01/);
    await drawer
      .getByRole("button", { name: "Transactions", exact: true })
      .click();
    await drawer.locator(".inv-history").waitFor();
    for (const text of ["PUT", "PICK", "FAILED"])
      assert.match(await drawer.innerText(), new RegExp(text));
    await page.screenshot({
      path: "test-results/server-inventory/detail-history.png",
      fullPage: true,
    });
    await drawer.getByRole("button", { name: "Đóng chi tiết" }).click();
    await page.getByLabel("Show Simulation Data").check();
    await page.getByTestId("product-BR-A01-SIMULATION").waitFor();
    assert.equal(await page.locator(".inv-product-row").count(), 2);
    for (const scope of ["REAL", "SIMULATION"])
      assert.match(
        await page.getByTestId("product-BR-A01-" + scope).innerText(),
        /35 pcs/,
      );
    await page.screenshot({
      path: "test-results/server-inventory/products.png",
      fullPage: true,
    });
    await page.getByLabel("Nguồn dữ liệu").selectOption("SIMULATION");
    await page.getByTestId("product-BR-A01-SIMULATION").waitFor();
    assert.equal(await page.locator(".inv-product-row").count(), 1);
    await page
      .getByRole("button", { name: "By Location", exact: true })
      .click();
    await page.locator(".inv-tree").waitFor();
    assert.match(await page.locator(".inv-tree").innerText(), /IPCSIM01/);
    assert.doesNotMatch(await page.locator(".inv-tree").innerText(), /IPC01/);
    await page.getByLabel("Show Simulation Data").uncheck();
    await page
      .locator(".inv-tree")
      .getByText("IPC01", { exact: false })
      .first()
      .waitFor();
    assert.doesNotMatch(
      await page.locator(".inv-tree").innerText(),
      /IPCSIM01/,
    );
    await search.fill("");
    await page.getByLabel("IPC", { exact: true }).selectOption("IPC01");
    assert.match(await page.locator(".inv-tree").innerText(), /FAULT/);
    assert.match(await page.locator(".inv-tree").innerText(), /EMPTY/);
    await page.screenshot({
      path: "test-results/server-inventory/locations.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "By Product", exact: true }).click();
    await page.getByLabel("IPC", { exact: true }).selectOption("");
    await page
      .getByLabel("Stock Status", { exact: true })
      .selectOption("Low Stock");
    assert.match(
      await page
        .locator(".inv-product-row")
        .allTextContents()
        .then((x) => x.join(" ")),
      /ESP32 DevKit/,
    );
    await page
      .getByLabel("Stock Status", { exact: true })
      .selectOption("Out of Stock");
    assert.ok((await page.locator(".inv-product-row").count()) > 0);
    await page.getByLabel("Stock Status", { exact: true }).selectOption("");
    await page.getByLabel("Show Simulation Data").check();
    await page.getByTestId("product-BR-A01-SIMULATION").waitFor();
    await page
      .getByLabel("Sync Status", { exact: true })
      .selectOption("Pending");
    assert.ok((await page.locator(".inv-product-row").count()) > 0);
    assert.equal(
      await page.locator(".inv-product-row .inv-chip.real").count(),
      await page.locator(".inv-product-row").count(),
    );
    await page.getByLabel("Sync Status", { exact: true }).selectOption("");
    await search.fill("893000000001");
    assert.equal(await page.locator(".inv-product-row").count(), 2);
    await search.fill("no-such-product");
    await page
      .getByText("Không có sản phẩm phù hợp. Hãy đổi bộ lọc.")
      .waitFor();
    await search.fill("Bearing A01");
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: `test-results/server-inventory/responsive-${width}.png`,
        fullPage: true,
      });
    }
    await page
      .getByTestId("product-BR-A01-REAL")
      .getByRole("button", { name: "Bearing A01", exact: true })
      .click();
    await drawer
      .getByRole("button", { name: "Inventory Adjustment", exact: true })
      .first()
      .click();
    await drawer.getByLabel("New Quantity", { exact: true }).fill("51");
    await drawer
      .getByLabel("Reason", { exact: true })
      .fill("Browser capacity validation; must not change stock");
    assert.match(
      await drawer.locator(".inv-adjust").innerText(),
      /Difference: 31/,
    );
    await drawer
      .getByRole("button", { name: "Xác nhận adjustment", exact: true })
      .click();
    await drawer
      .getByRole("alert")
      .filter({ hasText: "capacity exceeded" })
      .waitFor();
    await page.screenshot({
      path: "test-results/server-inventory/adjustment-validation.png",
      fullPage: true,
    });
    await drawer.getByRole("button", { name: "Hủy", exact: true }).click();
    await drawer.getByRole("button", { name: "Đóng chi tiết" }).click();
    assert.match(
      await page.getByTestId("product-BR-A01-REAL").innerText(),
      /35 pcs/,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 12 inventory scenarios, source totals, barcode, empty state, dashboard and responsive widths 1440/1280/1024.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
