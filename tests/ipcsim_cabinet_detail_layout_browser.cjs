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
      if(pathname.endsWith('/operator/session'))json={username:'Operator',permissions:['inventory.add_operation']};
      else if(pathname.endsWith('/telemetry/operation'))json={data:[]};
      else if(pathname.endsWith('/system/health'))json=health;
      else if(pathname.endsWith('/cabinets'))json=[...cabinets].reverse();
      else if(pathname.endsWith('/racks'))json=racks.filter(r=>r.cabinet_id===Number(pathname.split('/').at(-2)));
      else if(pathname.endsWith('/dashboard/summary'))json={cabinet_status:{total_cabinets:22,total_racks:132},inventory_summary:{total_items:20,total_stock:411,low_stock_count:2}};
      else if(pathname.endsWith('/faults/overview'))json={summary:{active_faults:incidents.length},active_faults:incidents,maintenance_warnings:[],history:[]};
      else if(pathname.endsWith('/environment/history'))json={data:mode==='empty'?[]:[{id:1,rack_id:1,temperature:20,humidity:40,weight:10,smoke:mode==='smoke'?1:0,created_at:now},{id:2,rack_id:2,temperature:30,humidity:60,smoke:0,created_at:now},{id:3,rack_id:3,temperature:999,humidity:90,smoke:0,created_at:new Date(Date.now()-60000).toISOString()},{id:4,rack_id:7,temperature:999,humidity:90,smoke:0,created_at:now},{id:5,rack_id:4,temperature:null,humidity:null,smoke:null,created_at:now}]};
      else if(pathname.endsWith('/device/snapshot'))json={operation_history:Array.from({length:7},(_,i)=>({id:i,body:{kind:'OPEN',address:i+1},execution_state:'completed',created_at:new Date(Date.now()-i*1000).toISOString()})),records:[]};
      else if(pathname.endsWith('/operator/operations'))json=[{id:'pick',kind:'PICK',cabinet_index:1,rack_index:1,operation_status:'COMPLETED',created_at:now}];
      await route.fulfill({json});
    });
    const origin=`http://127.0.0.1:${server.address().port}/ui/cabinets/1`;
    fs.mkdirSync('test-results/ipcsim-cabinet-detail',{recursive:true});
    await page.goto(origin);
    await page.getByRole('heading',{name:'Rack operation'}).waitFor();
    await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.getAttribute('aria-label')==='Open R1');return b&&!b.disabled;});
    assert.equal(await page.getByRole('button', { name: /Turn light/ }).count(), 0, 'No manual light controls');
    await page.getByText('Operation status', { exact: true }).waitFor();
    assert.match(await page.locator('.rack-operation-status').innerText(), /Light: Auto/);
    for(const [width,height] of [[1366,768],[1920,1080],[900,768],[390,844]]){
      await page.setViewportSize({width,height});
      await page.waitForTimeout(200);
      assert.equal(await page.locator('[title^="Rack "]').count(),6);
      assert.equal(await page.getByRole('button',{name:/^Open R[1-6]$/}).count(),6);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
      if(width>=1366){const box=await page.locator('.rack-operation-history').boundingBox();assert(box.y+box.height<=height,'Queue and latest log visible in first viewport');}
      await page.screenshot({path:`test-results/ipcsim-cabinet-detail/idle-${width}.png`});
    }
    const state=health.simulation_states[0];
    state.current_gap=3;state.racks['4'].position_mm=400;
    await page.waitForTimeout(2200);
    const before=await page.locator('[title^="Rack 4:"]').evaluate(node=>node.style.left);
    state.online=false;health.simulation_online=false;
    await page.waitForTimeout(2200);
    assert(await page.getByRole('button',{name:'Open R1',exact:true}).isDisabled());
    assert(await page.getByRole('button',{name:'Ventilate cabinet',exact:true}).evaluate(node=>node.matches(':disabled')));
    assert.equal(await page.locator('[title^="Rack 4:"]').evaluate(node=>node.style.left),before,'Offline retains physical position');
    assert.equal(writes.length,0);assert.deepEqual(errors,[]);
    console.log('PASS: responsive 6-rack layout, desktop viewport, offline lockout and retained physical position');
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
