const { chromium } = require('../.tools/ui/node_modules/playwright');

const baseUrl = process.env.IPCSIM_UI_URL || 'http://127.0.0.1:3001/ui/';
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);

  const errors = [];
  const commands = [];
  const movements = [];
  let firstResponseReleased = false;
  const racks = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    cabinet_id: 1,
    rack_code: String(index + 1),
    rack_name: `Rack ${index + 1}`,
    status: 'Closed'
  }));
  let gap = 6;
  let nextTelemetryId = 10;
  let failNextCommand = false;
  let ventilationSimulationStarted = false;
  let health = {
    device_id: 'ui-sim',
    device_type: 'IPCSIM',
    serial_connected: true,
    simulation_online: true,
    hardware_enabled: true
  };
  const events = racks.map(rack => ({
    id: rack.id,
    rack_id: rack.id,
    movement_speed: 0,
    displacement: 0,
    is_endpoint: 1,
    state: -1,
    created_at: new Date().toISOString()
  }));
  const pushTelemetry = (rackId, speed, displacement, endpoint, state) => events.push({
    id: nextTelemetryId++,
    rack_id: rackId,
    movement_speed: speed,
    displacement,
    is_endpoint: endpoint,
    state,
    created_at: new Date().toISOString()
  });

  await page.addInitScript(() => {
    localStorage.setItem('token', 'ui-test');
    localStorage.setItem('edgeOperatorSession', 'ui-session');
    localStorage.setItem('edgeOperatorPermissions', JSON.stringify(['inventory.add_operation']));
    localStorage.setItem('edgeOperatorName', 'UI Test');
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.includes('/src/api/')) return route.continue();
    if (path.endsWith('/operator/session')) {
      return route.fulfill({ json: { username: 'UI Test', permissions: ['inventory.add_operation'] } });
    }
    if (path.endsWith('/system/health')) return route.fulfill({ json: health });
    if (path.endsWith('/cabinets/1/racks')) return route.fulfill({ json: racks });
    if (path.endsWith('/telemetry/operation')) {
      return route.fulfill({ json: { count: events.length, data: events.slice(-100) } });
    }
    if (path.endsWith('/operator/device-commands') && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (failNextCommand) {
        failNextCommand = false;
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Simulated Serial failure' }) });
      }
      commands.push(body);
      if (body.kind === 'LIGHT') {
        pushTelemetry(body.rack_id, 0, 0, 1, 0);
        return route.fulfill({ json: { state: 'local_sent', id: body.request_key, rack_id: body.rack_id, kind: body.kind } });
      }
      if (body.kind === 'LIGHT_OFF') {
        pushTelemetry(body.rack_id, 0, 0, 1, 5);
        return route.fulfill({ json: { state: 'local_sent', id: body.request_key, rack_id: body.rack_id, kind: body.kind } });
      }
      if (body.kind === 'VENTILATE') {
        pushTelemetry(body.rack_id, 0, 0, 0, 3);
        if (!ventilationSimulationStarted) {
          ventilationSimulationStarted = true;
          void (async () => {
            for (let order = 2; order <= 6; order++) {
              pushTelemetry(order, 12, 32, 0, 2);
              await wait(700);
              pushTelemetry(order, 0, 0, 0, 2);
            }
            for (let rackId = 1; rackId <= 6; rackId++) pushTelemetry(rackId, 0, 0, 1, -1);
          })();
        }
        await wait(100);
        return route.fulfill({ json: { state: 'local_sent', id: body.request_key, rack_id: body.rack_id, kind: body.kind } });
      }
      const simulationFinished = new Promise(resolve => {
        void (async () => {
        const targetOrder = body.kind === 'HOME' ? 6 : Number(body.rack_id);
        const targetGap = body.kind === 'HOME' ? 6 : targetOrder <= 2 ? 1 : targetOrder - 1;
        const steps = [];
        if (targetGap > gap) {
          for (let order = gap + 1; order <= targetGap; order++) steps.push({ order, direction: 'LEFT', state: 1 });
        } else {
          for (let order = gap; order > targetGap; order--) steps.push({ order, direction: 'RIGHT', state: 2 });
        }
        movements.push({ kind: body.kind, rack: body.rack_id, steps: steps.map(step => `${step.order}:${step.direction}`) });
        for (const step of steps) {
          pushTelemetry(step.order, 12, 32, 0, step.state);
          await wait(700);
          pushTelemetry(step.order, 0, 0, 0, step.state);
        }
        await wait(100);
        if (body.kind === 'HOME') {
          for (let rackId = 1; rackId <= 6; rackId++) pushTelemetry(rackId, 0, 0, 1, -1);
        } else {
          for (let rackId = 1; rackId <= 6; rackId++) {
            if (rackId !== targetOrder) pushTelemetry(rackId, 0, 0, 1, -1);
          }
          pushTelemetry(targetOrder, 0, 64, 1, -1);
        }
        gap = targetGap;
        resolve();
        })();
      });
      await simulationFinished;
      const holdResponse = body.kind === 'OPEN' && Number(body.rack_id) === 1;
      await wait(holdResponse ? 1500 : 200);
      if (holdResponse) firstResponseReleased = true;
      return route.fulfill({ json: { state: 'local_sent', id: body.request_key, rack_id: body.rack_id, kind: body.kind } });
    }
    return route.fulfill({ json: {} });
  });
  page.on('pageerror', error => errors.push(error.message));

  const openRack = number => page.getByRole('button', { name: new RegExp(`Open R${number}`) });
  const waitForNew = async (locator, previousCount, text) => {
    for (let elapsed = 0; elapsed < 10000 && await locator.count() <= previousCount; elapsed += 50) await wait(50);
    if (await locator.count() <= previousCount) {
      const state = (await page.locator('body').innerText()).slice(-1200)
      throw new Error(`Timed out waiting for: ${text}; dispatched=${JSON.stringify(commands.map(command => `${command.kind}:${command.rack_id}`))}; page=${state}`)
    }
  };
  const clickAndWaitForNew = async (button, text) => {
    const locator = page.getByText(text);
    const previousCount = await locator.count();
    await button.click();
    const confirmation = page.getByRole('dialog');
    await confirmation.getByRole('heading', { name: 'Confirm rack movement' }).waitFor();
    const confirmationButton = confirmation.getByRole('button', {
      name: text.includes('Return Home') ? 'Confirm Return Home' : `Confirm Open Rack ${text.match(/Rack (\d+)/)?.[1]}`,
      exact: true
    });
    await confirmationButton.click();
    const executionDialog = page.getByRole('dialog');
    await executionDialog.getByRole('button', { name: 'Continue in background' }).waitFor();
    await executionDialog.getByRole('button', { name: 'Continue in background' }).click();
    await waitForNew(locator, previousCount, text);
  };
  const assertGapAfterRack = async (rackNumber, nextRackNumber = null) => {
    const rack = await page.locator(`[title^="Rack ${rackNumber}:"]`).first().boundingBox();
    const gap = await page.locator('[aria-label^="Current access gap:"]').first().boundingBox();
    const nextRack = nextRackNumber === null ? null : await page.locator(`[title^="Rack ${nextRackNumber}:"]`).first().boundingBox();
    if (!rack || !gap || (nextRackNumber !== null && !nextRack)) throw new Error('Rack/GAP geometry is unavailable.');
    if (Math.abs(rack.x + rack.width - gap.x) > 2 || (nextRack && Math.abs(gap.x + gap.width - nextRack.x) > 2)) {
      throw new Error(`GAP is not positioned after R${rackNumber}${nextRackNumber ? ` before R${nextRackNumber}` : ''}.`);
    }
  };

  await page.goto(baseUrl.replace(/\/$/, '') + '/cabinets/1', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Rack operation' }).waitFor();
  await page.getByText(/GAP: HOME · bên phải R6/).waitFor();
  await assertGapAfterRack(6);
  const homeButton = page.getByRole('button', { name: /Return Home/ });
  if (await homeButton.count() !== 1) throw new Error(`Return Home button not found. buttons=${JSON.stringify(await page.getByRole('button').allInnerTexts())}; page=${(await page.locator('body').innerText()).slice(-700)}`);
  if (!(await homeButton.isDisabled())) throw new Error('Return Home remained enabled while already at HOME.');

  await openRack(1).click();
  const rackOneConfirmation = page.getByRole('dialog');
  await rackOneConfirmation.getByRole('heading', { name: 'Confirm rack movement' }).waitFor();
  if (commands.length !== 0) throw new Error('OPEN was sent before the operator confirmed it.');
  await rackOneConfirmation.getByRole('button', { name: 'Confirm Open Rack 1', exact: true }).click();
  const firstExecutionDialog = page.getByRole('dialog');
  await firstExecutionDialog.getByText(/Sending command to IPCSIM/).waitFor();
  await firstExecutionDialog.getByRole('button', { name: 'Continue in background' }).click();
  await page.getByText(/Moving: R6 RIGHT · 50%/).waitFor();
  await page.getByText(/18\.8 mm\/s · 100 mm/).waitFor();
  const rackTwoComplete = page.getByText('Rack 2 opened · GAP aligned');
  const previousRackTwoCount = await rackTwoComplete.count();
  const rackOneComplete = page.getByText('Rack 1 opened · GAP aligned');
  const previousRackOneCount = await rackOneComplete.count();
  await openRack(2).click();
  const rackTwoConfirmation = page.getByRole('dialog');
  await rackTwoConfirmation.getByRole('heading', { name: 'Confirm rack movement' }).waitFor();
  await rackTwoConfirmation.getByText(/No rack movement is needed/).waitFor();
  if (commands.length !== 1) throw new Error('Queued OPEN was sent before operator confirmation.');
  await rackTwoConfirmation.getByRole('button', { name: 'Confirm Open Rack 2', exact: true }).click();
  const queuedExecutionDialog = page.getByRole('dialog');
  await queuedExecutionDialog.getByRole('button', { name: 'Continue in background' }).click();
  await page.getByText('1 waiting').waitFor();
  if (commands.length !== 1) throw new Error('Rack2 was dispatched before Rack1 completed.');
  await waitForNew(rackOneComplete, previousRackOneCount, 'Rack 1 endpoint before command response');
  if (firstResponseReleased) throw new Error('Rack1 success waited for local_sent instead of accepting final simulation telemetry.');
  await waitForNew(rackTwoComplete, previousRackTwoCount, 'Rack 2 opened · GAP aligned');
  await page.locator('[title="Rack 2: ACTIVE"]').waitFor();
  if (!(await openRack(2).isDisabled())) throw new Error('The already-active rack remained selectable.');
  if (await openRack(1).isDisabled()) throw new Error('Rack1 was disabled even though it shares GAP1 and should switch active without movement.');
  await clickAndWaitForNew(openRack(3), 'Rack 3 opened · GAP aligned');
  await clickAndWaitForNew(openRack(4), 'Rack 4 opened · GAP aligned');
  await clickAndWaitForNew(openRack(3), 'Rack 3 opened · GAP aligned');
  await clickAndWaitForNew(openRack(5), 'Rack 5 opened · GAP aligned');
  await clickAndWaitForNew(openRack(6), 'Rack 6 opened · GAP aligned');
  await page.getByText('GAP: R5 ↔ R6').waitFor();
  await wait(180);
  await assertGapAfterRack(5, 6);
  const homeConfirmationCount = commands.length;
  await page.getByRole('button', { name: /Return Home/ }).click();
  const homeConfirmation = page.getByRole('dialog');
  await homeConfirmation.getByRole('heading', { name: 'Confirm rack movement' }).waitFor();
  if (commands.length !== homeConfirmationCount) throw new Error('RETURN_HOME was sent before operator confirmation.');
  await homeConfirmation.getByRole('button', { name: 'Confirm Return Home', exact: true }).click();
  const homeExecutionDialog = page.getByRole('dialog');
  await homeExecutionDialog.getByRole('button', { name: 'Continue in background' }).click();
  await page.getByText(/Return Home complete · GAP is right of Rack 6/).waitFor();

  const expected = [
    ['6:RIGHT', '5:RIGHT', '4:RIGHT', '3:RIGHT', '2:RIGHT'],
    [],
    ['2:LEFT'],
    ['3:LEFT'],
    ['3:RIGHT'],
    ['3:LEFT', '4:LEFT'],
    ['5:LEFT'],
    ['6:LEFT']
  ];
  if (commands.length !== 8) throw new Error(`Expected 8 sequential commands, got ${commands.length}.`);
  if (JSON.stringify(movements.map(move => move.steps)) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected movement plan: ${JSON.stringify(movements.map(move => move.steps))}`);
  }
  await page.getByText(/GAP: HOME · bên phải R6/).waitFor();

  const desktopLayouts = [];
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const map = page.locator('[aria-label="Six-rack GAP arrangement"]');
    const rackSix = page.locator('[title^="Rack 6:"]').first();
    const homeGap = page.locator('[aria-label^="Current access gap:"]').first();
    const control = openRack(6);
    const [mapBounds, rackBounds, gapBounds, controlBounds, documentWidth] = await Promise.all([
      map.boundingBox(), rackSix.boundingBox(), homeGap.boundingBox(), control.boundingBox(),
      page.evaluate(() => document.documentElement.scrollWidth)
    ]);
    if (!mapBounds || !rackBounds || !gapBounds || !controlBounds) throw new Error(`Rack/GAP/control missing at ${width}x${height}.`);
    if (documentWidth > width || rackBounds.x + rackBounds.width > width || controlBounds.y + controlBounds.height > height) {
      throw new Error(`Cabinet operation layout overflows at ${width}x${height}.`);
    }
    desktopLayouts.push({ width, height, mapWidth: Math.round(mapBounds.width), rack6Visible: true, homeGapVisible: true, rack6ControlVisible: true, documentWidth });
  }

  await page.getByRole('button', { name: 'Ventilate cabinet', exact: true }).click();
  const ventilationDialog = page.getByRole('dialog');
  await ventilationDialog.getByRole('button', { name: 'Ventilate cabinet', exact: true }).click();
  await ventilationDialog.getByText(/Ventilation target: six racks evenly spaced with five 20 mm gaps/).waitFor();
  await ventilationDialog.getByText(/Moving Rack 2 RIGHT · 50%/).waitFor();
  for (let elapsed = 0; elapsed < 10000 && await ventilationDialog.locator('h2').innerText() !== 'Cabinet ventilation complete'; elapsed += 100) await wait(100);
  if (await ventilationDialog.locator('h2').innerText() !== 'Cabinet ventilation complete') {
    throw new Error(`Ventilation did not reach success. commands=${commands.filter(command => command.kind === 'VENTILATE').length}; dialog=${(await ventilationDialog.innerText()).slice(0, 900)}`);
  }
  if (commands.filter(command => command.kind === 'VENTILATE').length !== 6) throw new Error('Ventilation did not dispatch all six rack commands.');
  await ventilationDialog.getByRole('button', { name: 'Done' }).click();
  if (await page.locator('[aria-label^="Ventilation gap "]').count() !== 5) throw new Error('Ventilation layout did not show all five spaced gaps.');
  if (!(await page.getByRole('button', { name: 'Ventilate cabinet', exact: true }).isDisabled())) throw new Error('Ventilation remained available while the cabinet was already ventilated.');
  const commandsBeforeLight = commands.length;
  const lightOnButton = page.getByRole('button', { name: 'Turn light on for Rack 1' });
  await lightOnButton.click();
  await page.getByText('Rack 1 light turned on.').waitFor();
  await page.getByRole('button', { name: 'Turn light off for Rack 1' }).waitFor();
  await page.getByLabel('Rack 1 light on').waitFor();
  if (commands.length !== commandsBeforeLight + 1 || commands.at(-1).kind !== 'LIGHT') throw new Error('LIGHT did not dispatch directly.');
  if (await page.getByRole('dialog').count()) throw new Error('LIGHT unexpectedly opened a confirmation dialog.');
  await page.getByRole('button', { name: 'Turn light off for Rack 1' }).click();
  await page.getByText('Rack 1 light turned off.').waitFor();
  await page.getByRole('button', { name: 'Turn light on for Rack 1' }).waitFor();
  if (commands.at(-1).kind !== 'LIGHT_OFF') throw new Error('LIGHT_OFF did not dispatch after the telemetry state switched on.');
  if (await page.getByLabel('Rack 1 light on').count()) throw new Error('Rack light indicator remained on after LIGHT_OFF telemetry.');
  if (await page.getByRole('dialog').count()) throw new Error('LIGHT_OFF unexpectedly opened a confirmation dialog.');

  health = { ...health, serial_connected: false, simulation_online: false };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Open R1/ }).waitFor();
  if (!(await openRack(1).isDisabled())) throw new Error('Open remained enabled while Serial was offline.');
  health = { ...health, serial_connected: true };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Simulation unavailable. GAP commands are disabled.').waitFor();
  if (!(await openRack(1).isDisabled())) throw new Error('Open remained enabled while IPCSIM was unavailable.');
  health = { device_id: 'ui-sim', device_type: 'IPCSIM', serial_connected: true, simulation_online: true, hardware_enabled: true };
  failNextCommand = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openRack(1).click();
  const failedOpenConfirmation = page.getByRole('dialog');
  await failedOpenConfirmation.getByRole('heading', { name: 'Confirm rack movement' }).waitFor();
  await failedOpenConfirmation.getByRole('button', { name: 'Confirm Open Rack 1', exact: true }).click();
  try {
    await page.getByRole('dialog').getByText(/Simulated Serial failure/).waitFor();
  } catch {
    throw new Error(`Command-error state was not rendered. dispatched=${JSON.stringify(commands.map(command => `${command.kind}:${command.rack_id}`))}; page=${(await page.locator('body').innerText()).slice(-1000)}`);
  }
  await page.getByRole('dialog').getByRole('button', { name: 'I checked · reset' }).click();
  await page.getByText(/GAP: Chưa xác định/).waitFor();
  if (await openRack(1).isDisabled()) throw new Error('Operator acknowledgement did not unlock recovery controls.');

  await page.setViewportSize({ width: 390, height: 844 });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (horizontalOverflow) throw new Error('Cabinet operation page overflows the mobile viewport.');
  if (errors.length) throw new Error(errors.join('\n'));

  console.log(JSON.stringify({
    passed: ['redundant HOME blocked', 'active rack blocked while shared-gap rack remains usable', 'repeat ventilation blocked after completion', 'OPEN confirmation before dispatch', 'HOME confirmation before dispatch', 'LIGHT/LIGHT_OFF without confirmation', 'telemetry-driven rack light color/state', 'telemetry success before command HTTP response', 'Rack1→Rack2 without movement', 'Rack2→Rack3', 'Rack3→Rack4', 'Rack4→Rack3', 'Rack5→Rack6', 'Rack6→Return Home', 'ventilation movement/progress/completion', 'queue while moving', 'wire telemetry progress/speed', 'offline lockout', 'simulation unavailable', 'command error lockout/recovery', '1366x768 layout', '1440x900 layout', '1920x1080 layout', 'mobile no-overflow'],
    desktopLayouts,
    commands: commands.map(command => `${command.kind}:${command.rack_id}`),
    movements: movements.map(move => move.steps),
    pageErrors: errors
  }, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});