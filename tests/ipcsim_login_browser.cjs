const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.IPCSIM_UI_URL || 'http://127.0.0.1:3012/ui/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [], logins = [], healthTokens = [];
    let loginStatus = 403, releaseLogin;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.endsWith('/system/health')) {
        healthTokens.push(request.headers().authorization);
        return route.fulfill({ status: request.headers().authorization === 'Bearer invalid-token' ? 401 : 200, json: { detail: 'Token thiết bị không hợp lệ', device_id: 'SIM01' } });
      }
      if (path.endsWith('/operator/login')) {
        logins.push({ body: request.postDataJSON(), authorization: request.headers().authorization });
        if (loginStatus === 200) await new Promise(resolve => { releaseLogin = resolve; });
        return route.fulfill({ status: loginStatus, json: loginStatus === 200 ? { session: 'login-test-session', permissions: [] } : { detail: 'Tên đăng nhập hoặc mật khẩu không đúng.' } });
      }
      if (path.endsWith('/operator/session')) return route.fulfill({ json: { username: 'operator-test', permissions: [] } });
      return route.fulfill({ json: [] });
    });
    fs.mkdirSync('test-results/ipcsim-login', { recursive: true });
    await page.goto(base + 'system');
    await page.getByRole('heading', { name: 'Đăng nhập vận hành' }).waitFor();
    for (const [width, height, name] of [[1920,1080,'desktop'], [1366,768,'small-desktop'], [390,844,'mobile'], [320,568,'small-mobile']]) {
      await page.setViewportSize({ width, height });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' horizontal overflow');
      assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), name + ' excessive vertical scroll');
      await page.screenshot({ path: `test-results/ipcsim-login/${name}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByLabel('Edge API token').fill('invalid-token');
    await page.getByLabel('Tên đăng nhập').fill('operator-test');
    const password = page.getByLabel(/^Mật khẩu/);
    await password.fill('login-test-password');
    assert.equal(await password.getAttribute('type'), 'password');
    await page.getByRole('button', { name: 'Hiện mật khẩu', exact: true }).click();
    assert.equal(await password.getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Ẩn mật khẩu', exact: true }).click();
    await password.press('Enter');
    await page.getByRole('alert').filter({ hasText: 'Token thiết bị không hợp lệ' }).waitFor();
    assert.equal(logins.length, 0);
    await page.getByLabel('Edge API token').fill('valid-token');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Tên đăng nhập hoặc mật khẩu không đúng.' }).waitFor();
    assert.equal(await page.getByLabel('Edge API token').count(), 0);
    await page.screenshot({ path: 'test-results/ipcsim-login/error.png', fullPage: true });
    loginStatus = 200;
    await password.press('Enter');
    await page.getByRole('button', { name: 'Đang đăng nhập…', exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Đang đăng nhập…', exact: true }).isDisabled());
    await page.waitForFunction(() => true);
    assert(releaseLogin);
    releaseLogin();
    await page.getByRole('heading', { name: 'Trạng thái hệ thống', exact: true }).waitFor();
    assert.deepEqual(logins, Array(2).fill({ body: { username: 'operator-test', password: 'login-test-password' }, authorization: 'Bearer valid-token' }));
    assert.deepEqual(healthTokens.slice(0,2), ['Bearer invalid-token', 'Bearer valid-token']);
    assert.equal(await page.evaluate(() => localStorage.getItem('edgeOperatorSession')), 'login-test-session');
    await page.reload();
    await page.getByRole('heading', { name: 'Trạng thái hệ thống', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: responsive login, password visibility, token rejection, operator rejection, pending state, Enter submit, session persistence, no browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
