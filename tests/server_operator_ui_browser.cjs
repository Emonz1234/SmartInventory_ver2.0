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
  const nav=async name=>{
   if(await page.locator('.topbar-toggle').isVisible() && await page.locator('#server-navigation').isHidden())await page.locator('.topbar-toggle').click();
   const target=page.locator('nav button').getByText(name,{exact:true});
   if(!await target.isVisible()){
    const group=['IPC','Cabinets','Racks'].includes(name)?'Devices':['Products','Warehouse overview','Categories','Receive / Issue','Storage map','Transaction history'].includes(name)?'Inventory':['Users','Permissions','Settings'].includes(name)?'Administration':'Monitoring';
    await page.locator('.nav-group-trigger').getByText(group,{exact:true}).click();
   }
   await target.click();
  };
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  fs.mkdirSync('test-results/server-operator',{recursive:true});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:'Quick actions',exact:true}).waitFor();
  await page.screenshot({path:'test-results/server-operator/dashboard.png',fullPage:true});await noOverflow();
  operations=[{id:'pending-1',device_id:'IPC01',rack_id:1,kind:'PUT',quantity:2,state:'sent',execution_state:'completed',source_type:'REAL',created_at:'2026-10-06T08:00:00Z'}];
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.locator('.attention-list').getByText('Command ID: pending-1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Review operation',exact:true}).click();
  await page.getByRole('heading',{name:'Confirm result #pending-1'}).waitFor();
  operations=[];await nav('Overview');

  assert.equal(await page.locator('nav .nav-submenu').count(),0);
  assert.equal(await page.locator('aside .language-selector').count(),0);
  await page.locator('.nav-group-trigger').getByText('Devices',{exact:true}).click();
  assert.equal(await page.locator('nav .nav-submenu button').count(),3);
  await nav('IPC');assert.equal(await page.locator('nav button[aria-current="page"]').innerText(),'IPC');
  await page.locator('.topbar-toggle').click();assert(await page.locator('.shell').evaluate(e=>e.classList.contains('collapsed')));
  await nav('Racks');await noOverflow();await page.screenshot({path:'test-results/server-operator/navigation-collapsed.png'});
  await page.locator('.topbar-toggle').click();
  await page.getByRole('button',{name:'User menu',exact:true}).click();await page.getByRole('button',{name:'Account information',exact:true}).click();
  await page.locator('.account-dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Active alerts',exact:true}).click();await page.locator('.notification-menu button').first().click();await page.getByRole('heading',{name:'Alerts',exact:true,level:1}).waitFor();
  await nav('Overview');

  await page.getByRole('button',{name:'Review alert',exact:true}).click();await page.getByRole('heading',{name:'Alerts',exact:true,level:1}).waitFor();
  for(const name of ['IPC','Cabinets','Racks','Synchronization','Environment','Alerts','Products','Storage map','Transaction history','System logs','Users','Permissions','Settings']){
   await nav(name);try{await page.getByRole('heading',{name,exact:true,level:1}).waitFor();}catch(error){console.error(await page.locator('body').innerText());console.error(failures);throw error;}await noOverflow();
  }
  await nav('Warehouse overview');try{await page.getByRole('button',{name:/Browse products/}).waitFor();}catch(e){console.error(failures,await page.locator('body').innerText());throw e;}
  await nav('Categories');await page.getByRole('button',{name:'+ Add category',exact:true}).click();
  await page.getByLabel('Category name *',{exact:true}).fill('Workshop');await page.getByLabel('Category code',{exact:true}).fill('WORK');await page.getByRole('button',{name:'Save category',exact:true}).click();
  const categoryRow=page.getByRole('row').filter({hasText:'Workshop'});await categoryRow.waitFor();await categoryRow.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Category name *',{exact:true}).fill('Workshop tools');await page.getByRole('button',{name:'Save category',exact:true}).click();
  await page.getByRole('row').filter({hasText:'Workshop tools'}).getByRole('button',{name:'Deactivate',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('row').filter({hasText:'Workshop tools'}).getByText('Inactive',{exact:true}).waitFor();await page.screenshot({path:'test-results/server-operator/catalog-categories.png',fullPage:true});
  await nav('Products');await page.getByRole('button',{name:'+ Add product',exact:true}).click();
  await page.getByLabel('Product name *',{exact:true}).fill('Test catalog product');await page.getByLabel('SKU *',{exact:true}).fill('CAT-TEST');
  await page.getByRole('button',{name:'+ Create category',exact:true}).click();await page.getByLabel('Category name *',{exact:true}).fill('Inline category');await page.getByRole('button',{name:'Save category',exact:true}).click();
  assert.equal(await page.getByLabel('Product name *',{exact:true}).inputValue(),'Test catalog product');assert.notEqual(await page.getByLabel('Category *',{exact:true}).inputValue(),'');await page.screenshot({path:'test-results/server-operator/catalog-product-form.png',fullPage:true});
  await page.getByRole('button',{name:'Save product',exact:true}).click();await page.getByTestId('product-CAT-TEST-REAL').waitFor();
  await page.getByRole('button',{name:'+ Add product',exact:true}).click();await page.getByRole('button',{name:'Save product',exact:true}).click();await page.getByText('Complete this required field.',{exact:true}).first().waitFor();
  await page.getByLabel('Product name *',{exact:true}).fill('Duplicate');await page.getByLabel('SKU *',{exact:true}).fill('CAT-TEST');await page.getByLabel('Category *',{exact:true}).selectOption('1');await page.getByRole('button',{name:'Save product',exact:true}).click();await page.getByText('This SKU already exists. Use a different SKU.',{exact:true}).waitFor();await page.getByRole('button',{name:'+ Add product',exact:true}).click();

  await page.locator('.catalog-bulk').getByText('Select multiple products',{exact:true}).first().click();await page.locator('.catalog-selection').getByLabel('Test catalog product · CAT-TEST').check();
  await page.getByRole('button',{name:'Deactivate',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByTestId('product-CAT-TEST-REAL').waitFor({state:'hidden'});
  await page.getByLabel('Product status',{exact:true}).selectOption('inactive');await page.getByTestId('product-CAT-TEST-REAL').waitFor();await page.getByLabel('Product status',{exact:true}).selectOption('active');
  await nav('IPC');await page.getByRole('button',{name:'Warehouse IPC',exact:true}).click();const detail=page.getByRole('dialog',{name:'Warehouse IPC'});await detail.waitFor();assert.equal(await detail.locator('details.technical-details[open]').count(),0);await detail.getByRole('button',{name:'Close ×',exact:true}).click();
  await nav('Products');await page.getByTestId('product-BR-01-REAL').waitFor();await page.getByRole('button',{name:'Bearing',exact:true}).click();const drawer=page.getByRole('dialog',{name:'Bearing'});await drawer.waitFor();assert.equal(await drawer.evaluate(el=>el.matches(':modal')),false);await drawer.getByRole('button',{name:'Close details',exact:true}).click();
  await page.locator('.source-filter select').selectOption('ALL');await page.getByTestId('product-BR-01-SIMULATION').waitFor();assert.equal(await page.locator('.inv-product-row').first().getAttribute('data-testid'),'product-BR-01-REAL');await page.getByTestId('product-BR-01-SIMULATION').getByRole('button',{name:'Issue stock',exact:true}).click();await page.locator('.stock-wizard').getByLabel('Product',{exact:true}).waitFor();assert.equal(await page.locator('.stock-wizard').getByLabel('Product',{exact:true}).inputValue(),'1:SIMULATION');await page.locator('.source-filter select').selectOption('REAL');await nav('Products');await page.getByRole('button',{name:'Bearing',exact:true}).click();await page.screenshot({path:'test-results/server-operator/product-drawer.png'});await page.getByRole('dialog',{name:'Bearing'}).getByRole('button',{name:'Close details',exact:true}).click();
  await nav('Receive / Issue');let wizard=page.locator('.stock-wizard');await wizard.getByLabel('Product',{exact:true}).selectOption('1:REAL');await wizard.getByRole('button',{name:'Continue',exact:true}).click();await wizard.getByLabel('Quantity',{exact:true}).fill('2');await wizard.getByRole('button',{name:'Continue',exact:true}).click();await wizard.getByLabel('Transaction location',{exact:true}).selectOption('1');await wizard.getByRole('button',{name:'Continue',exact:true}).click();
  await wizard.getByRole('button',{name:'Send to IPC',exact:true}).evaluate(button=>{button.click();button.click();});await wizard.getByText('Moving',{exact:true}).waitFor();assert.equal(writes.filter(r=>r.name==='operations').length,1);assert.equal(await wizard.getByRole('button',{name:'Confirm completed transaction'}).count(),0);
  operations[0].execution_state='fault';await wizard.getByText('Device fault',{exact:true}).waitFor();assert.equal(await wizard.getByRole('button',{name:'Confirm completed transaction'}).count(),0);
  // A refresh preserves command ID and quantity; no second hardware request.
  await page.reload();await page.getByRole('heading',{name:'Quick actions',exact:true}).waitFor();await nav('Receive / Issue');wizard=page.locator('.stock-wizard');await wizard.getByText('Device fault',{exact:true}).waitFor();assert.equal(writes.filter(r=>r.name==='operations').length,1);
  operations[0].execution_state='completed';await wizard.getByLabel('I counted the goods and completed the physical operation').check();await wizard.getByLabel('Record the actual outcome').fill('Counted two units and received them into A01');
  await wizard.getByRole('button',{name:'Confirm completed transaction',exact:true}).evaluate(button=>{button.click();button.click();});const success=page.getByRole('dialog',{name:'Transaction completed'});await success.getByRole('heading',{name:'Stock received'}).waitFor();assert.equal(writes.filter(r=>r.name.endsWith('/confirm')).length,1);await page.screenshot({path:'test-results/server-operator/receive-success.png'});await success.getByRole('button',{name:'Done',exact:true}).click();
  await nav('Receive / Issue');wizard=page.locator('.stock-wizard');await wizard.getByRole('button',{name:'Issue stock',exact:true}).click();await wizard.getByLabel('Product',{exact:true}).selectOption('1:REAL');await wizard.getByRole('button',{name:'Continue',exact:true}).click();await wizard.getByLabel('Quantity',{exact:true}).fill('3');await wizard.getByRole('button',{name:'Continue',exact:true}).click();await wizard.getByLabel('Transaction location',{exact:true}).selectOption('1');await wizard.getByRole('button',{name:'Continue',exact:true}).click();await wizard.getByRole('button',{name:'Send to IPC',exact:true}).click();await wizard.getByText('Moving',{exact:true}).waitFor();assert.equal(writes.filter(r=>r.name==='operations').length,2);
  operations[0].execution_state='completed';await wizard.getByLabel('I counted the goods and completed the physical operation').check();await wizard.getByLabel('Record the actual outcome').fill('Issued and counted three units');await wizard.getByRole('button',{name:'Confirm completed transaction',exact:true}).click();await page.getByRole('heading',{name:'Stock issued',exact:true}).waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();assert.equal(writes.filter(r=>r.name.endsWith('/confirm')).length,2);
  await nav('Overview');apiFailure=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('[role="alert"]').first().waitFor();assert.equal(await page.getByText('No warnings in your accessible data',{exact:true}).count(),0);apiFailure=false;
  await page.reload();await page.getByRole('heading',{name:'Quick actions',exact:true}).waitFor();
  for(const size of [{width:1920,height:1080},{width:1280,height:720},{width:768,height:1024}]){await page.setViewportSize(size);await noOverflow();}
  grants={'inventory.view':['REAL']};const previousReads=reads.length;await page.reload();await page.getByRole('heading',{name:'Products',exact:true,level:1}).waitFor();assert.equal(await page.locator('nav .nav-group-trigger').count(),1);assert.equal(await page.locator('nav .nav-submenu button').count(),5);assert(!reads.slice(previousReads).some(name=>['ipcs','rack-status','alarms','dashboard'].includes(name)));assert.equal(await page.getByRole('button',{name:'Receive stock',exact:true}).count(),0);
  await page.locator('.source-filter select').selectOption('SIMULATION');assert.equal(await page.locator('.inv-product-row').count(),0);assert.equal(await page.locator('.stock-wizard').count(),0);
  grants=Object.fromEntries(permissions.map(p=>[p,['ALL']]));await page.evaluate(()=>localStorage.setItem('smartInventory.language','vi'));await page.reload();await page.getByRole('heading',{name:'Tổng quan',exact:true,level:1}).waitFor();await page.getByRole('heading',{name:'Thao tác nhanh',exact:true}).waitFor();await noOverflow();await page.screenshot({path:'test-results/server-operator/dashboard-vi.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await noOverflow();
  await page.locator('.topbar-toggle').click();await page.locator('#server-navigation').waitFor();
  assert.equal(await page.locator('.operator-topbar').evaluate(el=>el.scrollHeight>el.clientHeight),false);
  assert.equal(await page.locator('#server-navigation').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.screenshot({path:'test-results/server-operator/navigation-mobile.png'});
  await page.locator('nav button').getByText('Tổng quan',{exact:true}).click();assert(await page.locator('#server-navigation').isHidden());
  await page.locator('.topbar-actions .language-trigger').click();await page.getByRole('menuitemradio',{name:'English'}).click();
  await page.getByRole('heading',{name:'Overview',exact:true,level:1}).waitFor();
  await page.getByRole('button',{name:'User menu',exact:true}).click();await page.getByRole('button',{name:'Logout',exact:true}).click();
  await page.locator('.login').waitFor();assert.equal(writes.filter(r=>r.name==='session'&&r.method==='DELETE').length,1);
  assert.deepEqual(failures,[]);console.log('PASS: all Server pages, actionable dashboard, drawers, permissions, responsive layouts and durable PUT wizard with real API contracts, fault gate and duplicate protection. API fixtures only.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
