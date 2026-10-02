const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.IPCSIM_UI_URL || 'http://127.0.0.1:3012/ui/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('token', 'test-token'); localStorage.setItem('edgeOperatorSession', 'test-session'); });
    const cabinet = { id: 3, cabinet_code: 'SIM-C02', cabinet_name: 'Simulation Cabinet 02', cabinet_index: 2, device_code: 'IPCSIM01', device_type: 'SIMULATION', rack_count: 6, status: 'ACTIVE' };
    const racks = Array.from({ length: 6 }, (_, i) => ({ id: 13 + i, cabinet_id: 3, cabinet_index: 2, rack_code: String(7 + i), rack_index: 1 + i, rack_name: `Rack ${String(1 + i).padStart(2, '0')}` }));
    const records = [
      { kind: 'cabinet', data: cabinet }, ...racks.map(data => ({ kind: 'rack', data })),
      { kind: 'shelf', data: { id: 13, rack_id: 13, shelf_code: 'S' } },
      { kind: 'bin', data: { id: 13, shelf_id: 13, bin_code: 'SIM-C02-R01-L01', capacity: 50 } },
      { kind: 'item', data: { id: 1, item_code: 'DHT22', item_name: 'DHT22 Sensor', unit: 'pcs' } },
      { kind: 'stock', data: { id: 1, item_id: 1, bin_id: 13, quantity: 12 } }
    ];
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (req.method() !== 'GET') writes.push(path);
      let json = {};
      if (path.endsWith('/operator/session')) json = { username: 'Operator', permissions: ['inventory.move', 'inventory.add_operation'] };
      else if (path.endsWith('/cabinets')) json = [cabinet];
      else if (path.endsWith('/cabinets/3/racks')) json = racks;
      else if (path.endsWith('/telemetry/operation')) json = { data: [] };
      else if (path.endsWith('/device/snapshot')) json = { records, health: { server_online: true }, operation_history: [{ id: 'open-13', state: 'local_sent', body: JSON.stringify({ kind: 'OPEN', rack_id: 13, cabinet_id: 3, cabinet_index: 2, rack_index: 1 }) }] };
      else if (path.endsWith('/operator/operations')) json = [{ transaction_id: 'pick-13', product_id: 1, operation_type: 'PICK', quantity: 1, rack_id: 13, cabinet_id: 3, cabinet_index: 2, rack_index: 1, device_code: 'IPCSIM01', operation_status: 'COMPLETED' }];
      else if (path.endsWith('/transactions')) json = [];
      else if (path.endsWith('/items')) json = [records.find(r => r.kind === 'item').data];
      await route.fulfill({ json });
    });
    await page.goto(base + 'cabinets/3');
    await page.getByRole('heading', { name: 'Tủ 2', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Open R1', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Open R7', exact: true }).count(), 0);
    await page.goto(base + 'inventory');
    await page.getByText('DHT22 Sensor', { exact: true }).waitFor();
    await page.getByText('Cabinet 02 · Rack 01', { exact: true }).first().waitFor();
    await page.goto(base + 'transactions');
    await page.getByText('IPCSIM01 / Cabinet 02 / Rack 01', { exact: true }).waitFor();
    await page.goto(base + 'operation');
    await page.getByText('Cabinet 02 / Rack 01', { exact: true }).waitFor();
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('PASS: offset database PKs and Serial address 7 display Cabinet 02 / Rack 01 throughout IPCSIM, no writes');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
