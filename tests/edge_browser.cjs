// Real browser -> local FastAPI -> authenticated Django -> MQTT command.
const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const [origin, rack, cabinet, physicalOrigin] = process.argv.slice(2);
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    fs.mkdirSync('test-results/react', {recursive:true});
    for (const [base, expected, name] of [[origin, 21, 'simulation'], [physicalOrigin, 6, 'physical']]) {
      await page.goto(`${base}/ui/cabinets`);
      await page.getByLabel('Edge API token').fill('local-test-token');
      await page.getByLabel('Tên đăng nhập').fill('process-operator');
      await page.getByLabel('Mật khẩu').fill('test-only-password');
      await page.getByRole('button', {name:'Đăng nhập', exact:true}).click();
      await page.getByRole('heading', {name:'Cabinet Control', exact:true}).waitFor();
      await page.waitForFunction(n => Array.from(document.querySelectorAll('a')).filter(a => a.textContent === 'View racks').length === n, expected);
      assert.equal(await page.getByRole('link', {name:'View racks', exact:true}).count(), expected);
      await page.screenshot({path:`test-results/react/${name}-topology.png`, fullPage:true});
    }
    await page.goto(`${origin}/ui/inventory`);
    await page.getByRole('heading', {name:'Hàng hóa', exact:true}).waitFor();
    const itemRow = page.getByRole('row', {name:/PART/});
    await itemRow.getByRole('button', {name:'PICK / PUT'}).click();
    await page.getByRole('button', {name:'PICK', exact:true}).waitFor();
    await page.getByRole('button', {name:'PUT', exact:true}).click();
    await page.getByLabel('Vị trí').click();
    await page.getByRole('option', {name:/Rack 1/}).waitFor();
    await page.getByRole('button', {name:'Hủy', exact:true}).click();
    await page.goto(`${origin}/ui/operation?cabinet=${cabinet}&rack=${rack}`);
    await page.getByRole('heading', {name: /process-sim/}).waitFor();
    await page.getByRole('button', {name:'Đăng xuất', exact:true}).waitFor();
    await page.goto(`${origin}/ui/inventory`);
    await page.getByRole('button', {name:'Đăng xuất', exact:true}).waitFor();
    await page.goto(`${origin}/ui/operation?cabinet=${cabinet}&rack=${rack}`);
    await page.getByRole('button', {name:'Đăng xuất', exact:true}).waitFor();
    assert(await page.getByRole('button', {name:'OPEN', exact:true}).isDisabled());
    await page.getByLabel('Hàng hóa', {exact:true}).click();
    await page.getByRole('option', {name:/PART/}).click();
    await page.getByLabel('Ô chứa', {exact:true}).click();
    await page.getByRole('option', {name:'B', exact:true}).click();
    await page.getByLabel('Số lượng', {exact:true}).fill('2');
    const sent = page.waitForResponse(r => r.url().endsWith('/api/operator/operations') && r.request().method() === 'POST');
    await page.getByRole('button', {name:'PICK', exact:true}).click();
    const response = await sent;
    assert(response.ok(), await response.text());
    const operation = await response.json();
    fs.mkdirSync('test-results/react', {recursive:true});
    await page.screenshot({path:'test-results/react/operator.png', fullPage:true});
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(operation));
  } finally { await browser.close(); }
})().catch(e => {console.error(e); process.exit(1);});
