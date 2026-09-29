const { chromium } = require("../.tools/ui/node_modules/playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const [origin, itemId, cabinetId] = process.argv.slice(2);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.getByLabel("username", { exact: true }).fill("process-operator");
    await page
      .getByLabel("password", { exact: true })
      .fill("test-only-password");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.locator("nav button").filter({ hasText: "Goods" }).click();
    await page.getByRole("button", { name: "PART", exact: true }).click();
    const edit = page.locator(".inset");
    await edit.getByLabel("name", { exact: true }).fill("Updated remotely");
    let saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/goods") && r.request().method() === "PATCH",
    );
    await edit.getByRole("button", { name: "Lưu", exact: true }).click();
    assert((await saved).ok());
    await page.locator("nav button").filter({ hasText: "Cabinets" }).click();
    const config = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Cấu hình cabinet / rack" }),
      });
    await config.getByLabel("id", { exact: true }).fill(cabinetId);
    await config.getByLabel("name", { exact: true }).fill("Simulation cabinet");
    await config
      .getByLabel("description", { exact: true })
      .fill("Edited in React Admin");
    saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/cabinets") && r.request().method() === "PATCH",
    );
    await config
      .getByRole("button", { name: "Lưu", exact: true })
      .first()
      .click();
    assert((await saved).ok());
    fs.mkdirSync("test-results/react", { recursive: true });
    await page.screenshot({
      path: "test-results/react/server-admin.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
