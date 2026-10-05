const assert=require('node:assert/strict');
const {chromium}=require('../.tools/ui/node_modules/playwright');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage();const failures=[];page.on('pageerror',e=>failures.push(e.message));
 let operations=[],commands=0,serial=true;
 await page.addInitScript(()=>localStorage.setItem('smartInventory.language','en'));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());if(!url.pathname.startsWith('/api/'))return route.continue();
  const name=url.pathname.slice(5);let json=[];
  if(name==='session')json={authenticated:true,username:'UI test',grants:Object.fromEntries(['dashboard.view','cabinet.view','cabinet.control'].map(k=>[k,['ALL']]))};
  else if(name==='dashboard')json={online:1,ipcs:1,cabinet_groups:1,racks:6};
  else if(name==='rack-status')json=[{id:3,name:'Rack 3',cabinet:'Cabinet 1',ipc_id:'test-sim',source_type:'SIMULATION',online:true,serial_connected:serial,synchronized:true,configuration_status:'configured',address:3}];
  else if(name==='operations')json=operations;
  else if(name==='racks/3/commands'){
   commands++;assert.equal(req.postDataJSON().command,'OPEN');
   operations=[{id:'test-command',device_id:'test-sim',rack_id:3,kind:'OPEN',state:'queued',execution_state:'awaiting_device',source_type:'SIMULATION'}];json={id:'test-command',state:'queued'};
  }
  await route.fulfill({json});
 });
 await page.goto(process.env.SERVER_UI_URL || 'http://127.0.0.1:3310/');await page.locator('nav button').filter({hasText:'Cabinets'}).click();
 await page.getByRole('button',{name:'Rack 3',exact:true}).click();
 const open=page.getByRole('button',{name:'Open',exact:true});await open.click();await page.getByRole('button',{name:'Confirm',exact:true}).click();
 await page.getByText(/Waiting for actual device feedback/).waitFor();assert.equal(commands,1);assert(await open.isDisabled());
 assert.equal(await page.getByText(/Device confirmed completion/).count(),0);
 operations=[{...operations[0],state:'sent',execution_state:'completed'}];await page.getByText(/Device confirmed completion/).waitFor();assert(await open.isDisabled());
 operations=[{...operations[0],state:'uncertain',execution_state:'timeout'}];await page.getByText(/Response timeout/).waitFor();assert.equal(commands,1);
 serial=false;operations=[];await page.reload();await page.locator('nav button').filter({hasText:'Cabinets'}).click();await page.getByRole('button',{name:'Rack 3',exact:true}).click();
 await page.getByText(/Serial is disconnected from Simulation/).waitFor();assert(await page.getByRole('button',{name:'Open',exact:true}).isDisabled());assert.equal(commands,1);
 assert.deepEqual(failures,[]);console.log('PASS: actual Server buttons/payload, waiting vs device completion, pending duplicate guard, timeout and disconnected Serial notice. UI uses mocked API only.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
