const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
(async () => {
  const dist = path.resolve('IPCSIM/frontend/dist');
  const server = http.createServer((req, res) => {
    let file = path.resolve(dist, new URL(req.url, 'http://localhost').pathname.replace(/^\/ui\/?/, ''));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({channel: 'chrome', headless: true});
    const page = await browser.newPage({viewport: {width: 1366, height: 768}});
    const errors = [], writes = []; let commandId; let commandHistory = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      localStorage.setItem('smartInventory.language', 'en');
      localStorage.setItem('token', 'test');
      localStorage.setItem('edgeOperatorSession', 'test');
    });
    const cabinet = {id: 47, cabinet_index: 1, cabinet_code: 'IPC01-C01', cabinet_name: 'IPC cabinet', rack_count: 6, status: 'ACTIVE'};
    const racks = Array.from({length: 6}, (_, i) => ({id: 101 + i, cabinet_id: 47, cabinet_index: 1, rack_index: i + 1, rack_code: String(i + 1), status: 'Unknown'}));
    const health = {device_id: 'IPC01', device_type: 'IPC', serial_connected: true, hardware_status: 'ONLINE', hardware_commands_supported: true, hardware_enabled: true, hardware_pending: [], hardware_racks: {1: {hardware_state: "CLOSED"}}, simulation_online: false, server_online: true, server_synced: true, database_healthy: true, simulation_states: []};
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url()).pathname;
      if (req.method() !== 'GET') {
        writes.push(url);
        if (url.endsWith('/operator/device-commands')) {
          const command = req.postDataJSON();
          assert.equal(command.rack_id, 101);
          assert.equal(req.headers()['x-operator-session'], 'test');
          if (command.kind === 'OPEN') { commandId = command.request_key; commandHistory = [{id: commandId, execution_state: 'moving'}]; health.hardware_pending = [1]; health.hardware_racks[1] = {hardware_state: 'OPENING'}; }
          if (command.kind === 'RESET') { health.hardware_pending = []; health.hardware_racks[1] = {hardware_state: 'CLOSED'}; }
          await route.fulfill({json: {state: 'local_sent'}}); return;
        }
      }
      let json = {};
      if (url.endsWith('/operator/session')) json = {username: 'Operator', permissions: ['inventory.add_operation', 'cabinet.control']};
      else if (url.endsWith('/system/health')) json = health;
      else if (url.endsWith('/device/snapshot')) json = {operation_history: commandHistory};
      else if (url.endsWith('/cabinets')) json = [cabinet];
      else if (url.endsWith('/cabinets/47/racks')) json = racks;
      else if (url.includes('/telemetry/') || url.endsWith('/environment/history')) json = {data: []};
      else if (url.endsWith('/operator/operations')) json = [];
      else if (url.endsWith('/faults/overview')) json = {summary: {}, active_faults: [], maintenance_warnings: [], history: []};
      await route.fulfill({json});
    });
    const base = `http://127.0.0.1:${server.address().port}/ui/`;
    await page.goto(base + 'cabinets');
    await page.locator('.rack-operation-panel').waitFor();
    const open = page.getByRole('button', {name: 'Open R1', exact:true});
    await open.click();
    await page.getByRole('button', {name: /Confirm.*Open Rack/}).click();
    await page.waitForFunction(() => document.body.innerText.includes('waiting for endpoint'));
    assert(commandId, 'Original Open R1 control sends OPEN to the existing API');
    assert.equal(writes.filter(url => url.endsWith('/operator/device-commands')).length, 1);
    assert.equal(await page.getByRole('button', {name: 'RESET', exact:true}).count(), 0, 'No replacement hardware button layout');
    health.hardware_pending = []; health.hardware_racks[1] = {hardware_state: 'OPENED'};
    commandHistory = [{id: commandId, execution_state: 'completed'}];
    await page.getByText('Rack 1 opened successfully', {exact:true}).waitFor();
    for (const width of [1366, 390]) {
      await page.setViewportSize({width, height: 844});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    }
    await page.goto(base);
    await page.locator('[data-testid="ipc-rack-overview"]').waitFor();
    assert.equal(await page.locator('[data-testid="ipc-rack-overview"] a').count(), 6);
    assert.equal(await page.locator('[data-testid="connectivity-Simulation"]').count(), 0);
    assert.equal(await page.locator('[data-testid="connectivity-Hardware"]').count(), 1);
    assert.equal(await page.getByTestId('overview-cabinet').count(), 0);
    await page.getByText('Cabinet overview', {exact:true}).waitFor();
    const rackOne = page.getByTestId('ipc-rack-1');
    await rackOne.getByText('Connected', {exact:true}).waitFor();
    assert.equal(await page.getByTestId('ipc-rack-1').getAttribute('data-status'), 'Open');
    assert(await page.getByTestId('ipc-rack-2').getByText('Disconnected', {exact:true}).isVisible());
    health.hardware_racks[1] = {hardware_state:'CLOSED', last_confirmed_state:'CLOSED', position_stale:false};
    await page.waitForFunction(() => document.querySelector('[data-testid="ipc-rack-1"]')?.getAttribute('data-status') === 'Normal');
    health.serial_connected = false;
    health.hardware_racks[1] = {hardware_state:'UNKNOWN', last_confirmed_state:'CLOSED', position_stale:true};
    await rackOne.getByText('Disconnected', {exact:true}).waitFor();
    await rackOne.getByText('Last confirmed position', {exact:true}).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'dashboard fits mobile width');
    health.serial_connected = true;
    cabinet.rack_count = 5;
    await page.goto(base + 'cabinets');
    await page.getByText('IPC requires exactly one cabinet and six racks. Check the Server catalog.', {exact: true}).waitFor();
    assert.equal(await page.locator('.rack-operation-panel').count(), 0);
    assert.deepEqual(errors, []);
    assert.equal(writes.filter(url => url.endsWith('/operator/device-commands')).length, 1);
    console.log('PASS: original IPC rack layout, Open R1 serial command and real endpoint completion');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
