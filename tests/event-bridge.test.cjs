const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process');
const AppStream=require('../bridge/app-stream.cjs'),EventSessions=require('../bridge/event-sessions.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<150;i++){if(await check())return;await wait(40);}throw Error('Test page did not reach expected state');}
test('real CDP: DOM events, background input, model menu, and no duplicate sends',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-cdp-test-')),profile=path.join(root,'browser');
  let app,browser;
  const html=`<!doctype html><meta charset="utf-8"><title>Paper fixture</title>
  <div data-app-action-sidebar-thread-id="00000000-0000-4000-8000-000000000001" data-app-action-sidebar-thread-kind="chatgpt" data-app-action-sidebar-thread-selected="true"></div>
  <main><button>项目：Paper</button><section id="turns"><div data-chatgpt-conversation-turn><h2>你说：</h2><p>old</p><h2>ChatGPT 说：</h2><p data-markdown-text-style="assistant-message">old answer</p></div></section>
  <div contenteditable="true" aria-label="给 ChatGPT 发消息" id="editor"></div><button id="send">发送</button><div id="activity"></div>
  <button id="model">选择 ChatGPT 模型</button><div id="menu"></div></main>
  <script>window.selectedModel="Fixture A";window.sentCount=0;window.mutationTimes=[];send.onclick=()=>{window.sentCount++;let q=editor.innerText;editor.innerText='';let turn=document.createElement('div');turn.setAttribute('data-chatgpt-conversation-turn','');let h=document.createElement('h2');h.textContent='你说：';let p=document.createElement('p');p.textContent=q;let a=document.createElement('h2');a.textContent='ChatGPT 说：';let reply=document.createElement('p');reply.setAttribute('data-markdown-text-style','assistant-message');turn.append(h,p,a,reply);turns.append(turn);activity.innerHTML='<button>停止</button>';let i=0;const timer=setInterval(()=>{mutationTimes.push(Date.now());reply.textContent+='文本'+(++i);if(i===12){clearInterval(timer);activity.innerHTML='';}},30);};
  model.onclick=()=>{menu.setAttribute('role','menu');menu.innerHTML='<div role="menuitem">高，第 3 项，共 5 项。</div><button role="menuitem" id="choose">选择模型</button>';choose.onclick=()=>{menu.replaceChildren();for(const label of ['Fixture A','Fixture B']){const item=document.createElement('button');item.setAttribute('role','radio');item.setAttribute('aria-checked',String(window.selectedModel===label));item.textContent=label;item.onclick=()=>{window.selectedModel=label;menu.innerHTML='';};menu.append(item);}};};document.addEventListener('keydown',e=>{if(e.key==='Escape')menu.innerHTML='';});</script>`;
  let uiStrength=1,uiModel='Fixture model',uiSends=0,uiFiles=[],configCalls=[],configHolds=null,configFail=false,blankModel=false;const uiModels=()=>({models:['Fixture model','Fixture B'].map(name=>({name,selected:!blankModel&&name===uiModel,enabled:true})),strength:'Medium',power:{index:uiStrength,max:4,options:['Instant','Medium','High','XHigh','Pro'].map(label=>({label}))}});
  const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')){const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks);let b={};if(req.headers['content-type']?.includes('json'))b=JSON.parse(raw.toString()||'{}');res.setHeader('Content-Type','application/json');if(url.pathname==='/api/upload')return res.end(JSON.stringify({id:'file-one',name:url.searchParams.get('name'),size:raw.length}));if(url.pathname==='/api/session/config'){configCalls.push(b);if(configHolds)await new Promise(r=>configHolds.push(r));if(configFail){configFail=false;res.statusCode=400;return res.end(JSON.stringify({error:'Fixture settings failure'}));}if(b.model)uiModel=b.model;else uiStrength=b.index;const response=uiModels();blankModel=false;return res.end(JSON.stringify(response));}if(url.pathname==='/api/session/model')return res.end(JSON.stringify(uiModels()));if(url.pathname==='/api/transcript')return res.end(JSON.stringify({turns:[]}));if(url.pathname==='/api/session/send-stream'){uiSends++;uiFiles=b.files;res.setHeader('Content-Type','application/x-ndjson');return res.end([{type:'accepted'},{type:'snapshot',turns:[{role:'user',text:b.text},{role:'assistant',text:'Final only'}],generating:false},{type:'complete',info:{mode:'blank',phase:'ready'}}].map(x=>JSON.stringify(x)).join('\n')+'\n');}return res.end(JSON.stringify({mode:'blank',phase:'ready',draftKey:'fixture-ui'}));}
    const asset={'/ui':'index.html','/client.js':'client.js','/style.css':'style.css','/stream.js':'stream.js'}[url.pathname];if(asset){res.setHeader('Content-Type',asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html; charset=utf-8');return res.end(fs.readFileSync(path.join(__dirname,'../bridge',asset)));}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await app?.cdp.call('Browser.close').catch(()=>{});await app?.close().catch(()=>{});server.close();if(browser&&browser.exitCode===null){browser.kill();await new Promise(r=>{browser.once('exit',r);setTimeout(r,2000);});}for(let i=0;i<20;i++){try{fs.rmSync(root,{recursive:true,force:true});break;}catch{await wait(200);}}assert.equal(fs.existsSync(root),false,'temporary browser profile released');});
  browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--disable-background-networking','--disable-sync',`--user-data-dir=${profile}`,`http://127.0.0.1:${server.address().port}`],{windowsHide:true,stdio:'ignore'});
  let port;for(let i=0;i<100;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}await wait(100);}assert.ok(port,'isolated browser started');
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),target=targets.find(t=>t.url.startsWith(`http://127.0.0.1:${server.address().port}`));assert.ok(target);
  app=new AppStream();await assert.rejects(app.connect(target),/只能连接/);
  // Test fixture connects explicitly; production discovery accepts app:// pages only.
  await app.cdp.connect(target.webSocketDebuggerUrl);await until(()=>app.cdp.evaluate('document.readyState==="complete"&&!!document.getElementById("editor")'));await app.observe();assert.equal((await app.read()).threadId,'00000000-0000-4000-8000-000000000001');
  // Model and reasoning controls use their native callback without opening a menu.
  await app.cdp.evaluate(`(()=>{const e=document.getElementById('model');window.nativeChanges=0;const p={disabled:false,powerSelections:['Instant','Medium','High','XHigh','Pro'].map((label,i)=>({id:'p'+i,sliderLabel:label})),modelListConfig:{options:['Fixture A','Fixture B'].map((label,i)=>({id:'m'+i,label,selected:i===0,disabled:false}))}};p.selectedPowerSelection=p.powerSelections[2];p.onSelectPower=o=>{window.nativeChanges++;setTimeout(()=>p.selectedPowerSelection=o,35)};for(const o of p.modelListConfig.options)o.onSelect=()=>{window.nativeChanges++;setTimeout(()=>p.modelListConfig.options.forEach(x=>x.selected=x===o),35)};window.nativePicker=p;e.__reactFiber$fixture={memoizedProps:p};})()`);
  assert.equal((await app.models()).transport,'native-controls');
  const fastPower=await app.strength(undefined,3);assert.equal(fastPower.power.index,3);assert.equal(fastPower.transport,'native-controls');
  assert.equal((await app.model('Fixture B')).models.find(m=>m.selected).name,'Fixture B');
  assert.equal(await app.cdp.evaluate('document.getElementById("menu").children.length'),0,'native control path never opens App menus');
  await assert.rejects(app.strength(undefined,99),/无效/);
  await app.cdp.evaluate('nativePicker.disabled=true');await assert.rejects(app.model('Fixture A'),/暂不可用/);
  await app.cdp.evaluate('nativePicker.disabled=false;nativePicker.onSelectPower=()=>{window.nativeChanges++}');
  const changesBefore=await app.cdp.evaluate('nativeChanges');await assert.rejects(app.strength(undefined,0),/尚未确认/);assert.equal(await app.cdp.evaluate('nativeChanges'),changesBefore+1,'unconfirmed native action is never replayed via the menu fallback');
  await app.cdp.evaluate('delete document.getElementById("model").__reactFiber$fixture');
  const sessions=new EventSessions(root,app);sessions.bindings['paper:fixture']={title:'Paper fixture',threadId:'00000000-0000-4000-8000-000000000001',uploaded:true,phase:'ready'};
  const c=sessions.register({mode:'paper',key:'fixture',title:'Paper fixture',pdfPath:path.join(root,'fixture.pdf')});
  await app.cdp.evaluate('(()=>{const u=document.createElement("div");u.setAttribute("data-content-search-unit-key","thinking-only:assistant");u.textContent="PRIVATE THOUGHT";document.querySelector("main").append(u)})()');assert.equal((await app.read()).turns.some(t=>t.text.includes('PRIVATE THOUGHT')),false);await app.cdp.evaluate('document.querySelector("[data-content-search-unit-key]").remove()');
  await sessions.open(c.id);assert.equal(await app.cdp.evaluate('sentCount'),0);
  const models=await sessions.model(c.id);assert.equal(models.models.length,2);assert.equal(models.models[0].selected,true);const switched=await app.model('Fixture B');assert.equal(switched.models.find(m=>m.selected).name,'Fixture B');assert.equal(await app.cdp.evaluate('sentCount'),0);
  const events=[],arrival=[];const info=await sessions.send(c.id,'你好 流式测试',e=>{events.push(e);if(e.type==='snapshot'&&e.turns.at(-1)?.role==='assistant')arrival.push(Date.now());});
  assert.equal(info.transport,'app-dom-events');assert.equal(await app.cdp.evaluate('sentCount'),1);assert.equal(sessions.info(c.id).phase,'ready');assert.ok(events.filter(e=>e.type==='snapshot').length>=8,'incremental events are pushed');assert.match(events.at(-1).turns.at(-1).text,/文本12$/);
  const changes=await app.cdp.evaluate('mutationTimes'),latencies=arrival.map((at,i)=>at-changes[Math.min(i,changes.length-1)]).filter(x=>x>=0);
  console.log(JSON.stringify({source:'isolated local Edge fixture, not ChatGPT',changes:changes.length,received:arrival.length,medianEventMs:latencies.sort((a,b)=>a-b)[Math.floor(latencies.length/2)]}));
  // Switching the App page must not erase previously received paper history.
  await app.cdp.evaluate('document.querySelector("[data-app-action-sidebar-thread-id]").setAttribute("data-app-action-sidebar-thread-selected","false");document.querySelector("main button").textContent="项目：Other"');await wait(30);assert.match(sessions.transcript(c.id).turns.at(-1).text,/文本12$/);
  await app.cdp.call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/ui?context=fixture#test-token'});
  for(let i=0;i<100;i++){if(await app.cdp.evaluate('!!document.getElementById("send")&&!document.getElementById("send").disabled'))break;await wait(30);}
  assert.equal(await app.cdp.evaluate('document.getElementById("send").disabled'),false);assert.equal(uiSends,0,'opening does not send');
  assert.equal(await app.cdp.evaluate('document.getElementById("model").getBoundingClientRect().top>=document.getElementById("prompt").getBoundingClientRect().bottom'),true,'models below input');
  await app.cdp.evaluate('document.dispatchEvent(new WheelEvent("wheel",{ctrlKey:true,deltaY:-100,bubbles:true,cancelable:true}))');
  await until(()=>app.cdp.evaluate('document.getElementById("zoomReset").textContent==="105%"'));
  assert.equal(await app.cdp.evaluate('document.getElementById("zoomReset").textContent'),'105%');
  await app.cdp.call('Page.reload');for(let i=0;i<100;i++){if(await app.cdp.evaluate('!!document.getElementById("send")&&!document.getElementById("send").disabled'))break;await wait(30);}
  assert.equal(await app.cdp.evaluate('document.getElementById("zoomReset").textContent'),'105%');
  await app.cdp.evaluate('document.getElementById("power").dispatchEvent(new WheelEvent("wheel",{deltaY:-100,bubbles:true,cancelable:true}))');await until(async()=>uiStrength===2&&await app.cdp.evaluate('!document.getElementById("power").disabled'));assert.equal(uiStrength,2);

  configHolds=[];
  await app.cdp.evaluate('document.getElementById("model").click();document.getElementById("modelMenu").children[1].click()');
  await until(()=>configHolds.length===1);assert.equal(await app.cdp.evaluate('document.getElementById("modelName").textContent'),'Fixture B');
  configHolds.shift()();configHolds=null;await until(()=>app.cdp.evaluate('!document.getElementById("send").disabled'));
  assert.equal(await app.cdp.evaluate('document.getElementById("modelName").textContent'),'Fixture B');
  blankModel=true;await app.cdp.evaluate('document.getElementById("model").click();document.getElementById("modelMenu").children[0].click()');
  await until(()=>app.cdp.evaluate('document.getElementById("powerSync").textContent==="未同步"'));assert.equal(await app.cdp.evaluate('document.getElementById("modelName").textContent'),'Fixture B','invalid acknowledgment retains the last confirmed name');
  await app.cdp.evaluate('document.getElementById("reconnect").click()');await until(()=>app.cdp.evaluate('!document.getElementById("send").disabled'));assert.equal(await app.cdp.evaluate('document.getElementById("modelName").textContent'),'Fixture model');
  await app.cdp.evaluate('document.getElementById("powerToggle").click()');
  // A slow App acknowledgment must not disable dragging or rewind a newer preview.
  configCalls=[];configHolds=[];
  await app.cdp.evaluate('(()=>{const p=document.getElementById("power");window.modelNode=document.getElementById("model").firstChild;p.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));for(const value of [1.1,2.3,3.7,4]){p.value=value;p.dispatchEvent(new Event("input",{bubbles:true}));}})()');
  await wait(250);assert.equal(configCalls.length,0,'drag previews do not request App operations');
  assert.equal(await app.cdp.evaluate('document.getElementById("powerText").textContent'),'Pro');
  assert.equal(await app.cdp.evaluate('document.getElementById("send").disabled'),true);
  await app.cdp.evaluate('window.dispatchEvent(new PointerEvent("pointerup"))');await until(()=>configHolds.length===1);
  assert.equal(configCalls[0].index,4);assert.equal(await app.cdp.evaluate('document.getElementById("power").disabled'),false);
  await app.cdp.evaluate('(()=>{const p=document.getElementById("power");p.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));p.value=1.2;p.dispatchEvent(new Event("input",{bubbles:true}));window.dispatchEvent(new PointerEvent("pointerup"));})()');
  await wait(250);assert.equal(configCalls.length,1,'only one config operation in flight');
  configHolds.shift()();await until(()=>configHolds.length===1);
  assert.equal(configCalls[1].index,1);assert.equal(await app.cdp.evaluate('Number(document.getElementById("power").value)'),1,'old acknowledgment preserves latest thumb position');
  configHolds.shift()();configHolds=null;await until(()=>app.cdp.evaluate('!document.getElementById("send").disabled'));
  assert.equal(uiStrength,1);assert.equal(await app.cdp.evaluate('window.modelNode===document.getElementById("model").firstChild'),true,'strength updates preserve the model DOM');
  // Wheel bursts collapse into the final absolute value, with no dropped intermediate UI input.
  configCalls=[];await app.cdp.evaluate('(()=>{const p=document.getElementById("power");for(let i=0;i<3;i++)p.dispatchEvent(new WheelEvent("wheel",{deltaY:-100,bubbles:true,cancelable:true}));})()');
  await until(async()=>uiStrength===4&&await app.cdp.evaluate('!document.getElementById("send").disabled'));assert.equal(configCalls.length,1);
  // A failed setting stays explicit and blocks sends until reconnect confirms the App state.
  configFail=true;await app.cdp.evaluate('document.getElementById("power").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true,cancelable:true}))');
  await until(()=>app.cdp.evaluate('document.getElementById("powerSync").textContent==="未同步"'));
  assert.equal(await app.cdp.evaluate('document.getElementById("send").disabled'),true);
  await app.cdp.evaluate('document.getElementById("reconnect").click()');await until(()=>app.cdp.evaluate('!document.getElementById("send").disabled'));
  configCalls=[];
  await app.cdp.call('Emulation.setDeviceMetricsOverride',{width:400,height:640,deviceScaleFactor:1,mobile:false});await wait(50);
  await app.cdp.evaluate('if(document.getElementById("powerLabel").hidden)document.getElementById("powerToggle").click()');
  const track=await app.cdp.evaluate('(()=>{const r=document.getElementById("power").getBoundingClientRect();return{x:r.x,y:r.y+r.height/2,width:r.width}})()');
  await app.cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x:track.x+track.width-7,y:track.y,button:'left',clickCount:1});
  await app.cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:track.x+track.width*.6,y:track.y,button:'left',buttons:1});
  await wait(30);const fractional=await app.cdp.evaluate('Number(document.getElementById("power").value)');assert.ok(Math.abs(fractional-2.4)<.3&&!Number.isInteger(fractional),'native thumb travels continuously between discrete model choices');
  await wait(200);assert.equal(configCalls.length,0);
  await app.cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:track.x+track.width*.6,y:track.y,button:'left',clickCount:1});
  await until(async()=>uiStrength===Math.round(fractional)&&await app.cdp.evaluate('!document.getElementById("send").disabled'));assert.equal(configCalls.length,1);
  // Streaming updates retain old DOM/text selections and do not pull a reader back to the bottom.
  await app.cdp.evaluate('(()=>{turns=Array.from({length:80},(_,i)=>({id:"history-"+i,role:i%2?"assistant":"user",text:"历史消息 "+i+String.fromCharCode(10)+"保留阅读位置。".repeat(15)}));render();})()');await wait(100);
  await app.cdp.evaluate('(()=>{const a=document.getElementById("messages");a.scrollTop=50;a.dispatchEvent(new Event("scroll"));window.oldMessage=a.firstChild;window.oldText=a.firstChild.firstChild.firstChild;const r=document.createRange();r.setStart(window.oldText,0);r.setEnd(window.oldText,4);getSelection().removeAllRanges();getSelection().addRange(r);window.oldSelection=getSelection().toString();window.paintCount=0;const original=paint;paint=()=>{window.paintCount++;original();};for(let i=0;i<100;i++){turns[79]={...turns[79],text:turns[79].text+"增量"};render();}})()');await wait(100);
  assert.equal(await app.cdp.evaluate('window.paintCount'),1,'100 same-frame updates paint once');
  assert.equal(await app.cdp.evaluate('document.getElementById("messages").firstChild===window.oldMessage&&window.oldText===window.oldMessage.firstChild.firstChild&&getSelection().toString()===window.oldSelection'),true);
  assert.equal(await app.cdp.evaluate('Math.abs(document.getElementById("messages").scrollTop-50)<2'),true);
  assert.equal(await app.cdp.evaluate('document.getElementById("latest").hidden'),false);
  await app.cdp.evaluate('document.getElementById("latest").click()');assert.equal(await app.cdp.evaluate('document.getElementById("latest").hidden'),true);
  // Narrow sidebar plus maximum text zoom keeps composer controls within the viewport.
  await app.cdp.call('Emulation.setDeviceMetricsOverride',{width:320,height:360,deviceScaleFactor:1,mobile:false});
  await app.cdp.evaluate('setZoom(1.6)');await wait(50);
  assert.equal(await app.cdp.evaluate('document.documentElement.scrollWidth<=innerWidth&&document.getElementById("power").getBoundingClientRect().right<=innerWidth&&document.getElementById("composer").getBoundingClientRect().bottom<=innerHeight'),true);
  await app.cdp.call('Emulation.setDeviceMetricsOverride',{width:320,height:560,deviceScaleFactor:1,mobile:false});
  await app.cdp.evaluate('setZoom(1);turns=[];render()');
  await app.cdp.evaluate('(()=>{const dt=new DataTransfer();dt.items.add(new File(["synthetic content"],"extra.txt",{type:"text/plain"}));document.dispatchEvent(new DragEvent("drop",{dataTransfer:dt,bubbles:true,cancelable:true}));})()');await until(()=>app.cdp.evaluate('document.getElementById("files").children.length===1&&!document.getElementById("send").disabled'));
  assert.equal(await app.cdp.evaluate('document.getElementById("files").textContent'),'extra.txt ×');assert.equal(uiSends,0,'drop alone does not send');
  await app.cdp.evaluate('document.getElementById("prompt").value="hello";document.getElementById("prompt").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');await until(()=>app.cdp.evaluate('document.getElementById("messages").textContent.includes("Final only")&&document.getElementById("prompt").value===""'));
  if(process.env.LOCALCHAT_SCREENSHOT){await app.cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await app.cdp.evaluate('document.getElementById("powerToggle").click()');fs.writeFileSync(process.env.LOCALCHAT_SCREENSHOT,Buffer.from((await app.cdp.call('Page.captureScreenshot',{format:'png'})).data,'base64'));await app.cdp.evaluate('closePickers()');}
  assert.equal(uiSends,1);assert.deepEqual(uiFiles,['file-one']);assert.match(await app.cdp.evaluate('document.getElementById("messages").textContent'),/Final only/);assert.equal(await app.cdp.evaluate('document.getElementById("prompt").value'),'');

});
