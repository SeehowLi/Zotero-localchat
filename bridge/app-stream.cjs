const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events'),CDP=require('./cdp.cjs');
class AppStream extends EventEmitter {
  constructor(host){super();this.host=host;this.cdp=new CDP();this.state=null;this.generation=0;this.aliases=new Map();}
  async connect(target){
    if(target.type!=='page'||!/^app:\/\//.test(target.url))throw Error('只能连接现有 App 页面');
    await this.cdp.connect(target.webSocketDebuggerUrl);
    await this.cdp.call("Emulation.setFocusEmulationEnabled",{enabled:true});
    await this.observe();
  }
  async ensure(allowCreate=true){if(this.cdp.ws?.readyState===1)return;if(!this.host)throw Error("App 未连接");if(!this.connecting)this.connecting=(async()=>{this.cdp.removeAllListeners();this.cdp=new CDP();await this.connect(await this.host.target(allowCreate));for(let i=0;i<60;i++){if(await this.cdp.evaluate('!!document.querySelector("[data-app-action-sidebar-project-label]")'))return;await new Promise(r=>setTimeout(r,500));}throw Error("App 仍在加载，请稍后点击重连");})().finally(()=>{this.connecting=null;});return this.connecting;}
  async observe(){
    this.cdp.on('Runtime.bindingCalled',e=>{if(e.name!=='__paperChatChanged')return;try{const s=this.identify(JSON.parse(e.payload));this.state=s;this.emit('snapshot',s);}catch{}});
    this.cdp.on('disconnected',()=>{this.state=null;this.emit('disconnected');});
    const script=fs.readFileSync(path.join(__dirname,'app-observer.js'),'utf8');
    await this.cdp.call('Runtime.enable');await this.cdp.call('Page.enable');
    await this.cdp.call('Runtime.addBinding',{name:'__paperChatChanged'});
    await this.cdp.evaluate('globalThis.__paperChatObserver?.stop()');
    this.scriptId=(await this.cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:script})).identifier;
    await this.cdp.evaluate(script);this.state=await this.read();
  }
  identify(s){if(this.aliases.has(s.threadId))s={...s,threadId:this.aliases.get(s.threadId)};return s;}
  alias(local,id){this.aliases.set(local,id);if(this.state)this.state=this.identify(this.state);}
  async read(){return this.identify(await this.cdp.evaluate('globalThis.__paperChatObserver.read()'));}
  command(name,...args){if(!['open','click','models','read','focusEditor','send','rename'].includes(name))throw Error('Unsupported App command');if(name==='click')return this.click(args[0]);return this.cdp.evaluate(`globalThis.__paperChatObserver[${JSON.stringify(name)}](...${JSON.stringify(args)})`);}
  async click(label,selector){const r=await this.cdp.evaluate(`(()=>{const e=globalThis.__paperChatObserver.one(${JSON.stringify(label)},${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await this.cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...r});for(const type of ['mousePressed','mouseReleased'])await this.cdp.call('Input.dispatchMouseEvent',{type,...r,button:'left',clickCount:1});}
  async draft(text){const norm=t=>String(t||'').replace(/\s+/g,' ').trim();if(norm((await this.read()).draft)===norm(text))return;await this.command('focusEditor');await this.cdp.call('Input.insertText',{text});return this.waitFor(s=>norm(s?.draft)===norm(text));}
  submit(text){return this.command('send',text);}
  async key(key,code,keyCode){await this.cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode});await this.cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode});}
  async waitFor(predicate,timeout=10000){
    if(predicate(this.state))return this.state;
    return new Promise((resolve,reject)=>{const done=(e,s)=>{clearTimeout(timer);this.off('snapshot',update);this.off('disconnected',closed);e?reject(e):resolve(s);};const update=s=>{if(predicate(s))done(null,s);},closed=()=>done(Error('App 连接中断'));const timer=setTimeout(()=>done(Error('App 页面尚未就绪')),timeout);this.on('snapshot',update);this.on('disconnected',closed);});
  }
  async open(threadId,title){if(threadId&&this.state?.threadId===threadId&&this.state.inPaper)return this.state;for(let i=0;i<8;i++){const r=await this.command('open',threadId,title);if(!r?.expanded)break;await new Promise(r=>setTimeout(r,200));}return this.waitFor(s=>s?.inPaper&&(threadId?s.threadId===threadId:s.title===title));}
  async newChat(){const old=await this.read();if(old.newPaper&&!old.draft&&!old.sending&&!old.attachments.length)return old;if(old.draft||old.sending)throw Error('App 有未发送草稿或正在回答，请先处理');await this.cdp.evaluate(`globalThis.__paperChatObserver.one('在 Paper 中开启新聊天').click()`);return this.waitFor(s=>s?.newPaper&&s.threadId!==old.threadId);}
  async attach(file){const filename=path.basename(file),existing=(await this.read()).attachments.find(a=>a.name===filename);if(!existing){const doc=await this.cdp.call('DOM.getDocument',{depth:0}),node=await this.cdp.call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type="file"][aria-label="附加文件"]'});if(!node.nodeId)throw Error('App 未提供文件附件输入框');await this.cdp.call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[file]});}return this.waitFor(s=>s?.attachments.some(a=>a.name===filename&&!/上传失败|无法上传|failed|error/i.test(a.text))&&s.canSend,120000);}
  async rename(title){if(!await this.cdp.evaluate('!!document.querySelector("[role=dialog] input")'))await this.command('rename');await new Promise(r=>setTimeout(r,100));await this.cdp.evaluate('(()=>{const e=document.querySelector("[role=dialog] input");if(!e)throw Error("未找到聊天标题输入框");e.focus();e.select();})()');await this.cdp.call('Input.insertText',{text:title});await this.click('保存','[role="dialog"] button');return this.waitFor(s=>s?.title===title);}
  async menuReady(selector){for(let i=0;i<40;i++){if(await this.cdp.evaluate('!!document.querySelector('+JSON.stringify(selector)+')'))return;await new Promise(r=>setTimeout(r,50));}throw Error('App 模型菜单尚未就绪，请重连后重试');}
  async modelMenu(){await this.key('Escape','Escape',27);await new Promise(r=>setTimeout(r,100));await this.click('选择 ChatGPT 模型');await this.menuReady('[role=menu]');}
  async nativeSettings(choice){return this.cdp.evaluate('globalThis.__paperChatObserver.settings?.('+JSON.stringify(choice||null)+')??null');}
  async models(){const direct=await this.nativeSettings();if(direct)return direct;await this.modelMenu();const {strength,power}=await this.command('models');await this.click('选择模型');await this.menuReady('[role=menuitemradio],[role=radio]');try{const data=await this.command('models');if(!data.models.length)throw Error('App 模型菜单未就绪');return {...data,strength,power};}finally{await this.key('Escape','Escape',27);}}
  async model(name){const direct=await this.nativeSettings({model:name});if(direct)return direct;await this.modelMenu();await this.click('选择模型');await new Promise(r=>setTimeout(r,120));await this.cdp.evaluate('globalThis.__paperChatObserver.one('+JSON.stringify(name)+',"[role=menuitemradio],[role=radio]").click()');await new Promise(r=>setTimeout(r,150));await this.key('Escape','Escape',27);const data=await this.models();if(!data.models.some(m=>m.name===name&&m.selected))throw Error('App 尚未确认模型切换，请重连后检查');return data;}
  async strength(delta,index){const direct=await this.nativeSettings({delta,index});if(direct)return direct;await this.modelMenu();const data=await this.command('models');if(index!==undefined){if(!Number.isInteger(index)||index<0||index>data.power?.max)throw Error('Invalid strength');delta=index-data.power.index;}else if(![-1,1].includes(delta))throw Error('Invalid strength');const key=delta<0?'ArrowLeft':'ArrowRight';for(let i=0;i<Math.abs(delta);i++) await this.cdp.evaluate('globalThis.__paperChatObserver.one("强度","[role=menuitem]").dispatchEvent(new KeyboardEvent("keydown",{key:'+JSON.stringify(key)+',code:'+JSON.stringify(key)+',bubbles:true,cancelable:true}))');await new Promise(r=>setTimeout(r,120));await this.cdp.evaluate('globalThis.__paperChatObserver.one("强度","[role=menuitem]").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true,cancelable:true}))');await new Promise(r=>setTimeout(r,120));return this.models();}
  async close(){try{await this.cdp.evaluate('globalThis.__paperChatObserver?.stop()');if(this.scriptId)await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:this.scriptId});await this.cdp.call('Runtime.removeBinding',{name:'__paperChatChanged'});}finally{this.cdp.close();}}
}
module.exports=AppStream;
if(require.main===module)(async()=>{const targets=await CDP.targets();console.log(JSON.stringify({connected:true,targets:targets.map(t=>({id:t.id,title:t.title,url:t.url.split('?')[0]}))},null,2));})().catch(e=>{console.error('未连接到 App 页面调试端口（127.0.0.1:23129）。需要通过 Enable-App-Bridge.ps1 重新启动 App。');process.exitCode=1;});
