const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.IPCSIM_UI_URL || 'http://127.0.0.1:3012/ui/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [], writes = [];
    let topologyFailed = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('token', 'test'); localStorage.setItem('edgeOperatorSession', 'session'); });
    const records = [1, 2].flatMap(index => [
      { kind: 'cabinet', data: { id: index + 1, cabinet_index: index } },
      ...Array.from({ length: 6 }, (_, i) => ({ kind: 'rack', data: { id: index * 6 + i + 1, cabinet_id: index + 1, rack_index: i + 1, rack_code: String((index - 1) * 6 + i + 1) } }))
    ]);
    const rows = [
      { id: 1, rack_id: 7, is_obstructed: 1, created_at: '2026-10-02T09:00:00Z' },
      ...Array.from({ length: 7 }, (_, i) => ({ id: i + 2, rack_id: i + 7, is_skewed: i === 6 ? 1 : 0, created_at: '2026-10-02T10:00:00Z' }))
    ];
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (req.method() !== 'GET') writes.push(path);
      if (path.endsWith('/device/snapshot') && topologyFailed) return route.fulfill({ status: 503, json: {} });
      let json = {};
      if (path.endsWith('/operator/session')) json = { username: 'Operator', permissions: [] };
      else if (path.endsWith('/device/snapshot')) json = { records };
      else if (path.endsWith('/telemetry/breakdown')) json = { data: rows };
      await route.fulfill({ json });
    });
    await page.goto(base + 'breakdown');
    for (let i = 1; i <= 6; i++) await page.getByRole('cell', { name: `Cabinet 01 / Rack ${String(i).padStart(2, '0')}`, exact: true }).waitFor();
    await page.getByRole('cell', { name: 'Cabinet 02 / Rack 01', exact: true }).waitFor();
    assert.equal(await page.getByText('Vật cản', { exact: true }).count(), 0, 'Latest clear report must win');
    assert.equal(await page.getByRole('cell', { name: /^Rack (7|8|9|10|11|12)$/ }).count(), 0);
    await page.getByLabel('Vị trí rack', { exact: true }).click();
    await page.getByRole('option', { name: 'Cabinet 02 / Rack 01', exact: true }).click();
    await page.locator('.MuiPopover-root').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('cell', { name: 'Cabinet 02 / Rack 01', exact: true }).count(), 1);
    assert.equal(await page.getByRole('cell', { name: 'Cabinet 01 / Rack 01', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
    await page.getByRole('tab', { name: 'Lịch sử báo cáo' }).click();
    assert.equal(await page.getByRole('cell', { name: 'Cabinet 01 / Rack 01', exact: true }).count(), 2);
    await page.getByText('Vật cản', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    topologyFailed = true;
    await page.reload();
    await page.getByRole('cell', { name: 'Rack ID 7', exact: true }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'ID kỹ thuật' }).waitFor();
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('PASS: local rack labels 1–6 despite database IDs 7–12, separate cabinets, PK filtering, latest/history, mobile and explicit fallback, no writes');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
