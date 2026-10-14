const { chromium } = require('../.tools/ui/node_modules/playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');

(async () => {
  const dist = path.resolve('IPCSIM/frontend/dist');
  const server = http.createServer((request, response) => {
    let file = path.resolve(dist, new URL(request.url, 'http://localhost').pathname.replace(/^\/ui\/?/, ''));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel:'chrome', headless:true });
    const page = await browser.newPage({ viewport:{ width:1366, height:768 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      localStorage.setItem('smartInventory.language', 'en');
      localStorage.setItem('token', 'test'); localStorage.setItem('edgeOperatorSession', 'test');
    });
    const cabinet = { id:1, cabinet_index:1, cabinet_code:'C01', cabinet_name:'Cabinet 01', status:'ACTIVE' };
    let cabinetList = [cabinet];
    const rack = { id:1, rack_index:1, rack_code:'1', cabinet_id:1, status:'READY' };
    const items = Array.from({ length:63 }, (_, index) => ({ id:index + 1, item_code:`PART-${index + 1}`, item_name:`Product ${String(index + 1).padStart(2, '0')}`, is_active:true, category:'Parts', unit:'pcs' }));
    const records = [{ kind:'cabinet', data:cabinet }, { kind:'rack', data:rack }, { kind:'shelf', data:{ id:1, rack_id:1 } },
      ...items.flatMap(item => [{ kind:'item', data:item }, { kind:'bin', data:{ id:item.id, shelf_id:1, bin_code:`B${item.id}`, capacity:100 } }, { kind:'stock', data:{ item_id:item.id, bin_id:item.id, quantity:10 } }])];
    let count = 63;
    let rackList = [rack], environmentRows = [], environmentMultiCabinet = false;
    let overview = {};
    const health = { device_type:'IPCSIM', serial_connected:true, simulation_online:true, local_operation_available:true, server_online:true,
      simulation_states:[{ cabinet_index:1, online:true, system_state:'IDLE' }] };
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET') writes.push(pathname);
      let json = {};
      if (pathname.endsWith('/operator/session')) json = { username:'Operator', permissions:[] };
      else if (pathname.endsWith('/system/health')) json = health;
      else if (pathname.endsWith('/device/snapshot')) json = { health, records:records.filter(record => !['item','bin','stock'].includes(record.kind) || (record.data.id || record.data.item_id) <= count),
        operation_history:items.slice(0, count).map(item => ({ id:`command-${item.id}`, body:{ kind:'OPEN', rack_id:1, address:1 }, execution_state:'completed', created_at:'2026-10-08T07:00:00Z' })) };
      else if (pathname.endsWith('/cabinets')) json = cabinetList;
      else if (pathname.endsWith('/racks')) json = environmentMultiCabinet ? rackList.filter(rack => rack.cabinet_id === Number(pathname.split('/').at(-2))) : rackList;
      else if (pathname.endsWith('/dashboard/summary')) json = overview;
      else if (pathname.endsWith('/environment/history')) json = {data:environmentRows};
      else if (pathname.endsWith('/telemetry/operation')) json = {data:[]};
      else if (pathname.endsWith('/items')) json = items;
      else if (pathname.endsWith('/operator/operations')) json = [];
      else if (pathname.endsWith('/transactions')) json = items.slice(0, count).map(item => ({ id:item.id, item_id:item.id, item_name:item.item_name, item_code:item.item_code, transaction_type:'PUT', quantity:10, created_at:'2026-10-08T07:00:00Z' }));
      else if (pathname.endsWith('/faults/overview')) json = { maintenance_warnings:[] };
      await route.fulfill({ json });
    });
    const origin = `http://127.0.0.1:${server.address().port}/ui/`;
    const waitRows = async expected => {
      await page.waitForFunction(n => document.querySelectorAll('main table tbody tr').length === n, expected);
    };
    async function chooseSize(size) {
      await page.getByRole('combobox', { name:'Rows per page:' }).click();
      await page.getByRole('option', { name:String(size), exact:true }).click();
    }
    fs.mkdirSync('test-results/ipcsim-tables', { recursive:true });
    for (const route of ['inventory', 'operation', 'transactions']) {
      count = 63; await page.goto(origin + route); await waitRows(5);
      assert((await page.getByRole('combobox',{name:'Rows per page:'}).boundingBox()).y < (await page.locator('main table').first().boundingBox()).y, `${route}: pagination above the table`);
      await chooseSize(5); await waitRows(5);
      await page.getByRole('button', {name:'Go to next page'}).click();
      await page.getByText('6–10 / 63',{exact:true}).waitFor();
      await chooseSize(10); await waitRows(10);
      await page.getByRole('button', { name:'Go to next page' }).click();
      await page.getByText('11–20 / 63', { exact:true }).waitFor();
      await chooseSize(25); await waitRows(25); await page.getByText('1–25 / 63', { exact:true }).waitFor();
      await chooseSize(50); await waitRows(50);
      assert(await page.locator('main .MuiTableContainer-root').first().evaluate(node=>node.scrollHeight<=node.clientHeight), `${route}: no internal vertical table scroll at 50 rows`);
      await page.getByRole('button', { name:'Go to next page' }).click(); await waitRows(13);
      if (route === 'inventory') {
        await page.getByRole('button', { name:'Location', exact:true }).click();
        await page.getByRole('combobox',{name:'Cabinets per page:'}).waitFor();
        await waitRows(1);
        await page.getByRole('button',{name:'Show all racks',exact:true}).click(); await waitRows(1);
        await page.getByText('1–1 / 1', { exact:true }).waitFor();
        const totals = await page.locator('.inventory-cabinet-heading').innerText();
        assert(totals.includes('63') && totals.includes('630'), 'Location totals use all filtered records');
        await page.getByRole('button',{name:'Show stocked racks',exact:true}).click(); await waitRows(1);
        await page.getByRole('button', { name:'Product', exact:true }).click();
        await chooseSize(10); await waitRows(10);
        await page.getByRole('button', { name:'Go to next page' }).click();
        await page.locator('.inventory-search input').fill('Product 63'); await waitRows(1);
        await page.getByText('1–1 / 1', { exact:true }).waitFor();
        await page.locator('.inventory-search input').fill(''); await waitRows(10);
      }
      count = 3;
      await page.getByRole('button', { name:'Refresh', exact:true }).click(); await waitRows(3);
      await page.getByText('1–3 / 3', { exact:true }).waitFor();
      if (route === 'inventory') {
        await page.getByRole('button', { name:'Location', exact:true }).click();
        await waitRows(1);
      }
      for (const viewport of [{ width:1366, height:768 }, { width:1920, height:1080 }]) {
        await page.setViewportSize(viewport); await page.evaluate(() => scrollTo(0, 0));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route}: horizontal page overflow`);
        const fontSize = await page.locator('main table td').first().evaluate(cell => parseFloat(getComputedStyle(cell).fontSize));
        assert(fontSize >= 15, `${route}: readable table text`);
        await page.screenshot({ path:`test-results/ipcsim-tables/${route}-${viewport.width}.png`, fullPage:true,animations:'disabled' });
      }
    }
    cabinetList = Array.from({length:22}, (_, index) => ({...cabinet, id:index+1, cabinet_index:index+1, cabinet_name:`Cabinet ${String(index+1).padStart(2, '0')}`, cabinet_code:`C${index+1}`, rack_count:6,
      status:index === 1 ? 'INACTIVE' : 'ACTIVE', mechanical:{online:index !== 1, system_state:index === 1 ? 'COMMUNICATION_LOST' : index === 2 || index === 3 ? 'ERROR' : index === 4 ? 'RECOVERING' : 'IDLE',
        fault_context:index === 1 ? {error_code:'COMMUNICATION_LOST'} : index === 2 ? {error_code:'OBSTRUCTED'} : index === 3 ? {error_code:'OBSTRUCTED',rack_id:21,current_position:10,target_position:20} : index === 4 ? {error_code:'COMMUNICATION_LOST',cleared:true} : null}}));
    cabinetList.reverse();
    await page.goto(origin + 'cabinets');
    await page.waitForFunction(() => document.querySelectorAll('[data-cabinet-id]').length === 6);
    const listText = await page.locator('main').innerText();
    assert(!listText.includes('NaN') && !listText.includes('COMMUNICATION_LOST') && !listText.includes('mm'), 'No invalid or offline telemetry in cabinet cards');
    assert(await page.locator('[data-cabinet-id="2"] .MuiChip-root').count() === 1, 'Disconnected cabinet keeps a status tag');
    assert(await page.locator('[data-cabinet-id="2"]').getByRole('button').isDisabled(), 'Inactive controls remain disabled');
    await page.locator('[data-cabinet-id="5"] .MuiChip-root').getByText('Recovering',{exact:true}).waitFor();
    const invalidFault = page.locator('[data-cabinet-id="3"]');
    await invalidFault.locator('summary').click();
    assert(!(await invalidFault.innerText()).includes('NaN') && !(await invalidFault.innerText()).includes('mm'));
    const validFault = page.locator('[data-cabinet-id="4"]'); await validFault.locator('summary').click();
    await validFault.getByText('Rack 3', {exact:false}).waitFor();
    assert((await validFault.innerText()).includes('10') && (await validFault.innerText()).includes('20 mm'));
    assert.deepEqual(await page.locator('[data-cabinet-id]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.cabinetId))),[1,2,3,4,5,6]);
    await page.getByRole('combobox',{name:/Cabinet group/}).click();
    await page.getByRole('option',{name:/Cabinet 07.*12/}).click();
    assert.deepEqual(await page.locator('[data-cabinet-id]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.cabinetId))),[7,8,9,10,11,12]);
    await page.getByRole('combobox',{name:/Cabinet group/}).click();
    await page.getByRole('option',{name:/Cabinet 13.*18/}).click();
    assert.deepEqual(await page.locator('[data-cabinet-id]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.cabinetId))),[13,14,15,16,17,18]);
    await page.getByRole('combobox',{name:/Cabinet group/}).click();
    await page.getByRole('option',{name:/Cabinet 19.*24/}).click();
    assert.deepEqual(await page.locator('[data-cabinet-id]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.cabinetId))),[19,20,21,22]);
    await page.getByRole('combobox',{name:/Cabinet group/}).click();
    await page.getByRole('option',{name:/Cabinet 01.*06/}).click();
    for (const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:900,height:768},{width:390,height:844}]) {
      await page.setViewportSize(viewport); await page.evaluate(() => scrollTo(0,0));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({path:`test-results/ipcsim-tables/cabinets-${viewport.width}.png`,fullPage:true,animations:'disabled'});
    }
    cabinetList = [{...cabinet,rack_count:6}];
    rackList = Array.from({length:6}, (_,index) => ({...rack,id:index+1,rack_code:String(index+1),rack_index:index+1,rack_name:`Rack ${index+1}`}));
    Object.assign(health, {hardware_status:'ONLINE',database_healthy:true,server_synced:true,pending_transactions:0,serial_groups:{1:true}});
    Object.assign(health.simulation_states[0], {current_gap:6,racks:Object.fromEntries(rackList.map(rack => [rack.rack_code,{position_mm:(rack.id-1)*100,is_moving:false,access_state:'IDLE'}])),lights:{},sensors:{faults:{}},allowed_actions:[]});
    environmentRows = rackList.map(rack => ({id:rack.id,rack_id:rack.id,temperature:27,humidity:65,weight:20,smoke:0,created_at:'2026-10-08T07:00:00Z'}));
    overview = {cabinet_status:{active_cabinets:1,total_cabinets:1,active_racks:6,total_racks:6,active_groups:[{id:1,name:'Cabinet 01',code:'C01'}]},inventory_summary:{total_items:3,total_stock:30,low_stock_count:0},environment_summary:{temperature:27,humidity:65,weight:20,smoke:0,last_updated:'2026-10-08T07:00:00Z'}};
    for (const route of ['', 'environment', 'system', 'cabinets/1']) {
      await page.goto(origin + route);
      await page.locator('main h4').first().waitFor();
      if (route === 'environment') { await page.getByTestId('environment-rack').nth(5).waitFor(); }
      if (route === 'cabinets/1') { await page.getByRole('button',{name:'Open R1',exact:true}).waitFor(); }
      for (const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:900,height:768},{width:390,height:844}]) {
        await page.setViewportSize(viewport); await page.evaluate(() => scrollTo(0,0));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route}: page overflow`);
        await page.screenshot({path:`test-results/ipcsim-tables/${route.replace('/','-') || 'dashboard'}-${viewport.width}.png`,fullPage:true,animations:'disabled'});
      }
      await page.setViewportSize({width:1366,height:768});
      if (route === 'environment') {
        await page.getByTestId('environment-rack').getByRole('button',{name:'Trends',exact:true}).first().click();
        await page.getByRole('combobox',{name:/Displayed racks/}).waitFor();
        await page.waitForFunction(() => document.querySelectorAll('.recharts-wrapper').length === 2);
        await page.screenshot({path:'test-results/ipcsim-tables/environment-trends.png',fullPage:true,animations:'disabled'});
        environmentRows[1].smoke = 1; await page.getByRole('button',{name:'Refresh',exact:true}).click();
        await page.getByRole('alert').filter({hasText:/smoke/}).waitFor();
        await page.getByRole('tab',{name:'Latest readings',exact:true}).click();
        await page.getByTestId('environment-rack').filter({hasText:'Rack 2'}).getByText('Smoke detected',{exact:true}).waitFor();
        environmentRows = []; await page.getByRole('button',{name:'Refresh',exact:true}).click();
        await page.getByRole('tab',{name:'Trends',exact:true}).click();
        await page.getByText('No readings for this rack yet',{exact:true}).first().waitFor();
      }
      if (route === 'system') {
        await page.locator('main summary').first().click();
        assert((await page.locator('main').innerText()).includes('Serial'));
      }
    }
    environmentMultiCabinet = true;
    cabinetList = Array.from({length:3}, (_,index) => ({...cabinet,id:index+1,cabinet_name:`Cabinet 0${index+1}`}));
    rackList = cabinetList.flatMap(cabinet => Array.from({length:12}, (_,index) => ({...rack,id:cabinet.id*100+index,rack_index:index+1,cabinet_id:cabinet.id})));
    await page.goto(origin + 'environment');
    await page.getByTestId('environment-rack').nth(11).waitFor();
    assert.equal(await page.getByTestId('environment-rack').count(),12);
    await page.getByRole('button',{name:'Go to next page'}).click();
    await page.getByRole('heading',{name:'Cabinet 02',exact:true}).waitFor();
    assert.equal(await page.getByTestId('environment-rack').count(),12);
    await page.getByRole('combobox',{name:/Cabinets per page/}).click();
    await page.getByRole('option',{name:'3',exact:true}).click();
    assert.equal(await page.getByTestId('environment-rack').count(),36);
    await page.getByRole('combobox',{name:/Cabinet group/}).click();
    await page.getByRole('option',{name:'Cabinet 03',exact:true}).click();
    await page.getByRole('heading',{name:'Cabinet 03',exact:true}).waitFor();
    assert.equal(await page.getByTestId('environment-rack').count(),12);
    count = 64;
    cabinetList = [{...cabinet,id:2,cabinet_name:'Cabinet 02',cabinet_index:2,status:'inactive'}, cabinet];
    rackList = [rack, {...rack,id:2,cabinet_id:2}, ...[1,2].flatMap(cabinetId=>Array.from({length:5},(_,index)=>({...rack,id:3+(cabinetId-1)*5+index,rack_index:index+2,cabinet_id:cabinetId})))];
    records.push({kind:'cabinet',data:cabinetList[1]}, {kind:'rack',data:{...rack,id:2,cabinet_id:2}}, {kind:'shelf',data:{id:2,rack_id:2}}, {kind:'bin',data:{id:64,shelf_id:2,bin_code:'B64',capacity:100}});
    await page.goto(origin + 'inventory'); await waitRows(5);
    await page.getByRole('button',{name:'Location',exact:true}).click();
    await page.getByText('1–1 / 2',{exact:true}).waitFor();
    assert.equal(await page.locator('.inventory-cabinet').count(),1);
    await page.locator('.inventory-cabinet-heading').filter({hasText:'Cabinet 01'}).waitFor();
    await waitRows(1);
    await page.getByRole('button',{name:'Show all racks',exact:true}).click(); await waitRows(6);
    assert.equal(await page.getByTestId('inventory-empty-rack').count(),5);
    assert.equal(await page.getByRole('combobox',{name:'Rack',exact:true}).count(),0);
    for (const viewport of [{width:1366,height:768},{width:1920,height:1080}]) {
      await page.setViewportSize(viewport); await page.evaluate(()=>scrollTo(0,0));
      const table = page.locator('.inventory-cabinet table');
      const bounds = await table.boundingBox();
      await page.screenshot({path:`test-results/ipcsim-tables/inventory-six-racks-${viewport.width}.png`,fullPage:true,animations:'disabled'});
      assert(bounds.y + bounds.height <= viewport.height, `All six racks fit in the desktop viewport: ${JSON.stringify(bounds)}`);
      assert(await page.locator('.inventory-cabinet .MuiTableContainer-root').evaluate(node=>node.scrollHeight<=node.clientHeight), 'No vertical scroll inside the rack table');
      await page.screenshot({path:`test-results/ipcsim-tables/inventory-six-racks-${viewport.width}.png`,fullPage:true,animations:'disabled'});
    }
    await page.locator('.inventory-cabinet').getByRole('button',{name:/^View .*Rack 01/}).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('dialog').locator('tbody tr').count(),63,'Every bin remains available in rack details');
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Show stocked racks',exact:true}).click(); await waitRows(1);
    await page.getByRole('button',{name:'Go to next page'}).click();
    await page.locator('.inventory-cabinet-heading').filter({hasText:'Cabinet 02'}).waitFor();
    assert(Number(await page.locator('.inventory-cabinet').evaluate(node=>getComputedStyle(node).opacity)) < 1);
    await page.getByText('No stocked racks. Expand to view all racks.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Show all racks',exact:true}).click(); await waitRows(6);
    await page.getByRole('combobox',{name:'Cabinets per page:'}).click();
    await page.getByRole('option',{name:'3',exact:true}).click();
    assert.equal(await page.locator('.inventory-cabinet').count(),2);
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    console.log('PASS: all console pages at desktop/mobile sizes, 10/25/50 rows, filters, live data, offline/recovery tags, environment smoke/trends/empty states; no writes');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

