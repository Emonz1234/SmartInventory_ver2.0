const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
(async () => {
  const dist = path.resolve('IPCSIM/frontend/dist');
  const server = http.createServer((request,response) => {
    let file = path.resolve(dist,new URL(request.url,'http://localhost').pathname.replace(/^\/ui\/?/,''));
    if (!file.startsWith(dist+path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file=path.join(dist,'index.html');
    response.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');response.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1366,height:768}});
    await page.addInitScript(()=>{if(!localStorage.getItem('smartInventory.language'))localStorage.setItem('smartInventory.language','en');localStorage.setItem('token','test');localStorage.setItem('edgeOperatorSession','test');});
    const errors=[],writes=[];page.on('pageerror',error=>errors.push(String(error)));
    const cabinets=Array.from({length:22},(_,i)=>({id:i+1,cabinet_index:i+1,cabinet_name:`Cabinet ${String(i+1).padStart(2,'0')}`,cabinet_code:`C${i+1}`,rack_count:6,status:'ACTIVE'}));
    const racks=cabinets.flatMap(c=>Array.from({length:6},(_,i)=>({id:(c.id-1)*6+i+1,cabinet_id:c.id,rack_index:i+1,rack_code:String((c.id-1)*6+i+1),status:'READY'})));
    const health={device_type:'IPCSIM',serial_connected:true,simulation_online:true,server_online:true,server_synced:true,database_healthy:true,local_operation_available:true,pending_transactions:0,hardware_status:'ONLINE',simulation_states:cabinets.map(c=>({cabinet_index:c.id,online:true,system_state:'IDLE',current_gap:6,racks:Object.fromEntries(racks.filter(r=>r.cabinet_id===c.id).map(r=>[r.rack_code,{position_mm:(r.rack_index-1)*100,access_state:'IDLE',is_moving:false}]))}))};
    let mode='normal',fail=false,incidents=[];
    await page.route('**/api/**',async route=>{
      const request=route.request(),pathname=new URL(request.url()).pathname;
      if(request.method()!=='GET')writes.push(pathname);
      if(fail && ['/dashboard/summary','/environment/history','/faults/overview'].some(end=>pathname.endsWith(end))){await route.fulfill({status:503,json:{detail:'unavailable'}});return;}
      const now=new Date().toISOString();let json={};
      if(pathname.endsWith('/operator/session'))json={username:'Operator',permissions:[]};
      else if(pathname.endsWith('/system/health'))json=health;
      else if(pathname.endsWith('/cabinets'))json=[...cabinets].reverse();
      else if(pathname.endsWith('/racks'))json=racks.filter(r=>r.cabinet_id===Number(pathname.split('/').at(-2)));
      else if(pathname.endsWith('/dashboard/summary'))json={cabinet_status:{total_cabinets:22,total_racks:132},inventory_summary:{total_items:20,total_stock:411,low_stock_count:2}};
      else if(pathname.endsWith('/faults/overview'))json={summary:{active_faults:incidents.length},active_faults:incidents,maintenance_warnings:incidents.length?[{cabinet_index:5,rack_index:3},{cabinet_index:5,rack_index:4}]:[],history:incidents.map(row=>({...row,status:row.id===1?'RESOLVED':'ACTIVE'}))};
      else if(pathname.endsWith('/environment/history'))json={data:mode==='empty'?[]:[{id:1,rack_id:1,temperature:20,humidity:40,weight:10,smoke:mode==='smoke'?1:0,created_at:now},{id:2,rack_id:2,temperature:30,humidity:60,smoke:0,created_at:now},{id:3,rack_id:3,temperature:999,humidity:90,smoke:0,created_at:new Date(Date.now()-60000).toISOString()},{id:4,rack_id:7,temperature:999,humidity:90,smoke:0,created_at:now},{id:5,rack_id:4,temperature:null,humidity:null,smoke:null,created_at:now}]};
      else if(pathname.endsWith('/device/snapshot'))json={operation_history:Array.from({length:7},(_,i)=>({id:i,body:{kind:'OPEN',address:i+1},execution_state:'completed',created_at:new Date(Date.now()-i*1000).toISOString()})),records:[]};
      else if(pathname.endsWith('/operator/operations'))json=[{id:'pick',kind:'PICK',cabinet_index:1,rack_index:1,operation_status:'COMPLETED',created_at:now}];
      await route.fulfill({json});
    });
    // Exclude online-looking telemetry belonging to a cabinet whose Simulation is offline.
    health.simulation_states[1].online=false;
    health.simulation_states[2].racks['13'].is_moving=true;
    const origin=`http://127.0.0.1:${server.address().port}/ui/`;
    fs.mkdirSync('test-results/ipcsim-operations-overview',{recursive:true});
    await page.goto(origin);
    await page.getByTestId('overview-cabinet').nth(21).waitFor();
    assert.equal(await page.getByTestId('overview-cabinet').count(),22);assert.equal(await page.getByTestId('overview-rack-indicator').count(),0);
    assert.equal(await page.getByTestId('overview-cabinet').nth(2).getAttribute('data-status'),'Moving','Cabinet reflects a moving rack even if cabinet state is IDLE');
    const summaryText=await page.getByTestId('overview-cabinet-summary').innerText();assert(summaryText.includes('21') && summaryText.includes('Offline / Unknown'));
    assert.equal(await page.getByTestId('overview-cabinet').evaluateAll(nodes=>new Set(nodes.map(node=>Math.round(node.getBoundingClientRect().top))).size),3,'22 cabinets fit three desktop rows');
    assert.deepEqual(await page.getByTestId('overview-cabinet').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label').split(' ')[1])),Array.from({length:22},(_,i)=>String(i+1).padStart(2,'0')));
    await page.getByTestId('overview-temperature').getByText('25.0',{exact:false}).waitFor();
    assert((await page.getByTestId('overview-temperature').innerText()).includes('20.0 / 30.0'));
    assert((await page.getByTestId('overview-humidity').innerText()).includes('50.0'));
    await page.getByTestId('connectivity-Simulation').getByText('Degraded',{exact:true}).waitFor();
    await page.getByTestId('connectivity-Serial / COM').getByText('Connected',{exact:true}).waitFor();
    assert.equal(await page.getByTestId('overview-activity').count(),4);
    for(const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:900,height:768},{width:390,height:844}]){
      await page.setViewportSize(viewport);await page.evaluate(()=>scrollTo(0,0));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page horizontal overflow');
      if(viewport.width>=1366){const box=await page.getByTestId('overview-activity').last().boundingBox();assert(box.y+box.height<=viewport.height,'All recent activity visible in initial viewport');}
      await page.screenshot({path:`test-results/ipcsim-operations-overview/normal-${viewport.width}.png`,fullPage:true,animations:'disabled'});
    }
    await page.setViewportSize({width:1366,height:768});
    await page.getByTestId('overview-cabinet').first().click();
    await page.getByText('GAP: 6',{exact:true}).waitFor();
    assert.equal(await page.locator('.MuiDrawer-modal table tbody tr').count(),6);
    assert((await page.locator('.MuiDrawer-modal:visible').innerText()).includes('500 mm'));
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.evaluate(()=>localStorage.setItem('smartInventory.language','vi'));
    await page.reload();await page.getByTestId('overview-cabinet').nth(21).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Vietnamese layout has no horizontal overflow');const viActivity=await page.getByTestId('overview-activity').last().boundingBox();assert(viActivity.y+viActivity.height<=768,'Vietnamese recent activity fits initial viewport');
    await page.screenshot({path:'test-results/ipcsim-operations-overview/normal-vi-1366.png',fullPage:true,animations:'disabled'});
    await page.evaluate(()=>localStorage.setItem('smartInventory.language','en'));
    await page.reload();await page.getByTestId('overview-cabinet').nth(21).waitFor();
    const refresh=()=>page.getByRole('button',{name:'Refresh',exact:true}).click();
    incidents=Array.from({length:6},(_,i)=>({id:i+1,cabinet_index:i+1,rack_index:3,severity:i===4?'CRITICAL':'WARNING',description:'Inspection required',detected_at:(Date.now()-i*1000)/1000}));
    incidents.unshift({...incidents[4],id:100,severity:'WARNING',rack_index:1});
    mode='smoke';await refresh();await page.getByTestId('overview-incident').nth(1).waitFor();
    assert.equal(await page.getByTestId('overview-incident').count(),2);
    assert.match(await page.getByTestId('overview-incident').first().innerText(), /resolved/i);
    assert.equal(await page.getByTestId('overview-maintenance').count(),1, 'Maintenance grouped by cabinet');
    assert.match(await page.getByTestId('overview-maintenance').innerText(), /R03, R04/);
    assert.equal(await page.getByTestId('overview-cabinet').nth(4).getAttribute('data-status'),'Fault','Critical rack outranks warning on the same cabinet');
    await page.getByTestId('overview-cabinet').nth(4).click();
    await page.locator('.MuiDrawer-modal:visible').getByRole('row').filter({hasText:'Rack 3'}).getByText('Fault',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByText(/Smoke detected/).waitFor();
    await page.screenshot({path:'test-results/ipcsim-operations-overview/incidents-smoke.png',fullPage:true,animations:'disabled'});
    health.simulation_states.forEach(row=>row.online=false);await refresh();
    await page.getByTestId('connectivity-Simulation').getByText('Disconnected',{exact:true}).waitFor();
    await page.getByTestId('connectivity-Serial / COM').getByText('Connected',{exact:true}).waitFor();
    assert((await page.getByTestId('overview-temperature').innerText()).includes('N/A'));
    // Active critical incidents remain highlighted even while transport is offline.
    assert((await page.getByTestId('overview-cabinet').nth(4).getAttribute('aria-label')).includes('Fault'));
    health.simulation_states.forEach(row=>row.online=true);mode='empty';incidents=[];await page.getByRole('dialog').filter({has:page.locator('#simulation-connection-title')}).waitFor({state:'hidden'});await refresh();
    await page.getByText('No faults recorded in the last 24 hours.',{exact:true}).waitFor();
    assert((await page.getByTestId('overview-temperature').innerText()).includes('N/A'));
    fail=true;await refresh();await page.getByRole('alert').filter({hasText:'Some overview data'}).waitFor();
    assert((await page.getByTestId('overview-temperature').innerText()).includes('N/A'));
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
    console.log('PASS: 22 cabinets / 132 racks, drawer GAP and positions, independent Simulation/COM, fresh aggregates excluding stale/offline/invalid values, 24h history including resolved faults, grouped maintenance, smoke, activity, empty/API failures, responsive; GET only');
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1)});
