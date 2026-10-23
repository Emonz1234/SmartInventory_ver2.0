// UI contract/visual tests use isolated API fixtures; no live Server writes.
const {chromium}=require('../.tools/ui/node_modules/playwright');
const assert=require('node:assert/strict'), http=require('node:http'), fs=require('node:fs'), path=require('node:path');
(async()=>{
 const dist=path.resolve('Server/frontend/dist');
 const server=http.createServer((req,res)=>{let file=path.resolve(dist,new URL(req.url,'http://localhost').pathname.slice(1));if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(dist,'index.html');res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768}});page.setDefaultTimeout(15000);
  const failures=[],writes=[],reads=[];page.on('pageerror',e=>failures.push(String(e)));
  const permissions=['ipc.view','cabinet.view'];
  let categories=[{id:1,code:'PARTS',name:'Parts',is_active:true}], nextProductId=2;
  let grants=Object.fromEntries(permissions.map(p=>[p,['ALL']])), operations=[], apiFailure=false;
  const devices=['REAL','SIMULATION'].map((source_type,i)=>({id:i?'IPCSIM':'IPC01',name:i?'Simulation IPC':'Warehouse IPC',source_type,online:true,serial_connected:true,synchronized:true,last_seen:'2026-10-06T08:00:00Z',last_sync:'2026-10-06T08:00:00Z',cabinet_group_count:1,racks:6,enabled:true}));
  const racks=devices.flatMap((d,index)=>Array.from({length:6},(_,i)=>({id:index*6+i+1,cabinet_id:index+1,cabinet:`Cabinet 0${index+1}`,name:`Rack 0${i+1}`,ipc_id:d.id,source_type:d.source_type,online:true,serial_connected:true,synchronized:true,state:'IDLE',configuration_status:'configured',rack_index:i+1,cabinet_index:index+1,last_update:'2026-10-06T08:00:00Z'})));
  const locations=devices.map((d,index)=>({id:index+1,ipc_id:d.id,cabinet_id:index+1,cabinet:`Cabinet 0${index+1}`,rack_id:index*6+1,rack:'Rack 01',rack_index:1,cabinet_index:index+1,location_code:'A01',shelf:'S1',path:`${d.id} / Cabinet 0${index+1} / Rack 01`,source_type:d.source_type,quantity:5,capacity:100,status:'AVAILABLE',sync_status:'Synced',goods:[{item_id:1,name:'Bearing',quantity:5,available_quantity:5}]}));
  const products=devices.map((d,index)=>({id:1,name:'Bearing',sku:'BR-01',barcode:'123',unit:'pcs',category:'Parts',category_id:1,is_active:true,source_type:d.source_type,quantity:5,available_quantity:5,min_stock:10,max_stock:100,stock_status:'Low Stock',sync_status:'Synced',locations:[{...locations[index],occupied_quantity:5,available_quantity:5}],last_updated:'2026-10-06T08:00:00Z'}));
  await page.addInitScript(()=>{if(!localStorage.getItem('smartInventory.language'))localStorage.setItem('smartInventory.language','en');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),name=url.pathname.slice(5),method=req.method();let json=[];
   const scope=url.searchParams.get('source_type')||'REAL', filter=rows=>rows.filter(r=>scope==='ALL'||r.source_type===scope);
   if(method==='GET')reads.push(name);else writes.push({name,method,body:req.postDataJSON()});
   if(name==='session')json={authenticated:method!=='DELETE',username:'Operator test',grants};
   else if(apiFailure)return route.fulfill({status:503,json:{error:'Connection unavailable'}});
   else if(name==='dashboard')json={ipcs:filter(devices).length,online:filter(devices).length,cabinet_groups:filter(devices).length,racks:filter(racks).length,active_alarms:1};
   else if(name==='inventory-overview')json={products:filter(products),locations:filter(locations),devices:filter(devices),pending_sync:1,transactions:[{id:'recent-1',item_id:1,product:'Bearing',kind:'PUT',quantity:2,ipc_id:'IPC01',cabinet:'Cabinet 01',rack:'Rack 01',source_type:'REAL',operation_status:'COMPLETED',created_at:'2026-10-06T08:00:00Z'}]};
   else if(name==='ipcs')json=filter(devices);
   else if(name==='rack-status')json=filter(racks).filter(row=>!url.searchParams.get('ipc_id') || row.ipc_id===url.searchParams.get('ipc_id')).filter(row=>!url.searchParams.get('cabinet_id') || String(row.cabinet_id)===url.searchParams.get('cabinet_id'));
   else if(name==='cabinet-groups')json=filter(devices).filter(device=>device.id===url.searchParams.get('ipc_id')).map(device=>({id:device.source_type==='REAL'?1:2,name:device.source_type==='REAL'?'Cabinet 01':'Cabinet 02',source_type:device.source_type,code:'C01',configuration_status:'configured',racks:6}));
   else if(name==='alarms')json=[{id:1,device_id:'IPC01',rack_id:1,source_type:'REAL',severity:'ERROR',code:'OBSTRUCTED',active:true,created_at:'2026-10-06T08:00:00Z'}];
   else if(name==='operations'&&method==='POST'){const body=req.postDataJSON();assert.equal(body.item_id,1);assert.equal(body.bin_id,1);assert.equal(body.rack_id,1);assert.equal(body.device_id,'IPC01');assert(['PUT','PICK'].includes(body.kind));assert.equal(body.quantity,body.kind==='PUT'?2:3);operations=[{id:body.kind==='PUT'?'workflow-1':'workflow-2',device_id:'IPC01',rack_id:1,kind:body.kind,quantity:body.quantity,state:'sent',execution_state:'moving',source_type:'REAL',created_at:'2026-10-06T08:00:00Z'}];json={id:operations[0].id,state:'queued'};}
   else if(/^operations\/workflow-[12]\/confirm$/.test(name)){assert.equal(req.postDataJSON().success,true);assert(req.postDataJSON().note);operations[0].state='confirmed';json={id:operations[0].id,state:'confirmed'};}
   else if(name==='operations')json=operations;
   else if(name==='users')json=[{id:1,username:'Operator',is_active:true,roles:[]}];
   else if(name==='roles')json=[{id:1,name:'Operator',permissions:[]}];
   else if(name==='permissions')json=permissions;
   else if(name==='settings')json={temperature_max:40,humidity_max:80};
   else if(name==='categories'){
    if(method==='GET')json=categories;
    else if(method==='POST'){const body=req.postDataJSON();const row={...body,id:categories.length+1};categories.push(row);json={id:row.id};}
    else if(method==='PATCH'){const body=req.postDataJSON();Object.assign(categories.find(c=>c.id===body.id),body);json={id:body.id};}
    else {const body=req.postDataJSON();categories=categories.filter(c=>c.id!==body.id);json={status:'deleted'};}
   }
   else if(name==='goods'){
    if(method==='GET')json=[...new Map(products.map(p=>[p.id,{...p,code:p.sku}])).values()];
    else if(method==='POST'){
      const body=req.postDataJSON();if(products.some(p=>p.sku===body.code))return route.fulfill({status:400,json:{error:'SKU already exists'}});
      const row={...body,id:nextProductId++,sku:body.code,category:categories.find(c=>c.id===body.category_id)?.name,source_type:'REAL',quantity:0,available_quantity:0,min_stock:body.min_qty,max_stock:body.max_qty,stock_status:'Out of Stock',sync_status:'Synced',locations:[]};products.push(row);json={id:row.id};
    }else if(method==='PATCH'){const body=req.postDataJSON();products.filter(p=>p.id===body.id).forEach(p=>Object.assign(p,body));json={id:body.id};}
    else {const body=req.postDataJSON();for(let i=products.length-1;i>=0;i--)if(products[i].id===body.id)products.splice(i,1);json={status:'deleted'};}
   }
   await route.fulfill({json});
  });
  racks[2].serial_connected=false;
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.ipc-tree').first().waitFor();
  assert.equal(await page.locator('.ipc-tree[open]').count(),0,'IPC starts collapsed');
  assert.equal(await page.locator('.cabinet-tree').count(),0,'Children fetched only when needed');
  assert(!reads.includes('rack-status'));
  const scope=page.getByRole('combobox').filter({has:page.locator('option[value="ALL"]')});
  await scope.selectOption('ALL');
  await page.waitForFunction(()=>document.querySelectorAll('.ipc-tree').length===2);
  assert.equal(await page.locator('.device-source').count(),2,'REAL and SIMULATION separated');
  const real=page.locator('.device-source').filter({has:page.getByRole('heading',{name:'REAL SYSTEM',exact:true})});
  await real.locator('.ipc-tree > summary').click();
  await real.locator('.cabinet-tree').waitFor();
  assert.equal(await real.locator('.cabinet-tree[open]').count(),0,'Cabinet starts collapsed');
  assert.match(await real.locator('.ipc-tree > summary').innerText(),/Warning/,'IPC aggregates child warning');
  assert.match(await real.locator('.cabinet-tree > summary').innerText(),/Warning/);
  await real.locator('.cabinet-tree > summary').click();
  assert.equal(await real.locator('.device-rack-row:visible').count(),6);
  fs.mkdirSync('test-results/server-device-tree',{recursive:true});
  for(const [width,height] of [[1366,768],[1920,1080],[390,844]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');await page.screenshot({path:`test-results/server-device-tree/tree-${width}.png`,fullPage:true});}
  await page.setViewportSize({width:1366,height:768});
  await real.locator('.device-rack-row').nth(2).click();
  await page.locator('.detail-drawer').waitFor();
  assert.match(await page.locator('.detail-drawer').innerText(),/Rack 03/);
  await page.evaluate(()=>sessionStorage.removeItem('server.navigation'));
  grants={'ipc.view':['REAL'],'cabinet.view':['SIMULATION']};
  await page.reload();await page.locator('.ipc-tree').first().waitFor();
  const before=reads.filter(name=>name==='rack-status'||name==='cabinet-groups').length;
  await page.locator('.ipc-tree > summary').first().click();
  await page.getByText('Cabinet/Rack access is not permitted.',{exact:true}).waitFor();
  assert.equal(reads.filter(name=>name==='rack-status'||name==='cabinet-groups').length,before,'No unauthorized child queries');
  assert.equal(await page.locator('.device-source').count(),1,'Scope permissions preserved');
  assert.deepEqual(failures,[]);assert.deepEqual(writes,[]);
  console.log('PASS: permission-scoped hierarchy, collapsed defaults, REAL/SIMULATION separation, warning rollup, 6 racks and existing rack drawer; GET only');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
