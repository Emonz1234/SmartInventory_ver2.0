// Regression: inactive cabinets cannot navigate or dispatch device controls.
// Uses a temporary static server and mocked API; no live edge or hardware.
const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const dist = path.resolve('IPCSIM/frontend/dist');
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relative = pathname.replace(/^\/ui\/?/, '');
    let file = path.resolve(dist, relative);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      localStorage.setItem('smartInventory.language', 'en');
      localStorage.setItem('token', 'isolated-test');
      localStorage.setItem('edgeOperatorSession', 'isolated-session');
    });
    const cabinets = [
      { id: 1, cabinet_index: 1, cabinet_name: 'Active cabinet', rack_count: 6, status: 'ACTIVE' },
      { id: 2, cabinet_index: 2, cabinet_name: 'Inactive cabinet', rack_count: 6, status: 'INACTIVE' }
    ];
    const makeRacks = group => Array.from({ length: 6 }, (_, i) => ({ id: 100 + (group - 1) * 6 + i + 1, cabinet_index: group, rack_index: i + 1, rack_code: String((group - 1) * 6 + i + 1) }));
    const states = cabinets.map(cabinet => ({
      cabinet_index: cabinet.cabinet_index, online: true, boot_id: 'test-boot', system_state: 'IDLE', current_gap: 6,
      allowed_actions: [], active_command_id: null,
      lights: Object.fromEntries(makeRacks(cabinet.cabinet_index).map(rack => [rack.rack_code, false])),
      racks: Object.fromEntries(makeRacks(cabinet.cabinet_index).map((rack, i) => [rack.rack_code, { position_mm: i * 100, target_position_mm: i * 100, is_moving: false, access_state: 'CLOSED' }]))
    }));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET') writes.push(pathname);
      let json = {};
      if (pathname.endsWith('/operator/session')) json = { username: 'Operator', permissions: ['inventory.add_operation', 'cabinet.control'] };
      else if (pathname.endsWith('/system/health')) json = { device_id: 'IPCSIM01', device_type: 'IPCSIM', serial_connected: true, simulation_online: true, server_online: true, server_synced: true, simulation_states: states };
      else if (pathname.endsWith('/cabinets')) json = cabinets;
      else if (/\/cabinets\/\d+\/racks$/.test(pathname)) json = makeRacks(Number(pathname.match(/\/cabinets\/(\d+)/)[1]));
      else if (pathname.endsWith('/telemetry/operation')) json = { data: [] };
      else if (pathname.endsWith('/operator/simulation-state')) json = { history: [] };
      await route.fulfill({ json });
    });
    const base = `http://127.0.0.1:${server.address().port}/ui/`;
    await page.goto(base + 'cabinets');
    const activeCard = page.locator('[data-cabinet-id="1"]');
    const inactiveCard = page.locator('[data-cabinet-id="2"]');
    await inactiveCard.waitFor();
    assert.equal(await inactiveCard.getAttribute('aria-disabled'), 'true');
    assert(Number(await inactiveCard.evaluate(element => getComputedStyle(element).opacity)) < 1);
    assert(await inactiveCard.getByRole('button').isDisabled());
    assert.equal(await inactiveCard.locator('a').count(), 0, 'Inactive card must not contain a navigation href');
    assert.equal(await activeCard.locator('a[href$="/cabinets/1"]').count(), 1);
    fs.mkdirSync('test-results/ipcsim-inactive-cabinets', { recursive: true });
    await page.screenshot({ path: 'test-results/ipcsim-inactive-cabinets/list.png', fullPage: true });

    await page.goto(base + 'cabinets/2');
    await page.getByText('Cabinet inactive. Controls are unavailable.', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Open R1', exact: true }).isDisabled());
    assert(await page.getByRole('button', { name: 'Ventilate cabinet', exact: true }).isDisabled());
    assert(await page.getByRole('button', { name: 'Check faults', exact: true }).isDisabled());
    assert(await page.locator('fieldset').evaluate(element => element.disabled));

    cabinets[1].status = 'ACTIVE';
    await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
    // Serial rack addresses differ from database IDs. Snapshot lighting must
    // update both the diagram and manual light action without LIGHT telemetry.
    states[1].lights['7'] = true;
    await page.getByLabel('Rack 1 light on', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Turn light off for Rack 1', exact: true }).isEnabled());
    assert.equal(await page.getByLabel('Rack 2 light on', { exact: true }).count(), 0);
    states[1].lights['7'] = false;
    await page.getByLabel('Rack 1 light on', { exact: true }).waitFor({ state: 'detached' });
    assert(await page.getByRole('button', { name: 'Turn light on for Rack 1', exact: true }).isEnabled());
    const openRack = page.getByRole('button', { name: 'Open R1', exact: true });
    await openRack.click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: /Confirm.*Open Rack 1/ });
    await confirm.waitFor();
    assert(await confirm.isEnabled());
    cabinets[1].status = 'INACTIVE';
    await page.waitForFunction(() => document.querySelector('fieldset')?.disabled);
    assert(await confirm.isDisabled(), 'Status change must also lock a confirmation opened while active');
    assert.deepEqual(writes, []);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.screenshot({ path: 'test-results/ipcsim-inactive-cabinets/detail.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: inactive cabinet lockout, snapshot lights/address mapping, polling transitions, pending confirmation lockout, zero writes/errors');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exit(1); });
