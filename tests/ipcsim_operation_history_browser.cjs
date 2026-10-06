const {chromium}=require('../.tools/ui/node_modules/playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');const readline=require('node:readline');
(async()=>{
  const python=spawn('.tools/cleanup-python/python.exe',['-u','tests/ipcsim_faults_page_harness.py'],{windowsHide:true});
  const pending=[];let diagnostic='';python.stderr.on('data',chunk=>diagnostic+=chunk);
  readline.createInterface({input:python.stdout}).on('line',line=>{const result=JSON.parse(line),request=pending.shift();result.error?request.reject(new Error(result.error)):request.resolve(result);});
  python.on('exit',code=>{while(pending.length)pending.shift().reject(new Error(`Harness exited ${code}: ${diagnostic}`));});
  const call=body=>new Promise((resolve,reject)=>{pending.push({resolve,reject});python.stdin.write(JSON.stringify(body)+'\n');});
  const dist=path.resolve('IPCSIM/frontend/dist');
  const server=http.createServer((request,response)=>{
    let file=path.resolve(dist,new URL(request.url,'http://localhost').pathname.replace(/^\/ui\/?/,''));
    if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(dist,'index.html');
    response.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');response.end(fs.readFileSync(file));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    let data=await call({operation:'COMMAND',id:'history-open'});const errors=[];
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1500,height:1000}});
    page.on('pageerror',error=>errors.push(String(error)));
    await page.addInitScript(()=>{localStorage.setItem('smartInventory.language','en');localStorage.setItem('token','test');localStorage.setItem('edgeOperatorSession','test');});
    await page.route('**/api/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;let json={};
      if(pathname.endsWith('/operator/session'))json={username:'Operator',permissions:['cabinet.control']};
      else if(pathname.endsWith('/device/snapshot')){data=await call({operation:'OVERVIEW'});json={operation_history:data.operation_history};}
      else if(pathname.endsWith('/system/health'))json={device_type:'IPCSIM',serial_connected:true,simulation_online:true,simulation_states:data.states};
      else if(pathname.endsWith('/cabinets'))json=data.records.filter(record=>record.kind==='cabinet').map(record=>({...record.data,status:'ACTIVE'}));
      else if(pathname.endsWith('/faults/overview'))json=data.overview;
      else if(pathname.endsWith('/simulation-recovery')){data=await call({operation:'RECOVER',action:route.request().postDataJSON().action});json={request_id:'history-recovery'};}
      await route.fulfill({json});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/ui/operation`);
    const table=page.locator('table'),row=id=>table.locator('tbody tr').filter({hasText:id});
    await row('history-open').getByText('Executing',{exact:true}).waitFor();
    assert.notEqual(await row('history-open').locator('td').nth(2).innerText(),'—');
    assert.equal(await row('history-open').locator('td').nth(3).innerText(),'—');
    data=await call({operation:'FAULT'});await row('history-open').getByText('Device fault',{exact:true}).waitFor();
    assert((await row('history-open').innerText()).includes('OBSTRUCTED'));
    data=await call({operation:'CLEAR'});await row('history-open').getByText('Fault cleared · awaiting recovery confirmation',{exact:true}).waitFor();
    const fault=page.getByRole('dialog',{name:/Fault resolved/});await fault.getByRole('button',{name:'Continue operation',exact:true}).click();
    await fault.waitFor({state:'hidden'});data=await call({operation:'COMPLETE'});
    await row('history-open').getByText('Completed',{exact:true}).waitFor();
    const completedAt=await row('history-open').locator('td').nth(3).innerText();assert.notEqual(completedAt,'—');
    data=await call({operation:'COMMAND',id:'history-home',action:'HOME'});await row('history-home').getByText('Executing',{exact:true}).waitFor();
    data=await call({operation:'COMPLETE'});await row('history-home').getByText('Completed',{exact:true}).waitFor();
    await page.reload();await row('history-open').getByText('Completed',{exact:true}).waitFor();
    assert.equal(await row('history-open').locator('td').nth(3).innerText(),completedAt);
    fs.mkdirSync('test-results/ipcsim-operation',{recursive:true});await page.screenshot({path:'test-results/ipcsim-operation/history.png',fullPage:true});
    assert.equal(await table.getByText('Command sent',{exact:true}).count(),0);assert.deepEqual(errors,[]);
    console.log('PASS: real local OPEN/HOME, timestamps, moving/fault/cleared/resume/completed and refresh-stable completion');
  }finally{if(browser)await browser.close();python.stdin.end();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
