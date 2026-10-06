const {chromium}=require('../.tools/ui/node_modules/playwright');
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const readline=require('node:readline');

(async()=>{
  const python=spawn(process.env.TEST_PYTHON||'.tools/cleanup-python/python.exe',['-u','tests/ipcsim_faults_page_harness.py'],{windowsHide:true});
  const requests=[];let diagnostic='';
  python.stderr.on('data',chunk=>diagnostic+=chunk);
  readline.createInterface({input:python.stdout}).on('line',line=>{const result=JSON.parse(line),request=requests.shift();result.error?request.reject(new Error(result.error)):request.resolve(result);});
  python.on('exit',code=>{while(requests.length)requests.shift().reject(new Error(`Harness exited ${code}: ${diagnostic}`));});
  const call=data=>new Promise((resolve,reject)=>{requests.push({resolve,reject});python.stdin.write(JSON.stringify(data)+'\n');});
  const dist=path.resolve('IPCSIM/frontend/dist');
  const server=http.createServer((request,response)=>{
    let file=path.resolve(dist,new URL(request.url,'http://localhost').pathname.replace(/^\/ui\/?/,''));
    if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(dist,'index.html');
    response.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');response.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    let data=await call({operation:'OVERVIEW'});const errors=[],acknowledgements=[];
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    page.on('pageerror',error=>errors.push(String(error)));
    await page.addInitScript(()=>{localStorage.setItem('smartInventory.language','en');localStorage.setItem('token','test');localStorage.setItem('edgeOperatorSession','test');});
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url()),pathname=url.pathname;let json={};
      try{
        if(pathname.endsWith('/operator/session'))json={id:1,username:'Operator',permissions:['cabinet.control','inventory.move']};
        else if(pathname.endsWith('/faults/overview')){
          const filters=Object.fromEntries([...url.searchParams].map(([key,value])=>[key,['cabinet','rack','hours','offset','limit'].includes(key)?Number(value):value]));
          data=await call({operation:'OVERVIEW',filters});json=data.overview;
        }else if(/\/faults\/\d+$/.test(pathname)){
          data=await call({operation:'DETAIL',filters:{fault_id:Number(pathname.split('/').at(-1))}});json=data.overview.history[0];
        }else if(pathname.endsWith('/maintenance/acknowledge')){
          const body=request.postDataJSON();acknowledgements.push(body);data=await call({operation:'ACK',...body});json={acknowledged:true};
        }else if(pathname.endsWith('/system/health'))json={device_type:'IPCSIM',hardware_status:data.states.some(state=>['ERROR','RECOVERING','STOPPED','COMMUNICATION_LOST'].includes(state.system_state))?'FAULT':'ONLINE',serial_connected:true,simulation_online:data.states.some(state=>state.online),simulation_states:data.states};
        else if(pathname.endsWith('/cabinets'))json=data.records.filter(record=>record.kind==='cabinet').map(record=>({...record.data,status:'ACTIVE'}));
        await route.fulfill({json});
      }catch(error){await route.fulfill({status:409,json:{detail:String(error)}});}
    });
    const url=`http://127.0.0.1:${server.address().port}/ui/breakdown`;
    const safety=page.getByTestId('fault-safety'),rack=page.getByTestId('fault-rack-3');
    const refresh=()=>page.getByRole('button',{name:'Refresh',exact:true}).click();
    const fire=async(address=3,codes=[1])=>{data=await call({operation:'FAULT',address,codes});await refresh();};
    const clear=async(address=3)=>{data=await call({operation:'CLEAR',address});await refresh();};
    await page.goto(url);await safety.getByText('SYSTEM NORMAL',{exact:true}).waitFor();
    await fire();await page.getByTestId('active-fault').getByText('Critical',{exact:true}).waitFor();
    await rack.getByText('ACTIVE FAULT',{exact:true}).waitFor();
    for(let i=0;i<5;i++)data=await call({operation:'FAULT',address:3});
    assert.equal(data.overview.summary.faults_24h,1);
    await clear();await rack.getByText('NORMAL',{exact:true}).waitFor();
    await fire(3,[2]);await clear();assert.equal(data.overview.maintenance_warnings.length,0);
    await fire(3,[3]);await clear();await page.getByTestId('maintenance-warning').getByText('3 faults in the last 30 minutes',{exact:true}).waitFor();
    await rack.getByText('MAINTENANCE WARNING',{exact:true}).waitFor();
    await page.getByTestId('maintenance-warning').getByRole('button',{name:'Acknowledge Maintenance Warning',exact:true}).evaluate(button=>{button.click();button.click();});
    await page.getByTestId('maintenance-warning').getByText('Acknowledged',{exact:true}).waitFor();assert.equal(acknowledgements.length,1);
    await page.reload();await page.getByTestId('maintenance-warning').getByText('Acknowledged',{exact:true}).waitFor();
    await fire();await page.getByTestId('maintenance-warning').getByText('INSPECTION RECOMMENDED',{exact:true}).waitFor();
    await fire(4,[2]);await page.getByTestId('active-fault').nth(1).waitFor();assert.equal(await page.getByTestId('active-fault').count(),2);
    await page.getByTestId('active-fault').first().getByRole('button',{name:'Details',exact:true}).click();
    const detail=page.getByRole('dialog',{name:'Fault details',exact:true});await detail.getByText('First detected',{exact:true}).waitFor();
    await detail.getByRole('button',{name:'Close',exact:true}).click();
    fs.mkdirSync('test-results/ipcsim-faults',{recursive:true});await page.screenshot({path:'test-results/ipcsim-faults/active-maintenance.png',fullPage:true});
    await clear();await clear(4);
    await page.getByRole('combobox',{name:/^Severity/}).click();await page.getByRole('option',{name:'Critical',exact:true}).click();
    await page.getByRole('combobox',{name:/^Rack/}).click();await page.getByRole('option',{name:'Cabinet 01 / Rack 03',exact:true}).click();
    await page.getByRole('textbox',{name:'Search error code',exact:true}).fill('MOTOR_OVERLOAD');
    await page.waitForFunction(()=>document.querySelector('table[aria-label="Fault history"] tbody')?.textContent.includes('MOTOR_OVERLOAD'));
    assert.equal(await page.getByRole('table',{name:'Fault history',exact:true}).locator('tbody tr').count(),1);
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    const before=data.overview.summary.faults_24h;data=await call({operation:'OFFLINE'});
    const connection=page.getByRole('dialog').filter({has:page.locator('#simulation-connection-title')});await connection.getByText('Simulation connection lost',{exact:true}).waitFor();
    assert.equal(data.overview.summary.faults_24h,before);
    data=await call({operation:'ONLINE'});await connection.getByRole('button',{name:'Confirm connection restored',exact:true}).click();
    await connection.waitFor({state:'hidden'});await rack.getByText('MAINTENANCE WARNING',{exact:true}).waitFor();
    await page.screenshot({path:'test-results/ipcsim-faults/maintenance.png',fullPage:true});
    assert.deepEqual(errors,[]);assert.equal(data.commands.length,0,'The Faults page never controls hardware');
    console.log('PASS: live normal/active/resolved faults, true occurrences, maintenance/ack/recurrence, filters, details, refresh and separate connection status');
  }finally{if(browser)await browser.close();python.stdin.end();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
