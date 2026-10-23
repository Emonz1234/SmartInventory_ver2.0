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
  const permissions=['dashboard.view','ipc.view','ipc.manage','cabinet.view','cabinet.control','inventory.view','inventory.create','inventory.update','inventory.move','environment.view','alarm.view','alarm.acknowledge','audit.view','user.view','user.manage','role.manage','system.manage'];
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
   else if(name==='rack-status')json=filter(racks);
   else if(name==='cabinet-groups')json=[{id:1,name:'Cabinet 01',source_type:scope,code:'C01',configuration_status:'configured',racks:6}];
   else if(name==='alarms')json=[{id:1,device_id:'IPC01',rack_id:1,source_type:'REAL',severity:'ERROR',code:'OBSTRUCTED',active:true,created_at:'2026-10-06T08:00:00Z'}];
   else if(name==='operations'&&method==='POST'){const body=req.postDataJSON();assert.equal(body.item_id,1);assert.equal(body.bin_id,1);assert.equal(body.rack_id,1);assert.equal(body.device_id,'IPC01');assert(['PUT','PICK'].includes(body.kind));assert.equal(body.quantity,body.kind==='PUT'?2:3);operations=[{id:body.kind==='PUT'?'workflow-1':'workflow-2',device_id:'IPC01',rack_id:1,kind:body.kind,quantity:body.quantity,state:'sent',execution_state:'moving',source_type:'REAL',created_at:'2026-10-06T08:00:00Z'}];json={id:operations[0].id,state:'queued'};}
   else if(/^operations\/workflow-[12]\/confirm$/.test(name)){assert.equal(req.postDataJSON().success,true);assert(req.postDataJSON().note);operations[0].state='confirmed';json={id:operations[0].id,state:'confirmed'};}
   else if(name==='operations')json=operations;
   else if(name==='environment')json=Array.from({length:18},(_,index)=>({id:index+1,device_id:'IPC01',rack_id:index%2+1,location:`IPC01 / Cabinet 01 / Rack 0${index%2+1}`,rack_index:index%2+1,source_type:'REAL',values:{temperature:22+index/10,humidity:50+index,smoke:index===17?1:0},created_at:new Date(Date.now()-index*60000).toISOString()}));
   else if(name==='inventory-transactions')json=Array.from({length:12},(_,index)=>({id:index+1,kind:'INBOUND',product:'Bearing',item_id:1,quantity:2,location:'IPC01 / Cabinet 01 / Rack 01',source_type:'REAL',actor:'Operator',result:'Recorded',created_at:new Date(Date.now()-index*60000).toISOString()}));
   else if(name==='audit-logs')json=[{id:1,actor:'Operator',action:'inventory.update',resource:'item',object:'Bearing',object_id:1,source_type:'REAL',before:{name:'Old'},after:{name:'Bearing'},result:'success',created_at:new Date().toISOString()}];
   else if(name==='users'){if(method==='GET')json=[{id:1,username:'Operator',is_active:true,roles:[1],role_names:['Inventory Operator'],last_login:new Date().toISOString()}];else json={id:1};} 
   else if(name==='roles')json=method==='GET'?[{id:1,name:'Operator',permissions:[{permission:'inventory.view',scope:'REAL'}]}]:{id:1};
   else if(name==='permissions')json=permissions;
   else if(name==='settings')json=method==='GET'?{temperature_max:40,humidity_max:80}:{key:req.postDataJSON().key,value:req.postDataJSON().value};
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
  const nav=async name=>{
   name=({IPC:'System structure','Receive / Issue':'Receive / Issue'})[name] || name;
   const navigation=page.locator('#server-navigation');
   const target=name==='Overview'?navigation.getByRole('button',{name,exact:true}):navigation.locator('.nav-submenu').getByRole('button',{name,exact:true});
   if(!await target.isVisible()){
    const group=['System structure','Maintenance'].includes(name)?'Devices':['Products','Categories','Receive / Issue','Transaction history'].includes(name)?'Inventory':['Users','Roles & permissions'].includes(name)?'Access':name==='System settings'?'Configuration':['Environment overview','Sensors','Environmental alerts','Measurement history'].includes(name)?'Environment':'Monitoring';
    await navigation.getByRole('button',{name:group,exact:true}).click();
   }
   await target.click();
  };

  const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:'Quick actions',exact:true}).waitFor();
  assert.equal(await page.locator('.operational-metrics article').count(),7);
  for(const name of ['Products','Categories','Receive / Issue','Transaction history','System structure','Maintenance','Environment overview','Sensors','Environmental alerts','Measurement history','Alerts & incidents','Data synchronization','Activity log','Users','Roles & permissions','System settings']) {
   await nav(name);await page.waitForTimeout(220);
   for(const [width,height] of [[1366,768],[1920,1080],[390,844]]){await page.setViewportSize({width,height});await noOverflow();}
   await page.setViewportSize({width:1366,height:768});
  }
  await nav('Transaction history');await page.getByRole('cell',{name:'Bearing',exact:true}).first().waitFor();
  assert.equal(await page.locator('tbody tr').count(),5);assert.equal(await page.locator('form').count(),0);
  await page.getByRole('button',{name:'Details',exact:true}).first().click();let drawer=page.getByRole('dialog');await drawer.waitFor();assert.equal(await drawer.locator('details[open]').count(),0);await drawer.getByRole('button',{name:'Close \u00d7',exact:true}).click();
  await nav('Activity log');assert.equal(await page.getByRole('columnheader',{name:/before|after/}).count(),0);await page.getByRole('button',{name:'Details',exact:true}).first().click();drawer=page.getByRole('dialog');await drawer.locator('summary').click();assert((await drawer.innerText()).includes('Old'));await drawer.getByRole('button',{name:'Close \u00d7',exact:true}).click();
  await nav('Sensors');await page.getByRole('button',{name:'Temperature',exact:true}).first().click();drawer=page.getByRole('dialog');await drawer.locator('svg.measurement-chart').waitFor();assert.equal(await drawer.locator('details[open]').count(),0);await drawer.getByRole('button',{name:'Close \u00d7',exact:true}).click();
  await nav('Measurement history');await page.locator('svg.measurement-chart').waitFor();await page.getByRole('combobox',{name:'Metric',exact:true}).selectOption('humidity');assert((await page.locator('svg.measurement-chart').getAttribute('aria-label')).startsWith('humidity'));assert.equal(await page.locator('tbody tr:visible').count(),0);
  await nav('Users');assert.equal(await page.locator('form').count(),0);await page.getByRole('button',{name:'Operator',exact:true}).click();drawer=page.getByRole('dialog');assert.equal(await drawer.locator('form').count(),0);await drawer.getByRole('button',{name:'Edit',exact:true}).click();await drawer.locator('select[name=is_active]').selectOption('false');await drawer.getByRole('button',{name:'Save',exact:true}).click();await page.waitForTimeout(200);assert(writes.some(row=>row.name==='users'&&row.method==='PATCH'&&row.body.id===1&&row.body.is_active===false));await drawer.getByRole('button',{name:'Close \u00d7',exact:true}).click();
  await nav('Roles & permissions');assert.equal(await page.locator('form').count(),0);await page.getByRole('button',{name:'Operator',exact:true}).click();drawer=page.getByRole('dialog');await drawer.getByRole('button',{name:'Edit',exact:true}).click();await drawer.getByLabel('Inventory \u00b7 View', {exact:true}).selectOption('SIMULATION');await drawer.getByRole('button',{name:'Save role',exact:true}).click();await page.waitForTimeout(200);assert(writes.some(row=>row.name==='roles'&&row.body.permissions.some(grant=>grant.permission==='inventory.view'&&grant.scope==='SIMULATION')));await drawer.getByRole('button',{name:'Close \u00d7',exact:true}).click();
  await nav('System settings');await page.getByLabel('Maximum temperature', {exact:true}).fill('45');await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForTimeout(200);assert(writes.some(row=>row.name==='settings'&&row.body.key==='temperature_max'&&row.body.value===45));await page.getByRole('tab',{name:'Technical connections',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Save',exact:true}).count(),0);
  assert.deepEqual(failures,[]);console.log('PASS: all business pages responsive, five-row paging, read-only journal, audit/sensor drawers, metric chart, explicit user/role editors and unchanged mutation payloads, settings validation/support boundaries. Isolated fixtures.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
