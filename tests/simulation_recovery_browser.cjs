// Isolated built-UI checks: mock API only; no live IPC/Server database writes.
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { chromium } = require('../.tools/ui/node_modules/playwright');
const root = path.resolve(__dirname, '../IPCSIM/frontend/dist');

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const relative = pathname.replace(/^\/ui\/?/, '');
    const file = relative.startsWith('assets/') ? path.resolve(root, relative) : path.join(root, 'index.html');
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const requests = [];
    const checks = [];
    let mechanical = {
      boot_id: 'boot-1', cabinet_index: 3, online: true, system_state: 'ERROR', current_gap: 6,
      active_command_id: 'interrupted-open', active_rack: null, allowed_actions: [],
      fault_context: { fault_id: 'fault-1', rack_id: 18, moving_rack_id: 18, previous_state: 'OPENING', current_position: 540, target_position: 600, progress: 40, error_code: 'OBSTRUCTED', command_id: 'interrupted-open', classification: 'REQUIRES_CONFIRMATION' },
      racks: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(13+i), { position_mm: i === 5 ? 540 : i*100, target_position_mm: i === 5 ? 600 : i*100, is_moving: false, access_state: 'ERROR' }]))
    };
    const racks = Array.from({ length: 6 }, (_, i) => ({ id: i+101, cabinet_id: 3, cabinet_index: 3, rack_index: i+1, rack_code: String(i+13), status: 'Error' }));
    await page.addInitScript(() => {
      localStorage.setItem('token', 'isolated-test');
      localStorage.setItem('edgeOperatorSession', 'test-session');
      localStorage.setItem('edgeOperatorPermissions', JSON.stringify(['inventory.add_operation', 'cabinet.control']));
      localStorage.setItem('edgeOperatorName', 'Recovery test');
    });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname;
      if (endpoint.endsWith('/operator/session')) return route.fulfill({ json: { username: 'Recovery test', permissions: ['inventory.add_operation', 'cabinet.control'] } });
      if (endpoint.endsWith('/system/health')) return route.fulfill({ json: { device_id: 'ui-sim', device_type: 'IPCSIM', serial_connected: true, simulation_online: true, simulation_states: [mechanical] } });
      if (endpoint.endsWith('/cabinets/3/racks')) return route.fulfill({ json: racks });
      if (endpoint.endsWith('/cabinets')) return route.fulfill({ json: [{ id: 3, cabinet_index: 3, cabinet_name: 'Cabinet 03', rack_count: 6, status: 'ACTIVE', mechanical }] });
      if (endpoint.endsWith('/telemetry/operation')) return route.fulfill({ json: { data: [], count: 0 } });
      if (endpoint.endsWith('/operator/simulation-check')) {
        checks.push(request.postDataJSON());
        return route.fulfill({ json: { state: 'REQUESTED' } });
      }
      if (endpoint.endsWith('/operator/simulation-recovery')) {
        requests.push(request.postDataJSON());
        mechanical = { ...mechanical, system_state: 'OPENING', allowed_actions: [], racks: { ...mechanical.racks, '18': { ...mechanical.racks['18'], is_moving: true, access_state: 'MOVING' } } };
        return route.fulfill({ json: { state: 'RECOVERING' } });
      }
      return route.fulfill({ json: {} });
    });
    const base = `http://127.0.0.1:${server.address().port}/ui/`;
    await page.goto(base + 'cabinets/3');
    await page.getByText('OBSTRUCTED', { exact: false }).first().waitFor();
    assert(await page.getByRole('button', { name: 'Open R6', exact: true }).isDisabled());
    assert(await page.getByRole('button', { name: 'Resume operation', exact: true }).count() === 0);
    const positionBefore = await page.locator('.rack-operation-map [title^="Rack 6:"]').evaluate(el => el.style.left);
    await page.reload();
    await page.getByText('OBSTRUCTED', { exact: false }).first().waitFor();
    assert(await page.locator('.rack-operation-map [title^="Rack 6:"]').evaluate(el => el.style.left) === positionBefore);
    mechanical = { ...mechanical, system_state: 'RECOVERING', allowed_actions: ['RESUME', 'ABORT', 'HOME'], fault_context: { ...mechanical.fault_context, cleared: true } };
    await page.getByRole('button', { name: 'Kiểm tra lỗi' }).click();
    await page.getByRole('button', { name: 'Resume operation', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm inspection', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    assert(requests.length === 1 && requests[0].fault_id === 'fault-1' && requests[0].confirmed);
    mechanical = { ...mechanical, system_state: 'RECOVERING', allowed_actions: ['ABORT', 'HOME'], fault_context: { ...mechanical.fault_context, error_code: 'REFERENCE_LOST', classification: 'REQUIRES_HOME', position_trusted: false } };
    await page.getByRole('button', { name: 'Kiểm tra lỗi' }).click();
    await page.getByText('REFERENCE_LOST', { exact: false }).first().waitFor();
    await page.goto(base + 'cabinets/3');
    await page.getByText('REFERENCE_LOST', { exact: false }).first().waitFor();
    mechanical = { ...mechanical, boot_id: 'boot-2', system_state: 'IDLE', current_gap: 6, active_command_id: null, active_rack: null, fault_context: null, allowed_actions: [], racks: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(13+i), { position_mm: i*100, target_position_mm: i*100, is_moving: false, access_state: 'IDLE' }])) };
    await page.getByRole('button', { name: 'Kiểm tra lỗi' }).click();
    await page.getByText('Không có lỗi', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Open R6', exact: true }).isEnabled());
    assert(await page.getByText('HOME · bên phải R6', { exact: false }).count() > 0);
    await page.waitForFunction(() => {
      const el = document.querySelector('.rack-operation-map [title^="Rack 6:"]');
      return el && Math.abs(parseFloat(getComputedStyle(el).left) / el.offsetParent.clientWidth * 100 - 500/700*100) < .1;
    }, null, { timeout: 3000 });
    const homeLeft = await page.locator('.rack-operation-map [title^="Rack 6:"]').evaluate(el => parseFloat(getComputedStyle(el).left) / el.offsetParent.clientWidth * 100);
    assert(Math.abs(homeLeft - 500/700*100) < .1, `HOME left: ${homeLeft}`);
    assert(checks.length === 3 && checks.every(check => check.cabinet_index === 3));
    assert(await page.getByRole('button', { name: 'Resume operation', exact: true }).count() === 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.tools/recovery-mobile.png', fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.goto(base + 'cabinets');
    await page.getByText('IDLE', { exact: false }).first().waitFor();
    assert(await page.getByText('REFERENCE_LOST', { exact: false }).count() === 0);
    assert(errors.length === 0, errors.join('\n'));
    console.log('Recovery UI passed: fault check, refresh, position, confirmation, home guard, restart HOME, mobile, overview.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
