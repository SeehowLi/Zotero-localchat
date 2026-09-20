const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('reader render and toolbar opening share one context and do not reload a working sidebar',async()=>{
  const sandbox={URL,Services:{io:{newURI:spec=>({spec})},scriptSecurityManager:{getSystemPrincipal:()=>({})}},Zotero:{initializationPromise:Promise.resolve(),ItemPaneManager:{registerSection:()=>1},Reader:{registerEventListener(){}},getMainWindows:()=>[],logError:()=>{}}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../addon/bootstrap.js'),'utf8'),sandbox);await sandbox.startup({rootURI:'file:///test/'});
  const m=sandbox.Mirror;let generation=1,registered=0,loaded=0;
  m.endpoint=async()=>new URL('http://127.0.0.1:23128/#token-'+generation);
  const p={paper:{key:'fixture',title:'Fixture'},win:{matchMedia:()=>({matches:false}),fetch:async(route)=>{if(route.endsWith('/api/appearance'))return {ok:true};registered++;await new Promise(r=>setTimeout(r,20));return{ok:true,json:async()=>({id:'context-'+registered})};}},browser:{currentURI:{spec:''},loadURI(uri){loaded++;this.currentURI=uri;}},view:{},status:{}};
  await Promise.all([m.open(p,'blank'),m.open(p,'blank')]);assert.equal(registered,1);assert.equal(loaded,1);
  await m.open(p,'blank');assert.equal(loaded,1,'reopening preserves the active document and draft');
  generation++;await m.open(p,'blank');assert.equal(registered,2);assert.equal(loaded,2,'a new service token refreshes the context');
});
test('independent sidebar restores native information and cleans up listeners and tab observer',async()=>{
  const listeners=new Map(),reader={itemID:42},attributes=new Map(),nodes=[];let opened=0,unregistered=0;
  const element=()=>({setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},append(){},prepend(){},remove(){this.removed=true;}});
  const context={...element(),setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k)},sidenav={insertBefore(){},querySelector:()=>({})};
  const doc={documentElement:element(),querySelector:()=>context,getElementById:()=>sidenav,createElementNS:()=>{const n=element();nodes.push(n);return n;},createXULElement:element};
  const media={matches:false,addEventListener(){},removeEventListener(){}};
  const win={document:doc,matchMedia:()=>media,Zotero_Tabs:{selectedID:'paper'},addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{assert.equal(listeners.get(type),fn);listeners.delete(type);}};
  const sandbox={URL,Services:{},Zotero:{initializationPromise:Promise.resolve(),Reader:{registerEventListener(){},getByTabID:id=>id==='paper'?reader:null},Notifier:{registerObserver:()=>17,unregisterObserver:id=>{assert.equal(id,17);unregistered++;}},getMainWindows:()=>[win],logError:e=>{throw e;}}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../addon/bootstrap.js'),'utf8'),sandbox);await sandbox.startup({rootURI:'file:///test/'});
  sandbox.Mirror.show=async r=>{assert.equal(r,reader);opened++;};
  const state=sandbox.Mirror.windows.get(win);state.button.onclick();assert.equal(opened,1);
  state.open=true;context.setAttribute('data-localchat-open','true');
  listeners.get('click')({button:0,target:{closest:()=>({closest:()=>sidenav})}});
  assert.equal(state.open,false,'native metadata click restores its own panel');assert.equal(attributes.has('data-localchat-open'),false);
  for(const theme of ['light','dark']){const png=fs.readFileSync(path.join(__dirname,`../addon/icon-20-${theme}.png`));assert.equal(png.readUInt32BE(16),20);}
  sandbox.onMainWindowUnload({window:win});assert.equal(listeners.size,0);assert.equal(unregistered,1);assert.ok(state.host.removed&&state.button.removed&&state.style.removed);
});
