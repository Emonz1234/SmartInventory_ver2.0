const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

(async () => {
  const python = spawn(process.env.TEST_PYTHON || '.tools/cleanup-python/python.exe', ['-u','tests/ipcsim_inventory_harness.py'], { windowsHide:true });
  const requests=[];let diagnostics='';
  python.stderr.on('data',chunk=>diagnostics+=chunk);
  readline.createInterface({input:python.stdout}).on('line',line=>{const result=JSON.parse(line), request=requests.shift(); result.error?request.reject(new Error(result.error)):request.resolve(result);});
  python.on('exit',code=>{while(requests.length)requests.shift().reject(new Error(`Harness exited ${code}: ${diagnostics}`));});
  const call=data=>new Promise((resolve,reject)=>{requests.push({resolve,reject});python.stdin.write(JSON.stringify(data)+'\n');});
  const dist=path.resolve('IPCSIM/frontend/dist');
  const server=http.createServer((request,response)=>{
    let file=path.resolve(dist,new URL(request.url,'http://localhost').pathname.replace(/^\/ui\/?/,''));
    if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(dist,'index.html');
    response.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');response.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    let data=await call({operation:'STATE'}),lastTid;
    const writes=[],errors=[];
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',error=>errors.push(String(error)));
    await page.addInitScript(()=>{localStorage.setItem('smartInventory.language','en');localStorage.setItem('token','test');localStorage.setItem('edgeOperatorSession','test');});
    let connectionDown=false, partialDisconnect=true;
    const health=()=>({device_type:'IPCSIM',serial_connected:!connectionDown,simulation_online:!connectionDown,simulation_states:data.states.map(state=>connectionDown?{...state,online:false,system_state:'COMMUNICATION_LOST'}:partialDisconnect&&state.cabinet_index===2?{...state,online:false,system_state:'COMMUNICATION_LOST',fault_context:{error_code:'COMMUNICATION_LOST'}}:state),local_operation_available:!connectionDown});
    await page.route('**/api/**',async route=>{
      const request=route.request(),pathname=new URL(request.url()).pathname;let json={};
      if(pathname.endsWith('/operator/session'))json={username:'Operator',permissions:['inventory.move','cabinet.control']};
      else if(pathname.endsWith('/system/health'))json=health();
      else if(pathname.endsWith('/device/snapshot'))json={records:data.records,health:health()};
      else if(pathname.endsWith('/cabinets'))json=data.records.filter(r=>r.kind==='cabinet').map(r=>({...r.data,status:connectionDown||partialDisconnect&&r.data.cabinet_index===2?'INACTIVE':'ACTIVE',mechanical:health().simulation_states.find(state=>state.cabinet_index===r.data.cabinet_index)}));
      else if(/\/cabinets\/\d+\/racks$/.test(pathname))json=data.records.filter(r=>r.kind==='rack'&&r.data.cabinet_id===Number(pathname.match(/cabinets\/(\d+)/)[1])).map(r=>r.data);
      else if(pathname.endsWith('/operator/operations')) {
        if(request.method()==='POST') {
          const body=request.postDataJSON();writes.push(body);data=await call({operation:'START',body});json=data.operations.find(r=>r.request_key===body.request_key);lastTid=json.id;
        } else json=data.operations;
      } else if(/\/operations\/[^/]+\/(confirm|finish)$/.test(pathname)) {
        const [,id,action]=pathname.match(/operations\/([^/]+)\/(confirm|finish)$/);writes.push({action,id});
        data=await call({operation:action==='confirm'?'CONFIRM':'FINISH',id,body:request.postDataJSON()});json=data.operations.find(r=>r.id===id);
      } else if(pathname.endsWith('/simulation-recovery')) {
        writes.push({action:'recovery'});data=await call({operation:'RECOVER',body:request.postDataJSON()});json={request_id:'test-recovery'};
      }
      await route.fulfill({json});
    });
    const url=`http://127.0.0.1:${server.address().port}/ui/inventory`;
    const modal=page.locator('.inventory-operation-dialog [role="dialog"]');
    const fault=page.getByRole('dialog',{name:/Operation interrupted|Fault resolved/});
    const stock=address=>data.records.find(r=>r.kind==='stock'&&r.data.bin_id===address).data.quantity;
    const row=()=>data.operations.find(r=>r.id===lastTid);
    const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await page.waitForTimeout(50);}throw new Error('Expected request/state missing');};
    async function start(kind='PICK',address=3,quantity=1) {
      data=await call({operation:'STATE'});
      await page.getByRole('row').filter({hasText:'Test part'}).getByRole('button').click();
      await page.getByRole('button',{name:kind==='PICK'?'Pick stock · PICK':'Put stock · PUT',exact:true}).click();
      await modal.locator('input[type="number"]').fill(String(quantity));
      if(address!==null) {
        await modal.getByRole('combobox',{name:'Operation location'}).click();
        await page.getByRole('option').filter({hasText:new RegExp(` / B${address} ·`)}).click();
      }
      await modal.getByRole('button',{name:'View plan',exact:true}).click();
      const before=writes.length;
      await modal.getByRole('button',{name:/^Start/}).evaluate(button=>{button.click();button.click();});
      await wait(()=>writes.length>before);
      await wait(()=>data.operations.some(row=>row.request_key===writes.at(-1).request_key));
      partialDisconnect=false;
    }
    async function confirm() {
      await modal.getByText('Have you picked the goods from this rack?',{exact:true}).or(modal.getByText('Have you placed the goods into this rack?',{exact:true})).waitFor();
      await modal.getByRole('textbox',{name:'Confirmation note'}).fill('Physical quantity verified');
      const before=writes.filter(w=>w.action==='confirm').length;
      await modal.getByRole('button',{name:'Confirm physical Pick / Put',exact:true}).evaluate(button=>{button.click();button.click();button.click();});
      await modal.getByRole('button',{name:'Keep Cabinet Open',exact:true}).waitFor();
      assert.equal(writes.filter(w=>w.action==='confirm').length,before+1);
      assert.equal(row().operation_confirmed,1);assert.equal(row().inventory_applied,1);
    }
    async function finish(keep=false) {
      const before=writes.filter(w=>w.action==='finish').length;
      await modal.getByRole('button',{name:keep?'Keep Cabinet Open':'Close Cabinet',exact:true}).evaluate(button=>{button.click();button.click();});
      await wait(()=>writes.filter(w=>w.action==='finish').length>before);
      assert.equal(writes.filter(w=>w.action==='finish').length,before+1);
      if(!keep)data=await call({operation:'COMPLETE'});
      await modal.getByText(keep?'Transaction completed. Cabinet remains OPEN / ACTIVE.':'Transaction completed. Cabinet is closed.',{exact:true}).waitFor();
      await modal.getByRole('button',{name:'Close',exact:true}).click();
    }
    await page.goto(url);
    await start();assert.equal(stock(3),10);
    data=await call({operation:'COMPLETE'});await confirm();assert.equal(stock(3),9);
    fs.mkdirSync('test-results/ipcsim-inventory',{recursive:true});
    await page.screenshot({path:'test-results/ipcsim-inventory/confirmed.png',fullPage:true});
    await finish(true);
    const count=data.commands.filter(c=>c.operation==='EXECUTE').length;
    await start('PUT');await confirm();assert.equal(stock(3),10);
    assert.equal(data.commands.filter(c=>c.operation==='EXECUTE').length,count,'Same rack skips OPEN');
    await finish(true);
    await start('PICK',9);
    assert.equal(data.commands.at(-1).action,'HOME');assert.equal(data.commands.at(-1).cabinet_index,1);
    data=await call({operation:'COMPLETE'});await confirm();await finish(false);
    // Refresh before confirmation restores the actual journal and never resends OPEN.
    await start();data=await call({operation:'COMPLETE'});
    const beforeRefresh=data.commands.length;
    await page.reload();await confirm();assert.equal(data.commands.length,beforeRefresh);
    await page.reload();await modal.getByRole('button',{name:'Close Cabinet',exact:true}).waitFor();
    assert.equal(await modal.getByRole('button',{name:'Confirm physical Pick / Put',exact:true}).count(),0);
    const confirmedQty=stock(3);
    await modal.getByRole('button',{name:'Close Cabinet',exact:true}).click();
    await wait(()=>row().phase==='HOME');
    data=await call({operation:'FAULT'});await fault.waitFor();
    await modal.waitFor({state:'hidden'});
    assert.equal(await modal.count(),0,'Inventory dialog yields to recovery modal');
    data=await call({operation:'CLEAR'});await fault.getByText('READY',{exact:true}).waitFor();
    await fault.getByRole('button',{name:'Continue operation',exact:true}).click();
    await fault.waitFor({state:'hidden'});data=await call({operation:'COMPLETE'});
    await modal.getByText('Transaction completed. Cabinet is closed.',{exact:true}).waitFor();
    assert.equal(stock(3),confirmedQty,'Closing recovery cannot repeat Pick or inventory update');
    await modal.getByRole('button',{name:'Close',exact:true}).click();
    await start('PICK',null,12);data=await call({operation:'COMPLETE'});
    await page.reload();await confirm();
    await modal.getByRole('button',{name:'Keep Cabinet Open',exact:true}).click();
    await modal.getByRole('button',{name:'Next transaction',exact:true}).waitFor();
    assert.equal(row().quantity,10,'The first quantity in a multi-location plan is retained');
    await modal.getByRole('button',{name:'Next transaction',exact:true}).click();
    await wait(()=>row().quantity===2);
    data=await call({operation:'COMPLETE'});await confirm();await finish(false);
    const writesBeforeConnection= writes.length;
    connectionDown=true;
    const connection=page.getByRole('dialog').filter({has:page.locator('#simulation-connection-title')});
    await connection.getByText('Simulation connection lost',{exact:true}).waitFor();
    assert.equal(await connection.getByRole('button').count(),0);
    await page.waitForFunction(()=>document.querySelector('table[aria-label="Inventory products"] tbody tr')?.getAttribute('aria-disabled')==='true');
    connectionDown=false;
    await connection.waitFor({state:'hidden'});
    connectionDown=true;
    await connection.getByText('Simulation connection lost',{exact:true}).waitFor();
    connectionDown=false;
    await connection.waitFor({state:'hidden'});
    assert.equal(writes.length,writesBeforeConnection,'Connection acknowledgement never sends hardware commands');
    data.records.find(record=>record.kind==='item').data.is_active=false;
    await page.waitForFunction(()=>document.querySelector('table[aria-label="Inventory products"] tbody tr')?.getAttribute('aria-disabled')==='true');
    data.records.find(record=>record.kind==='item').data.is_active=true;
    await page.waitForFunction(()=>document.querySelector('table[aria-label="Inventory products"] tbody tr')?.getAttribute('aria-disabled')==='false');
    await start('PUT',3);
    data=await call({operation:'DISCONNECT'});
    assert.equal(await connection.count(),0,'Other connected cabinet prevents a global warning');
    const resumeCount=data.commands.filter(command=>command.operation==='RESUME').length;
    data=await call({operation:'RECONNECT'});
    await fault.getByText('READY',{exact:true}).waitFor();
    assert.equal(data.commands.filter(command=>command.operation==='RESUME').length,resumeCount,'Reconnection alone never resumes');
    await fault.getByRole('button',{name:'Continue operation',exact:true}).evaluate(button=>{button.click();button.click();});
    await fault.waitFor({state:'hidden'});
    assert.equal(data.commands.filter(command=>command.operation==='RESUME').length,resumeCount+1);
    data=await call({operation:'COMPLETE'});await confirm();await finish(false);

    assert.deepEqual(errors,[]);
    console.log('PASS: real Pick/Put, confirmation/double-click, Keep Open, cabinet switch, refresh, close recovery and exactly-once inventory');
  } finally {
    if(browser)await browser.close();python.stdin.end();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
