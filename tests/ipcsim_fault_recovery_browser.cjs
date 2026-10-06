// Seven operator recovery cases against the real Python Simulation/RecoveryService.
const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

(async () => {
  const python = spawn(process.env.TEST_PYTHON || '.tools/cleanup-python/python.exe', ['-u', 'tests/ipcsim_fault_harness.py'], { cwd: process.cwd(), windowsHide: true });
  const pending = [];
  let diagnostics = '';
  python.stderr.on('data', chunk => diagnostics += chunk);
  readline.createInterface({ input: python.stdout }).on('line', line => {
    const response = JSON.parse(line), request = pending.shift();
    if (response.error) request.reject(new Error(response.error)); else request.resolve(response);
  });
  python.on('exit', code => { while (pending.length) pending.shift().reject(new Error(`Harness exited ${code}: ${diagnostics}`)); });
  const call = data => new Promise((resolve, reject) => { pending.push({ resolve, reject }); python.stdin.write(JSON.stringify(data) + '\n'); });
  const dist = path.resolve('IPCSIM/frontend/dist');
  const server = http.createServer((request, response) => {
    const relative = new URL(request.url, 'http://localhost').pathname.replace(/^\/ui\/?/, '');
    let file = path.resolve(dist, relative);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = [], commands = [], recoveries = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      localStorage.setItem('smartInventory.language', 'en');
      localStorage.setItem('token', 'test');
      localStorage.setItem('edgeOperatorSession', 'test');
    });
    const racks = Array.from({ length: 6 }, (_, i) => ({ id: 101 + i, rack_code: String(i + 1), rack_index: i + 1, cabinet_index: 1 }));
    let snapshot, serialOnline = true, failDeliveryResponse = false, extraStates = [];
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      let json = {};
      if (pathname.endsWith('/operator/session')) json = { username: 'Operator', permissions: ['inventory.add_operation', 'cabinet.control'] };
      else if (pathname.endsWith('/system/health')) json = { device_type: 'IPCSIM', serial_connected: serialOnline, simulation_online: serialOnline, simulation_states: [snapshot, ...extraStates] };
      else if (pathname.endsWith('/cabinets')) json = [{ id: 1, cabinet_index: 1, status: 'ACTIVE', cabinet_name: 'Test cabinet', rack_count: 6 }];
      else if (pathname.endsWith('/cabinets/1/racks')) json = racks;
      else if (pathname.endsWith('/telemetry/operation')) json = { data: [] };
      else if (pathname.endsWith('/operator/simulation-state')) json = { history: [] };
      else if (pathname.endsWith('/operator/device-commands')) {
        const data = request.postDataJSON();
        commands.push(data);
        snapshot = (await call({ operation: 'EXECUTE', address: Number(racks.find(r => r.id === data.rack_id).rack_code), action: data.kind, command_id: data.request_key })).state;
        if (failDeliveryResponse) {
          failDeliveryResponse = false;
          await route.fulfill({ status: 503, json: { detail: 'Serial result uncertain; inspect hardware before retrying' } });
          return;
        }
        json = { id: data.request_key, state: 'local_sent' };
      } else if (pathname.endsWith('/operator/simulation-stop')) {
        snapshot = (await call({ operation: 'STOP', address: request.postDataJSON().address })).state;
      } else if (pathname.endsWith('/operator/simulation-recovery')) {
        const data = request.postDataJSON();
        recoveries.push(data);
        // Keep the visible snapshot unchanged until the test publishes the
        // actual acknowledgement; HTTP acceptance alone must not close modal.
        await call({ operation: 'RECOVER', ...data });
        json = { request_id: 'browser-recovery', state: 'RECOVERING' };
      }
      await route.fulfill({ json });
    });
    const base = `http://127.0.0.1:${server.address().port}/ui/cabinets/1`;
    const modal = page.getByRole('dialog', { name: /Operation interrupted|Fault resolved/ });
    const continueButton = () => modal.getByRole('button', { name: 'Continue operation', exact: true });
    const homeButton = () => modal.getByRole('button', { name: 'Return Home', exact: true });
    const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await page.waitForTimeout(50); } throw new Error('Request did not arrive'); };
    async function openAndFault() {
      serialOnline = true;
      snapshot = (await call({ operation: 'RESET' })).state;
      await page.goto(base);
      await page.getByRole('button', { name: 'Open R3', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: /Confirm.*Open Rack 3/ }).click();
      await waitFor(() => commands.length && commands.at(-1).request_key === snapshot.active_command_id);
      snapshot = (await call({ operation: 'INTERRUPT' })).state;
      await modal.waitFor();
      assert(await continueButton().isDisabled());
      assert(await homeButton().isDisabled());
      assert.match(await modal.innerText(), /Cabinet 1 · Rack 5/);
      assert.match(await modal.innerText(), /OPEN · Rack 3/);
      assert.match(await modal.innerText(), /440 mm → 500 mm/);
      await page.keyboard.press('Escape');
      assert(await modal.isVisible(), 'Escape cannot dismiss fault');
      return snapshot.fault_context.command_id;
    }
    async function clear() {
      snapshot = (await call({ operation: 'CLEAR' })).state;
      await modal.getByText('READY', { exact: true }).waitFor();
      assert(await continueButton().isEnabled());
      assert.equal(await modal.getByRole('button').count(), 2, 'Exactly two primary recovery choices');
    }

    // 1, 3, 6, 7: checkpointed Continue, unsafe Continue blocked, no duplicate request/replay.
    const commandId = await openAndFault();
    const commandCount = commands.length;
    await clear();
    fs.mkdirSync('test-results/ipcsim-fault-recovery', { recursive: true });
    await page.screenshot({ path: 'test-results/ipcsim-fault-recovery/ready.png' });
    const beforeResume = recoveries.length;
    await continueButton().evaluate(button => { button.click(); button.click(); button.click(); });
    await waitFor(() => recoveries.length > beforeResume);
    assert.equal(recoveries.length, beforeResume + 1);
    assert(await modal.isVisible(), 'POST acceptance must preserve popup until Simulation acknowledges');
    assert(await continueButton().isDisabled());
    snapshot = (await call({ operation: 'STATE' })).state;
    assert.equal(snapshot.active_command_id, commandId);
    assert.equal(snapshot.racks['5'].position_mm, 440);
    await modal.waitFor({ state: 'hidden' });
    const completed = await call({ operation: 'COMPLETE' });
    snapshot = completed.state;
    await page.getByLabel('Rack 3 light on', { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Open R4' && !button.disabled));
    assert.deepEqual(completed.steps, [[6, 'RIGHT'], [5, 'RIGHT'], [4, 'RIGHT'], [3, 'RIGHT']]);
    assert.equal(commands.length, commandCount, 'Resume must not resend OPEN or completed steps');
    assert.equal(snapshot.active_command_id, null);

    // 2: Home uses actual interrupted position and clears pending workflows.
    await openAndFault();
    await clear();
    const beforeHome = recoveries.length;
    await homeButton().click();
    await waitFor(() => recoveries.length > beforeHome);
    snapshot = (await call({ operation: 'STATE' })).state;
    assert.equal(snapshot.racks['5'].position_mm, 440, 'Homing must not teleport to origin');
    await modal.waitFor({ state: 'hidden' });
    snapshot = (await call({ operation: 'COMPLETE' })).state;
    assert.equal(snapshot.current_gap, 6);
    assert.equal(snapshot.system_state, 'IDLE');
    assert.equal(snapshot.fault_context, null);
    assert.equal(snapshot.active_command_id, null);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Open R3' && !button.disabled));
    assert.equal(await page.getByRole('dialog').count(), 0);

    // 4, 5: recurrence flips same popup red, offline never means cleared.
    await openAndFault();
    await clear();
    snapshot = (await call({ operation: 'FAULT_AGAIN' })).state;
    await modal.getByText('FAULT / ERROR', { exact: true }).waitFor();
    assert(await continueButton().isDisabled());
    await page.screenshot({ path: 'test-results/ipcsim-fault-recovery/error.png' });
    await clear();
    serialOnline = false;
    snapshot = { ...snapshot, online: false, system_state: 'COMMUNICATION_LOST', allowed_actions: [] };
    const connection = page.getByRole('dialog').filter({ has: page.locator('#simulation-connection-title') });
    await connection.getByText('Simulation connection lost', { exact: true }).waitFor();
    assert.equal(await connection.getByRole('button').count(), 0);
    assert.equal(await connection.getByText('READY', { exact: true }).count(), 0);

    // One connected cabinet suppresses the global warning even while cabinet 1 is offline.
    serialOnline = true;
    extraStates = [{ cabinet_index: 2, online: true, system_state: 'IDLE' }];
    await connection.waitFor({ state: 'hidden' });
    assert(await continueButton().isDisabled(), 'Offline cabinet remains interlocked');
    extraStates = [{ cabinet_index: 2, online: false, system_state: 'COMMUNICATION_LOST' }];
    await connection.waitFor();
    extraStates = [];

    // App-wide monitoring must work away from the cabinet detail page too.
    serialOnline = true;
    snapshot = (await call({ operation: 'STATE' })).state;
    const resumesBeforeReconnect = recoveries.length;
    await connection.waitFor({ state: 'hidden' });
    assert.equal(recoveries.length, resumesBeforeReconnect, 'Reconnection must not auto-resume');
    await page.goto(base.replace('/cabinets/1', '/cabinets'));
    await modal.getByText('READY', { exact: true }).waitFor();
    snapshot = (await call({ operation: 'FAULT_AGAIN' })).state;
    await modal.getByText('FAULT / ERROR', { exact: true }).waitFor();
    assert(await continueButton().isDisabled());
    snapshot = (await call({ operation: 'CLEAR' })).state;
    await modal.getByText('READY', { exact: true }).waitFor();
    const globalResume = recoveries.length;
    await continueButton().evaluate(button => { button.click(); button.click(); });
    await waitFor(() => recoveries.length > globalResume);
    assert.equal(recoveries.length, globalResume + 1);
    snapshot = (await call({ operation: 'STATE' })).state;
    await modal.waitFor({ state: 'hidden' });
    snapshot = (await call({ operation: 'COMPLETE' })).state;
    await page.goto(base);
    await page.getByLabel('Rack 3 light on', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'No stale incident after changing pages');

    // Safe backend restrictions also apply when a reference fault has no
    // interrupted command: only Home is authorized; Continue stays disabled.
    snapshot = (await call({ operation: 'RESET' })).state;
    snapshot = (await call({ operation: 'REFERENCE_LOST' })).state;
    await page.goto(base.replace('/cabinets/1', '/cabinets'));
    await modal.getByText('FAULT / ERROR', { exact: true }).waitFor();
    snapshot = (await call({ operation: 'CLEAR' })).state;
    await modal.getByText('READY', { exact: true }).waitFor();
    assert(await continueButton().isDisabled());
    assert(await homeButton().isEnabled());
    const referenceHome = recoveries.length;
    await homeButton().click();
    await waitFor(() => recoveries.length > referenceHome);
    snapshot = (await call({ operation: 'COMPLETE' })).state;
    await modal.waitFor({ state: 'hidden' });

    // A local HTTP failure after Serial delivery pauses only the matching live
    // command using STOP; it must still recover from its real checkpoint.
    snapshot = (await call({ operation: 'RESET' })).state;
    failDeliveryResponse = true;
    await page.goto(base);
    await page.getByRole('button', { name: 'Open R3', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Confirm.*Open Rack 3/ }).click();
    await modal.waitFor();
    await waitFor(() => snapshot.fault_context?.error_code === 'OPERATOR_STOP');
    assert(await continueButton().isDisabled());
    snapshot = (await call({ operation: 'CLEAR' })).state;
    await modal.getByText('READY', { exact: true }).waitFor();
    const localResume = recoveries.length;
    await continueButton().click();
    await waitFor(() => recoveries.length > localResume);
    snapshot = (await call({ operation: 'STATE' })).state;
    await modal.waitFor({ state: 'hidden' });
    snapshot = (await call({ operation: 'COMPLETE' })).state;
    await page.getByLabel('Rack 3 light on', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: all seven fault recovery cases; real IPC/Simulation checkpoint, no automatic/duplicate resume or replay');
  } finally {
    if (browser) await browser.close();
    python.stdin.end();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
