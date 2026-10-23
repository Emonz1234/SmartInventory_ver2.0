// Uses mocked HTTP/telemetry only. No physical device or production database is accessed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('../.tools/ui/node_modules/playwright');
const viChars=/[\p{Script=Latin}&&[^\x00-\x7f]]/v;
const grants=Object.fromEntries(['dashboard.view','ipc.view','cabinet.view','environment.view','alarm.view','inventory.view','audit.view','user.view','user.manage','role.manage','system.manage','inventory.create','inventory.move','inventory.adjust','cabinet.control'].map(key=>[key,['ALL']]));
const health={device_id:'SIM-TEST',device_type:'IPCSIM',serial_connected:true,simulation_online:true,server_online:true,server_synced:true,database_healthy:true,local_operation_available:true,hardware_status:'READY',pending_transactions:0};
const racks=Array.from({length:6},(_,i)=>({id:i+1,rack_code:'R'+(i+1),rack_index:i+1,cabinet_id:1,cabinet_index:1,status:'READY'}));
const location={id:1,source_type:'REAL',ipc_id:'IPC1',cabinet_id:1,cabinet:'Original Cabinet',rack_id:1,rack_index:1,rack:'R1',path:'IPC1/CB1/R1',location_code:'B1',shelf:'S1',quantity:5,available_quantity:5,occupied_quantity:5,capacity:20,status:'AVAILABLE',sync_status:'Synced',goods:[{item_id:1,name:'Dashboard',quantity:5}]};
const product={id:1,name:'Dashboard',sku:'ORIGINAL',category:'Active',unit:'pcs',source_type:'REAL',quantity:5,available_quantity:5,min_stock:1,max_stock:20,stock_status:'Normal',sync_status:'Synced',locations:[location]};
async function language(page,lang){
 const trigger=page.locator('.language-trigger').last();
 assert.equal(await trigger.isVisible(),true);
 await trigger.click();
 const menu=page.getByRole('menu');
 await menu.waitFor();
 const checked=menu.locator('[aria-checked="true"]');
 assert.equal(await checked.count(),1);
 assert((await checked.innerText()).includes('\u2713'));
 await page.keyboard.press('Escape');
 assert.equal(await menu.count(),0);
 assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
 await trigger.click();await page.locator('body').dispatchEvent('pointerdown');assert.equal(await menu.count(),0);
 await trigger.click();await page.getByRole('menuitemradio',{name:lang==='vi'?'Ti\u1ebfng Vi\u1ec7t':'English'}).click();
 assert.equal(await menu.count(),0);
 await page.waitForTimeout(80);assert.equal(await page.locator('html').getAttribute('lang'),lang);
 const server=page.url().includes(':3310');
 assert.equal(await page.title(),server?(lang==='vi'?'Smart Inventory \u00b7 Trung t\u00e2m \u0111i\u1ec1u khi\u1ec3n':'Smart Inventory \u00b7 Control Center'):(lang==='vi'?'IPCSIM \u00b7 M\u00f4 ph\u1ecfng':'IPCSIM Simulation'));
}
async function english(page,name){const text=(await page.locator('body').innerText()).replaceAll('Tiếng Việt','');assert.equal(viChars.test(text),false,`${name} has untranslated Vietnamese: ${text}`);}
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const failures=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>failures.push(error.message));
  let serverAuth=false;
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),key=url.pathname.slice(5);let data=[];
   if(key==='session'){if(route.request().method()==='POST')serverAuth=true;data={authenticated:serverAuth,username:'Original User',grants};}
   else if(key==='permissions')data=['inventory.view'];
   else if(key==='inventory-overview')data={products:[product],locations:[location],devices:[],transactions:[],categories:[],summary:{}};
   else if(key==='dashboard')data={};
   await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:3310');
  await page.getByRole('heading',{name:'Đăng nhập',exact:true}).waitFor();
  await page.locator('input[name=username]').fill('Original User');
  await page.locator('input[name=password]').fill('kept-secret');
  await language(page,'en');
  assert.equal(await page.locator('input[name=username]').inputValue(),'Original User');
  assert.equal(await page.locator('input[name=password]').inputValue(),'kept-secret');
  await english(page,'Server login');
  await page.reload();await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
  await page.locator('input[name=username]').fill('Original User');await page.locator('input[name=password]').fill('secret');
  await page.locator('button[type=submit]').click();await page.locator('.shell').waitFor();
  for(const label of ['Dashboard','IPC devices','Cabinets','Environment','Alarms','Inventory','Storage map','Transactions','Audit logs','Users','Roles & permissions','Settings']){
   await page.locator('nav button').filter({hasText:label}).click();await page.waitForTimeout(150);await english(page,'Server '+label);console.log('Checked Server: '+label);
   await language(page,'vi');await language(page,'en');
  }
  await page.locator('nav button').filter({hasText:'Inventory'}).click();
  await page.locator('.inv-product-row button').first().click();await english(page,'Server product details');
  await page.getByRole('button',{name:'Inventory adjustment',exact:true}).click();
  await page.locator('.inv-drawer input[type=number]').fill('8');await page.locator('.inv-drawer textarea').last().fill('Original user note');
  await language(page,'vi');assert.equal(await page.locator('.inv-drawer input[type=number]').inputValue(),'8');assert.equal(await page.locator('.inv-drawer textarea').last().inputValue(),'Original user note');assert.equal(await page.locator('.inv-drawer h2').innerText(),'Dashboard');
  await language(page,'en');await page.getByRole('button',{name:'Close details',exact:true}).click();
  await page.locator('nav button').filter({hasText:'Roles & permissions'}).click();
  await page.locator('section form input').fill('Dashboard');
  await language(page,'vi');assert.equal(await page.locator('section form input').inputValue(),'Dashboard');
  await page.locator('section select').selectOption('REAL');await language(page,'en');assert.equal(await page.locator('section select').inputValue(),'REAL');
  await page.locator('nav button').filter({hasText:'Users'}).click();
  await page.locator('input[name=username]').evaluate(input=>input.reportValidity());assert.equal(await page.locator('input[name=username]').evaluate(input=>input.validationMessage),'Please fill out this field.');
  await language(page,'vi');assert.equal(await page.locator('input[name=username]').evaluate(input=>input.validationMessage),'Vui lòng điền trường này.');
  fs.mkdirSync('.tools/ui/artifacts', {recursive:true});
  await page.locator('.language-trigger').click();
  await page.screenshot({path:'.tools/ui/artifacts/server-language.png'});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  const serverSelector=page.locator('.language-trigger');
  assert(await serverSelector.isVisible());
  const serverBox=await serverSelector.boundingBox();assert(serverBox.x>=0 && serverBox.x+serverBox.width<=390);
  await language(page,'en');await language(page,'vi');
  await page.close();
  const edge=await browser.newPage({viewport:{width:1440,height:1000}});edge.on('pageerror',error=>failures.push(error.message));
  let auth=false;
  let commands=0, telemetry=[], unknownCommand=false;
  await edge.route('**/api/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(!pathname.startsWith('/api/')) return route.continue();
   const key=pathname.slice(5);let data=[];
   if(key==='system/health')data=health;
   else if(key==='operator/login'){auth=true;data={session:'test-session',username:'Original User',permissions:['inventory.move','inventory.add_operation']};}
   else if(key==='operator/session')data={username:'Original User',permissions:['inventory.move','inventory.add_operation']};
   else if(key==='operator/device-commands'){
    commands++;const payload=route.request().postDataJSON();assert.equal(payload.kind,'OPEN');assert.equal(typeof payload.rack_id,'number');assert.equal(typeof payload.request_key,'string');
    if(unknownCommand)return route.fulfill({status:409,json:{code:'FW_UNKNOWN_42',detail:'Unregistered firmware wording'}});
    data={state:'local_sent'};
   }
   else if(key==='cabinets')data=[{id:1,cabinet_code:'CB1',cabinet_name:'Original Cabinet',status:'ACTIVE',rack_count:6}];
   else if(key==='cabinets/1/racks')data=racks;
   else if(key==='device/snapshot')data={health,records:[
    {kind:'item',data:{id:1,item_name:'Dashboard',item_code:'ORIGINAL',unit:'pcs',category:'Active',min_qty:1}},
    {kind:'shelf',data:{id:1,rack_id:1,shelf_code:'S1'}},
    {kind:'bin',data:{id:1,shelf_id:1,bin_code:'B1',capacity:20}},
    {kind:'stock',data:{item_id:1,bin_id:1,quantity:5}}
   ],operation_history:[]};
   else if(key==='telemetry/operation')data={data:telemetry};
   else if(key==='telemetry/breakdown')data={data:[{id:1,rack_id:1,is_obstructed:true,is_skewed:true,is_overload_motor:true,created_at:'2026-10-05T00:00:00Z'}]};
   else if(key==='telemetry/environment')data={data:[{id:1,rack_id:1,temperature:26,humidity:65,weight:10,smoke:1,created_at:'2026-10-05T00:00:00Z'}]};
   else if(key.startsWith('telemetry/'))data={data:[]};
   else if(key.includes('dashboard'))data={};
   await route.fulfill({json:data});
  });
  await edge.goto('http://127.0.0.1:3300/ui/');await edge.getByRole('heading',{name:'Đăng nhập vận hành'}).waitFor();
  await edge.getByLabel('Tên đăng nhập').fill('Original User');await edge.getByLabel(/^Mật khẩu/).fill('kept-secret');await edge.getByLabel(/^Edge API token/).fill('test-token');
  await language(edge,'en');assert.equal(await edge.getByLabel(/^Username/).inputValue(),'Original User');assert.equal(await edge.getByLabel(/^Password/).inputValue(),'kept-secret');await english(edge,'IPCSIM login');
  await edge.getByRole('button',{name:'Sign in',exact:true}).click();await edge.getByText('Original User',{exact:true}).first().waitFor();
  for(const route of ['','inventory','cabinets','cabinets/1','transactions','breakdown','environment','operation','system']){
   await edge.goto('http://127.0.0.1:3300/ui/'+route);await edge.getByText('Original User',{exact:true}).first().waitFor();await edge.waitForTimeout(250);await english(edge,'IPCSIM '+route);console.log('Checked IPCSIM: '+route);
   await language(edge,'vi');await language(edge,'en');
  }
  await edge.goto('http://127.0.0.1:3300/ui/inventory');
  await edge.getByRole('button',{name:'View Dashboard',exact:true}).click();await english(edge,'IPCSIM product details');
  await edge.getByRole('button',{name:'Pick stock · PICK',exact:true}).click();
  await edge.getByLabel('Operation quantity',{exact:true}).fill('2');
  await language(edge,'vi');assert.equal(await edge.getByLabel('Số lượng thao tác',{exact:true}).inputValue(),'2');assert.equal(await edge.locator('.inventory-detail-name').innerText(),'Dashboard');
  await language(edge,'en');await edge.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await edge.goto('http://127.0.0.1:3300/ui/cabinets/1');
  await edge.getByRole('button',{name:'Open R3',exact:true}).click();
  await language(edge,'vi');await edge.getByRole('heading',{name:'Xác nhận di chuyển rack'}).waitFor();await language(edge,'en');
  await edge.getByRole('button',{name:'Confirm Open Rack 3',exact:true}).click();
  await edge.getByRole('heading',{name:'Opening Rack 3',exact:true}).waitFor();console.log('Checked active rack operation');assert.equal(commands,1);
  await language(edge,'vi');await edge.getByRole('heading',{name:'Đang mở rack 3',exact:true}).waitFor();await language(edge,'en');assert.equal(commands,1);
  telemetry=[{id:1,rack_id:3,is_endpoint:1,state:-2,displacement:0,movement_speed:0}];
  await edge.getByRole('heading',{name:'Operation needs attention',exact:true}).waitFor();await english(edge,'IPCSIM firmware fault');
  await language(edge,'vi');await edge.getByRole('heading',{name:'Thao tác cần kiểm tra',exact:true}).waitFor();assert.equal(commands,1);
  await language(edge,'en');await edge.getByRole('dialog').getByRole('button',{name:'I checked · reset'}).click();
  unknownCommand=true;telemetry=[];
  await edge.getByRole('button',{name:'Open R4',exact:true}).click();await edge.getByRole('button',{name:'Confirm Open Rack 4',exact:true}).click();
  await edge.getByRole('dialog').getByText(/A system error occurred.*FW_UNKNOWN_42/).waitFor();await language(edge,'vi');await edge.getByRole('dialog').getByText(/Có lỗi hệ thống.*FW_UNKNOWN_42/).waitFor();assert.equal(commands,2);
  await language(edge,'en');await edge.reload();await edge.getByText('Original User',{exact:true}).first().waitFor();assert.equal(await edge.locator('html').getAttribute('lang'),'en');
  await edge.setViewportSize({width:390,height:844});
  const selector=edge.locator('.language-trigger');assert.equal(await selector.isVisible(),true);const box=await selector.boundingBox();assert(box.x>=0 && box.x+box.width<=390);
  await edge.locator('.language-trigger').click();await edge.screenshot({path:'.tools/ui/artifacts/ipcsim-language.png'});await edge.keyboard.press('Escape');
  assert.equal(auth,true);assert.deepEqual(failures,[]);
  console.log('PASS: bilingual Server 12 pages and IPCSIM 9 routes; login/role inputs and option payload preserved; native validation; persisted preference; active movement and confirmation preserved without resending; simulated endpoint faults and unknown firmware/API error fallback; no page errors. Mock HTTP/telemetry only.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
