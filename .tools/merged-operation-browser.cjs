const assert = require('node:assert/strict');
const { chromium } = require('./ui/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const failures = [], commands = [], recoveries = [];
    page.on('pageerror', error => failures.push(error.message));
    const racks = Array.from({length:6}, (_, i) => ({id:i+1,rack_code:String(i+1),rack_index:i+1,cabinet_index:1,cabinet_id:1}));
    let events = [];
    let mechanical = {boot_id:'boot-1',cabinet_index:1,online:true,system_state:'IDLE',current_gap:6,active_command_id:null,active_rack:null,allowed_actions:[],fault_context:null,racks:{}};
    await page.addInitScript(() => {
      localStorage.setItem('token','mock-token');
      localStorage.setItem('smartInventory.language','en');
      localStorage.setItem('edgeOperatorSession','mock-session');
      localStorage.setItem('edgeOperatorName','Operator');
      localStorage.setItem('edgeOperatorPermissions',JSON.stringify(['inventory.add_operation','cabinet.control']));
    });
    await page.route('**/api/**', async route => {
      const request=route.request(), endpoint=new URL(request.url()).pathname;
      let json={};
      if(endpoint.endsWith('/operator/session')) json={username:'Operator',permissions:['inventory.add_operation','cabinet.control']};
      else if(endpoint.endsWith('/system/health')) json={device_type:'IPCSIM',serial_connected:true,simulation_online:true,simulation_states:[mechanical]};
      else if(endpoint.endsWith('/cabinets/1/racks')) json=racks;
      else if(endpoint.endsWith('/telemetry/operation')) json={data:events};
      else if(endpoint.endsWith('/operator/simulation-state')) json={states:[mechanical],history:[]};
      else if(endpoint.endsWith('/operator/device-commands')) {
        assert.equal(request.headers()['x-operator-session'],'mock-session');
        const payload=request.postDataJSON();commands.push(payload);
        assert.equal(payload.kind,'OPEN');assert.equal(payload.rack_id,3);
        mechanical={...mechanical,system_state:'OPENING',active_command_id:payload.request_key};
        json={state:'local_sent'};
      } else if(endpoint.endsWith('/operator/simulation-recovery')) {
        const payload=request.postDataJSON();recoveries.push(payload);
        assert.deepEqual(payload,{cabinet_index:1,action:'RESUME',fault_id:'mock-fault',confirmed:true});
        mechanical={...mechanical,system_state:'OPENING',allowed_actions:[],fault_context:{...mechanical.fault_context,resumed:true}};
        json={state:'RECOVERING'};
      } else if(request.method()!=='GET') throw new Error('Unexpected mock write: '+endpoint);
      await route.fulfill({json});
    });
    async function language(lang) {
      await page.locator('.language-trigger').last().click();
      await page.getByRole('menuitemradio',{name:lang==='en'?'English':'Tiếng Việt'}).click();
    }
    await page.goto('http://127.0.0.1:3012/ui/cabinets/1');
    await page.getByRole('button',{name:'Open R3',exact:true}).click();
    await language('vi');
    assert.equal(commands.length,0);
    await language('en');
    await page.getByRole('button',{name:'Confirm Open Rack 3',exact:true}).click();
    await page.getByRole('heading',{name:'Opening Rack 3',exact:true}).waitFor();
    await page.waitForFunction(() => document.body.innerText.includes('Waiting for simulation telemetry'));
    assert.equal(commands.length,1);
    const requestKey=commands[0].request_key;
    assert.match(requestKey,/^[0-9a-f-]{36}$/);
    await language('vi');await language('en');assert.equal(commands.length,1);
    mechanical={...mechanical,system_state:'ERROR',allowed_actions:['RESUME','ABORT','HOME'],fault_context:{fault_id:'mock-fault',rack_id:3,previous_state:'OPENING',error_code:'OBSTRUCTED',command_id:requestKey}};
    await page.getByRole('heading',{name:'Operation needs attention',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'I checked · reset',exact:true}).count(),0);
    await page.getByRole('button',{name:'Continue in background',exact:true}).click();
    await page.getByRole('button',{name:'Resume operation',exact:true}).click();
    await language('vi');await language('en');assert.equal(recoveries.length,0);
    await page.getByRole('button',{name:'Confirm inspection',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(recoveries.length,1);assert.equal(commands.length,1);
    assert.equal(mechanical.active_command_id,requestKey);
    mechanical={...mechanical,system_state:'OPEN',active_command_id:null,active_rack:3,current_gap:2,fault_context:null};
    events=[{id:1,rack_id:3,is_endpoint:1,state:-1,displacement:64,movement_speed:0}];
    await page.getByRole('button',{name:'Open R3',exact:true}).waitFor();
    await page.waitForFunction(() => document.body.innerText.includes('Rack 3 opened'));
    await page.getByRole('button',{name:'Ventilate cabinet',exact:true}).click();
    await page.getByRole('heading',{name:'Confirm operation',exact:true}).waitFor();
    mechanical={...mechanical,boot_id:'boot-2',system_state:'IDLE',active_rack:null,current_gap:6};
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(commands.length,1);
    assert(await page.getByRole('button',{name:'Return Home · GAP right of R6',exact:true}).isDisabled());
    assert.deepEqual(failures,[]);
    console.log('PASS: bilingual confirmation/active command, stable request_key, no resend, backend-authorized RESUME, no Simulation local reset, fresh endpoint completion, restart clears parent ventilation confirmation. Mock APIs only.');
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
