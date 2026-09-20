const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const [origin, itemId, cabinetId] = process.argv.slice(2);
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440, height:1000}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.getByLabel('Tên đăng nhập').fill('process-operator');
    await page.getByLabel('Mật khẩu').fill('test-only-password');
    await page.getByRole('button', {name:'Đăng nhập', exact:true}).click();
    await page.getByRole('button', {name:'Danh mục', exact:true}).click();
    await page.getByText('Sửa thông tin bản ghi', {exact:true}).click();
    const edit = page.locator('details');
    await edit.getByLabel('Chọn bản ghi').selectOption(itemId);
    await edit.getByLabel('name', {exact:true}).fill('Updated remotely');
    let saved = page.waitForResponse(r => r.url().endsWith('/api/items') && r.request().method() === 'PATCH');
    await edit.getByRole('button', {name:'Lưu', exact:true}).click();
    assert((await saved).ok());
    await page.locator('section > select').selectOption('cabinets');
    await edit.getByLabel('Chọn bản ghi').selectOption(cabinetId);
    await edit.getByLabel('description', {exact:true}).fill('Edited in React Admin');
    saved = page.waitForResponse(r => r.url().endsWith('/api/cabinets') && r.request().method() === 'PATCH');
    await edit.getByRole('button', {name:'Lưu', exact:true}).click();
    assert((await saved).ok());
    await page.getByRole('cell', {name:'Edited in React Admin', exact:true}).waitFor();
    fs.mkdirSync('test-results/react', {recursive:true});
    await page.screenshot({path:'test-results/react/server-admin.png', fullPage:true});
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(e => {console.error(e); process.exit(1);});
