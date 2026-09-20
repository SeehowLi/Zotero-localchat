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
  const appearanceClients=new Set(),emitTheme=theme=>{for(const res of appearanceClients)res.write(JSON.stringify({type:'theme',theme})+'\n');};
  let sendHolds=null,sendFailure=false;
  let uiStrength=1,uiModel='Fixture model',uiSends=0,uiFiles=[],configCalls=[],configHolds=null,configFail=false,blankModel=false;const uiModels=()=>({models:['Fixture model','Fixture B'].map(name=>({name,selected:!blankModel&&name===uiModel,enabled:true})),strength:'Medium',power:{index:uiStrength,max:4,options:['Instant','Medium','High','XHigh','Pro'].map(label=>({label}))}});
  const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/api/appearance-stream'){res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.flushHeaders();appearanceClients.add(res);res.on('close',()=>appearanceClients.delete(res));return;}if(url.pathname.startsWith('/api/')){const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks);let b={};if(req.headers['content-type']?.includes('json'))b=JSON.parse(raw.toString()||'{}');res.setHeader('Content-Type','application/json');if(url.pathname==='/api/upload')return res.end(JSON.stringify({id:'file-one',name:url.searchParams.get('name'),size:raw.length}));if(url.pathname==='/api/session/config'){configCalls.push(b);if(configHolds)await new Promise(r=>configHolds.push(r));if(configFail){configFail=false;res.statusCode=400;return res.end(JSON.stringify({error:'Fixture settings failure'}));}if(b.model)uiModel=b.model;else uiStrength=b.index;const response=uiModels();blankModel=false;return res.end(JSON.stringify(response));}if(url.pathname==='/api/session/model')return res.end(JSON.stringify(uiModels()));if(url.pathname==='/api/transcript')return res.end(JSON.stringify({turns:[]}));if(url.pathname==='/api/session/send-stream'){uiSends++;uiFiles=b.files;if(sendHolds)await new Promise(r=>sendHolds.push(r));if(sendFailure){sendFailure=false;res.statusCode=400;return res.end(JSON.stringify({error:'Fixture send failure'}));}res.setHeader('Content-Type','application/x-ndjson');return res.end([{type:'accepted'},{type:'snapshot',turns:[{role:'user',text:b.text},{role:'assistant',text:'Final only'}],generating:false},{type:'complete',info:{mode:'blank',phase:'ready',draftKey:'fixture-ui'}}].map(x=>JSON.stringify(x)).join('\n')+'\n');}return res.end(JSON.stringify({mode:'blank',phase:'ready',draftKey:'fixture-ui'}));}
    const asset={'/ui':'index.html','/client.js':'client.js','/style.css':'style.css','/stream.js':'stream.js','/rich.js':'rich.js'}[url.pathname];if(asset){res.setHeader('Content-Type',asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html; charset=utf-8');return res.end(fs.readFileSync(path.join(__dirname,'../bridge',asset)));}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
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
  const events=[],arrival=[];const info=await sessions.send(c.id,'你好 流式测试',e=>{events.push(e);if(['snapshot','patch'].includes(e.type)&&e.turns.at(-1)?.role==='assistant')arrival.push(Date.now());});
  assert.equal(info.transport,'app-dom-events');assert.equal(await app.cdp.evaluate('sentCount'),1);assert.equal(sessions.info(c.id).phase,'ready');assert.ok(events.filter(e=>['snapshot','patch'].includes(e.type)).length>=8,'incremental events are pushed');assert.match(sessions.transcript(c.id).turns.at(-1).text,/文本12$/);assert.ok(events.filter(e=>e.type==='patch').every(e=>!e.turns.some(t=>t.text==='old answer')),'unchanged history is not retransmitted');
  const changes=await app.cdp.evaluate('mutationTimes'),latencies=arrival.map((at,i)=>at-changes[Math.min(i,changes.length-1)]).filter(x=>x>=0);
  console.log(JSON.stringify({source:'isolated local Edge fixture, not ChatGPT',changes:changes.length,received:arrival.length,medianEventMs:latencies.sort((a,b)=>a-b)[Math.floor(latencies.length/2)]}));
  // Native rendered structure survives collection; formulas are not duplicated.
  await app.cdp.evaluate(`(()=>{const unit=document.createElement('div');unit.setAttribute('data-content-search-unit-key','rich:assistant');unit.innerHTML='<div data-markdown-text-style="assistant-message"><h2>Heading</h2><p><strong>Bold</strong> and <em>italic</em> <a href="https://example.com/paper">source</a></p><ol start="3"><li>First</li><li>Second</li></ol><blockquote>Quote</blockquote><pre><code class="language-js"><span class="token keyword">const</span> x = 1;</code></pre><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><span class="group/resource-row"><button>Open file</button><span><span title="fixture.pdf">fixture.pdf</span><span>PDF</span></span></span><span class="katex-display"><span class="katex"><span class="katex-mathml"><math><mfrac><mi>x</mi><mn>2</mn></mfrac></math></span><span class="katex-html">duplicate visual formula</span></span></span></div>';document.querySelector('main').append(unit);})()`);
  const collected=(await app.read()).turns.find(t=>t.id==='rich:assistant');assert.ok(collected.rich);const packed=JSON.stringify(collected.rich);for(const tag of ['h2','strong','ol','li','pre','code','table','math','mfrac'])assert.ok(packed.includes('"'+tag+'"'),tag);assert.ok(!packed.includes('duplicate visual formula'));assert.ok(packed.includes('localchat-resource'));assert.ok(!packed.includes('Open file'));
  assert.equal(await app.cdp.evaluate('(()=>{const a=__paperChatObserver.read().turns,b=__paperChatObserver.read().turns;return a[0]===b[0]})()'),true,'unchanged messages use cached semantic structure');
  await app.cdp.evaluate("document.querySelector('[data-content-search-unit-key]').remove()");
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
  const painted=()=>until(()=>app.cdp.evaluate('renderFrame===0&&questionScrollFrame===0'));
  // Streaming updates retain old DOM/text selections and do not pull a reader back to the bottom.
  await app.cdp.evaluate('(()=>{turns=Array.from({length:80},(_,i)=>({id:"history-"+i,role:i%2?"assistant":"user",text:"历史消息 "+i+String.fromCharCode(10)+"保留阅读位置。".repeat(15)}));render();})()');await painted();
  await app.cdp.evaluate('(()=>{const a=document.getElementById("messages");a.scrollTop=50;a.dispatchEvent(new Event("scroll"));window.oldMessage=a.firstChild;window.oldText=a.firstChild.firstChild.firstChild;const r=document.createRange();r.setStart(window.oldText,0);r.setEnd(window.oldText,4);getSelection().removeAllRanges();getSelection().addRange(r);window.oldSelection=getSelection().toString();window.paintCount=0;const original=paint;paint=()=>{window.paintCount++;original();};for(let i=0;i<100;i++){turns[79]={...turns[79],text:turns[79].text+"增量"};render();}})()');await painted();
  assert.equal(await app.cdp.evaluate('window.paintCount'),1,'100 same-frame updates paint once');
  assert.equal(await app.cdp.evaluate('document.getElementById("messages").firstChild===window.oldMessage&&window.oldText===window.oldMessage.firstChild.firstChild&&getSelection().toString()===window.oldSelection'),true);
  assert.equal(await app.cdp.evaluate('Math.abs(document.getElementById("messages").scrollTop-50)<2'),true);
  assert.equal(await app.cdp.evaluate('document.getElementById("latest").hidden'),false);
  await app.cdp.evaluate('document.getElementById("latest").click()');assert.equal(await app.cdp.evaluate('document.getElementById("latest").hidden'),true);
  // Render a realistic answer and reject hostile content at the renderer boundary.
  await app.cdp.evaluate('window.fixtureRich='+JSON.stringify(collected.rich));
  await app.cdp.evaluate('turns=[{id:"rich-ui",role:"assistant",text:"Rich reply",rich:window.fixtureRich}];render()');await painted();
  assert.equal(await app.cdp.evaluate('document.querySelectorAll("#messages h2,#messages strong,#messages ol,#messages table,#messages math").length'),5);
  assert.equal(await app.cdp.evaluate('document.querySelector("#messages math").namespaceURI'),'http://www.w3.org/1998/Math/MathML');
  assert.equal(await app.cdp.evaluate('document.querySelector("#messages ol").getAttribute("start")'),'3');
  await app.cdp.evaluate(`(()=>{const root=document.createElement('div');root.id='unsafeFixture';document.body.append(root);LocalChatRich.patch(root,[['script',{},['window.__bad=true']],['img',{src:'x',onerror:'window.__bad=true'},[]],['a',{href:'javascript:alert(1)',onclick:'alert(1)',style:'position:fixed'},['safe text']],['p',{},['<img src=x onerror=alert(1)>']]]);})()`);
  assert.equal(await app.cdp.evaluate('!!document.querySelector("#unsafeFixture script,#unsafeFixture img,#unsafeFixture [onclick],#unsafeFixture [style],#unsafeFixture [href]")'),false);
  await app.cdp.evaluate('document.getElementById("unsafeFixture").remove()');
  // Send placement is a one-time anchor. Neither generation nor manually reaching the bottom re-arms auto-scroll.
  await app.cdp.evaluate('turns=Array.from({length:12},(_,i)=>({id:"old-"+i,role:i%2?"assistant":"user",text:"Earlier message ".repeat(25)}));turns.push({id:"this-question",role:"user",text:"Explain the formula"});anchorQuestion("this-question")');await painted();
  const pinned=await app.cdp.evaluate('document.getElementById("messages").scrollTop');assert.ok(pinned>0);
  assert.equal(await app.cdp.evaluate('Math.abs(messageNodes.get("this-question").getBoundingClientRect().top-document.getElementById("messages").getBoundingClientRect().top-10)<2'),true);
  for(let i=1;i<=8;i++){await app.cdp.evaluate('receiveTurns({type:"patch",turns:[{id:"this-answer",role:"assistant",text:'+JSON.stringify('New streamed paragraph. '.repeat(i*35))+',rich:[["p",{},['+JSON.stringify('New streamed paragraph. '.repeat(i*35))+']]]}]})');await painted();assert.ok(Math.abs(await app.cdp.evaluate('document.getElementById("messages").scrollTop')-pinned)<2,'generation does not scroll');}
  await app.cdp.evaluate('document.getElementById("messages").scrollTop+=120;document.getElementById("messages").dispatchEvent(new Event("scroll"))');
  const manual=await app.cdp.evaluate('document.getElementById("messages").scrollTop');
  await app.cdp.evaluate('receiveTurns({type:"patch",turns:[{id:"this-answer",role:"assistant",text:"More content ".repeat(1200)}]})');await painted();assert.ok(Math.abs(await app.cdp.evaluate('document.getElementById("messages").scrollTop')-manual)<2);
  await app.cdp.evaluate('document.getElementById("latest").click()');const bottom=await app.cdp.evaluate('document.getElementById("messages").scrollTop');
  await app.cdp.evaluate('receiveTurns({type:"patch",turns:[{id:"this-answer",role:"assistant",text:"More content ".repeat(1800)}]})');await painted();assert.ok(Math.abs(await app.cdp.evaluate('document.getElementById("messages").scrollTop')-bottom)<2,'explicit jump remains a one-time action');
  // Question rail stays narrow; expanded summaries navigate without enabling follow-scroll.
  assert.equal(await app.cdp.evaluate('document.querySelectorAll("#questionList button").length'),7);
  const readingWidth=await app.cdp.evaluate('document.getElementById("messages").clientWidth');
  await app.cdp.evaluate('document.getElementById("questionNavToggle").click()');
  assert.equal(await app.cdp.evaluate('document.getElementById("questionNavToggle").getAttribute("aria-expanded")'),'true');
  assert.equal(await app.cdp.evaluate('document.getElementById("messages").clientWidth'),readingWidth,'opening the index does not reflow the reply');
  await app.cdp.evaluate('document.getElementById("questionList").children[2].click()');await painted();
  assert.equal(await app.cdp.evaluate('document.getElementById("questionNavToggle").getAttribute("aria-expanded")'),'false');
  assert.equal(await app.cdp.evaluate('Math.abs(messageNodes.get("old-4").getBoundingClientRect().top-document.getElementById("messages").getBoundingClientRect().top-10)<2'),true);
  assert.equal(await app.cdp.evaluate('document.getElementById("questionList").children[2].getAttribute("aria-current")'),'location');
  const navScroll=await app.cdp.evaluate('document.getElementById("messages").scrollTop');
  await app.cdp.evaluate('window.savedQuestionLink=document.getElementById("questionList").children[2];receiveTurns({type:"patch",turns:[{id:"this-answer",role:"assistant",text:"Longer answer ".repeat(2400)}]})');await painted();
  assert.equal(await app.cdp.evaluate('document.getElementById("questionList").children[2]===window.savedQuestionLink'),true);
  assert.ok(Math.abs(await app.cdp.evaluate('document.getElementById("messages").scrollTop')-navScroll)<2);
  assert.equal(await app.cdp.evaluate('(()=>{const q=getComputedStyle(document.querySelector(".message.user"));return q.backgroundColor!==getComputedStyle(document.body).backgroundColor&&parseInt(q.fontWeight)>=500&&parseInt(q.borderLeftWidth)>=3})()'),true,'question styling is distinct from the reply');
  await app.cdp.evaluate('turns=[{id:"duplicate-a",role:"user",text:"Same question"},{id:"reply-a",role:"assistant",text:"Answer ".repeat(100)},{id:"pending-nav",role:"user",text:"Same question"}];pendingUser="pending-nav";anchorQuestion("pending-nav")');await painted();
  assert.equal(await app.cdp.evaluate('document.querySelectorAll("#questionList button").length'),2,'identical questions keep separate navigation entries');
  await app.cdp.evaluate('receiveTurns({type:"snapshot",turns:[{id:"duplicate-a",role:"user",text:"Same question"},{id:"reply-a",role:"assistant",text:"Answer ".repeat(100)},{id:"confirmed-nav",role:"user",text:"Same question"}]})');await painted();
  assert.equal(await app.cdp.evaluate('document.querySelectorAll("#questionList button").length'),2,'acknowledgment replaces the pending entry');
  assert.equal(await app.cdp.evaluate('document.getElementById("questionList").lastChild.getAttribute("aria-controls")'), 'message-confirmed-nav');
  // Explicit theme overrides and live Zotero theme changes must stay independent.
  await until(()=>appearanceClients.size>0);emitTheme('dark');await app.cdp.evaluate("document.querySelector('[data-theme-choice=zotero]').click()");
  await until(()=>app.cdp.evaluate("getComputedStyle(document.body).backgroundColor==='rgb(33, 33, 33)'"));
  await app.cdp.evaluate("document.querySelector('[data-theme-choice=light]').click();document.documentElement.dataset.zoteroTheme='light'");
  assert.equal(await app.cdp.evaluate("getComputedStyle(document.body).backgroundColor"),'rgb(255, 255, 255)');
  await app.cdp.evaluate("document.querySelector('[data-theme-choice=dark]').click()");
  await app.cdp.call('Page.reload');await until(()=>app.cdp.evaluate("!!document.getElementById('send')&&!document.getElementById('send').disabled"));
  assert.equal(await app.cdp.evaluate("document.documentElement.dataset.theme"),'dark','theme survives reload');
  await app.cdp.evaluate("document.documentElement.dataset.zoteroTheme='light';document.querySelector('[data-theme-choice=zotero]').click()");
  await until(()=>app.cdp.evaluate("document.documentElement.dataset.theme==='light'"));
  await until(()=>appearanceClients.size>0);emitTheme('dark');
  await until(()=>app.cdp.evaluate("document.documentElement.dataset.theme==='dark'"));
  await app.cdp.evaluate("document.getElementById('appearance').click()");
  assert.equal(await app.cdp.evaluate("document.getElementById('appearanceMenu').hidden"),false);
  assert.equal(uiSends,0,'appearance settings do not send a message');
  await app.cdp.evaluate("document.getElementById('appearance').click()");
  // Narrow sidebar plus maximum text zoom keeps composer controls within the viewport.
  await app.cdp.call('Emulation.setDeviceMetricsOverride',{width:320,height:360,deviceScaleFactor:1,mobile:false});
  await app.cdp.evaluate('setZoom(1.6)');await wait(50);
  assert.equal(await app.cdp.evaluate('document.documentElement.scrollWidth<=innerWidth&&document.getElementById("power").getBoundingClientRect().right<=innerWidth&&document.getElementById("composer").getBoundingClientRect().bottom<=innerHeight'),true);
  for(const [width,height]of [[280,360],[360,600],[640,1000]]){
    await app.cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await wait(50);
    const bounds=await app.cdp.evaluate("({width:innerWidth,height:innerHeight,body:document.body.scrollHeight,scrollWidth:document.documentElement.scrollWidth,send:document.getElementById('send').getBoundingClientRect().right,bottom:document.getElementById('composer').getBoundingClientRect().bottom,font:getComputedStyle(document.body).fontSize})");
    assert.ok(bounds.scrollWidth<=width&&bounds.body<=height+1&&bounds.send<=width&&bounds.bottom<=height,JSON.stringify(bounds));
    assert.equal(bounds.font,'24px','resizing reflows without changing the chosen font scale');
  }
  await app.cdp.call('Emulation.setDeviceMetricsOverride',{width:320,height:560,deviceScaleFactor:1,mobile:false});
  await app.cdp.evaluate('setZoom(1);turns=[];render()');
  await app.cdp.evaluate('(()=>{const dt=new DataTransfer();dt.items.add(new File(["synthetic content"],"extra.txt",{type:"text/plain"}));document.dispatchEvent(new DragEvent("drop",{dataTransfer:dt,bubbles:true,cancelable:true}));})()');await until(()=>app.cdp.evaluate('document.getElementById("files").children.length===1&&!document.getElementById("send").disabled'));
  assert.equal(await app.cdp.evaluate('document.getElementById("files").textContent'),'extra.txt ×');assert.equal(uiSends,0,'drop alone does not send');
  sendHolds=[];
  await app.cdp.evaluate('document.getElementById("prompt").value="hello";document.getElementById("prompt").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
  await until(()=>sendHolds.length===1);assert.equal(await app.cdp.evaluate('document.getElementById("prompt").value'),'','composer clears before any server response');
  await until(()=>app.cdp.evaluate('document.querySelector(".message.user[data-pending]")?.textContent==="hello"'));
  // Even an identical next draft must survive completion of the previous send.
  await app.cdp.evaluate('document.getElementById("prompt").value="hello";document.getElementById("prompt").dispatchEvent(new Event("input"))');
  sendHolds.shift()();sendHolds=null;await until(()=>app.cdp.evaluate('document.getElementById("messages").textContent.includes("Final only")&&!busy'));
  assert.equal(await app.cdp.evaluate('document.getElementById("prompt").value'),'hello');
  assert.equal(await app.cdp.evaluate('localStorage.getItem("localchat-draft:fixture-ui:pending")'),null);
  await app.cdp.evaluate('document.getElementById("prompt").value="";document.getElementById("prompt").dispatchEvent(new Event("input"))');
  if(process.env.LOCALCHAT_SCREENSHOT){await app.cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await app.cdp.evaluate('document.getElementById("powerToggle").click()');fs.writeFileSync(process.env.LOCALCHAT_SCREENSHOT,Buffer.from((await app.cdp.call('Page.captureScreenshot',{format:'png'})).data,'base64'));await app.cdp.evaluate('closePickers()');}
  assert.equal(uiSends,1);assert.deepEqual(uiFiles,['file-one']);assert.match(await app.cdp.evaluate('document.getElementById("messages").textContent'),/Final only/);assert.equal(await app.cdp.evaluate('document.getElementById("prompt").value'),'');

  sendFailure=true;sendHolds=[];
  await app.cdp.evaluate('document.getElementById("prompt").value="recover this";document.getElementById("composer").requestSubmit()');await until(()=>sendHolds.length===1);
  assert.equal(await app.cdp.evaluate('document.getElementById("prompt").value'),'');sendHolds.shift()();sendHolds=null;
  await until(()=>app.cdp.evaluate('!busy&&!ready'));assert.equal(await app.cdp.evaluate('document.getElementById("prompt").value'),'recover this','failure restores an empty composer');
  assert.equal(await app.cdp.evaluate('localStorage.getItem("localchat-draft:fixture-ui:pending")'),'recover this');
  await app.cdp.evaluate('document.getElementById("reconnect").click()');await until(()=>app.cdp.evaluate('ready&&!busy'));assert.equal(uiSends,2,'recovery does not send again');
  sendFailure=true;sendHolds=[];
  await app.cdp.evaluate('document.getElementById("prompt").value="failed original";document.getElementById("composer").requestSubmit()');await until(()=>sendHolds.length===1);
  await app.cdp.evaluate('document.getElementById("prompt").value="new draft";document.getElementById("prompt").dispatchEvent(new Event("input"))');sendHolds.shift()();sendHolds=null;
  await until(()=>app.cdp.evaluate('!busy&&!ready'));assert.equal(await app.cdp.evaluate('document.getElementById("prompt").value'),'new draft','failure never replaces a newer draft');
  assert.equal(await app.cdp.evaluate('localStorage.getItem("localchat-draft:fixture-ui:pending")'),'failed original');

});
