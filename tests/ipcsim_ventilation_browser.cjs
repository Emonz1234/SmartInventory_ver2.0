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
    hardware_enabled: true,
    simulation_states: [{cabinet_index:1,online:true,boot_id:'vent-test',sequence:1,system_state:'IDLE',current_gap:6,racks:Object.fromEntries(racks.map((rack,index)=>[rack.id,{position_mm:index*100,target_position_mm:index*100,access_state:'CLOSED',is_moving:false}])),sensors:{position_trusted:true,faults:{}}}]
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
    localStorage.setItem('smartInventory.language', 'en');
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
    if (path.endsWith('/cabinets')) return route.fulfill({ json: [{ id: 1, cabinet_index: 1, status: 'ACTIVE' }] });
    if (path.endsWith('/faults/overview')) return route.fulfill({ json: { maintenance_warnings: [] } });
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
        // Simulate missing start frames: only the final physical snapshot can confirm completion.
        if (!ventilationSimulationStarted) {
          ventilationSimulationStarted = true;
          void (async () => {
            for (let order = 2; order <= 6; order++) {
              pushTelemetry(order, 12, 32, 0, 2);
              await wait(700);
              pushTelemetry(order, 0, 0, 0, 2);
            }
            for (let rackId = 1; rackId <= 6; rackId++) pushTelemetry(rackId, 0, 0, 1, -1);
            Object.assign(health.simulation_states[0],{system_state:'VENTILATED',last_command_id:body.request_key,current_gap:null,sequence:2,racks:Object.fromEntries(racks.map((rack,index)=>[rack.id,{position_mm:index*120,target_position_mm:index*120,access_state:'VENTILATED',is_moving:false}]))});
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
            Object.assign(health.simulation_states[0],{system_state:'VENTILATED',last_command_id:body.request_key,current_gap:null,sequence:2,racks:Object.fromEntries(racks.map((rack,index)=>[rack.id,{position_mm:index*120,target_position_mm:index*120,access_state:'VENTILATED',is_moving:false}]))});
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

  try {
    await page.goto(baseUrl.replace(/\/$/, '') + '/cabinets/1');
    await page.getByRole('button', {name:'Ventilate cabinet',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByRole('button', {name:'Ventilate cabinet',exact:true}).evaluate(button=>{button.click();button.click();});
    while(!health.simulation_states[0].last_command_id)await wait(50);
    const finalState=health.simulation_states[0];
    const commandId=finalState.last_command_id;
    finalState.last_command_id='previous-command';
    await wait(2200);
    if(await dialog.getByRole('heading',{name:'Cabinet ventilation complete',exact:true,level:2}).count())throw new Error('An unrelated command must not complete the popup');
    finalState.last_command_id=commandId;finalState.racks[6].position_mm=580;
    await wait(2200);
    if(await dialog.getByRole('heading',{name:'Cabinet ventilation complete',exact:true,level:2}).count())throw new Error('An incomplete endpoint must not complete the popup');
    finalState.racks[6].position_mm=600;
    await dialog.getByRole('heading',{name:'Cabinet ventilation complete',exact:true,level:2}).waitFor();

    if(commands.filter(command=>command.kind==='VENTILATE').length!==1)throw new Error('Expected exactly one group request, including on double click');
    await dialog.getByText('All 6 racks returned to the ventilation endpoint.',{exact:true}).waitFor();
    require('node:fs').mkdirSync('test-results/ipcsim-ventilation',{recursive:true});
    await page.screenshot({path:'test-results/ipcsim-ventilation/success.png'});
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    if(!await page.getByRole('button',{name:'Ventilate cabinet',exact:true}).isDisabled())throw new Error('Completed ventilation must disable repeat operation');
    if(errors.length)throw new Error(errors.join('\n'));
    console.log('PASS: one cabinet VENTILATE request, duplicate click guarded, six confirmed endpoints and success dialog');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
