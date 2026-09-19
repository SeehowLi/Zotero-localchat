const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('reader render and toolbar opening share one context and do not reload a working sidebar',async()=>{
  const sandbox={URL,Services:{io:{newURI:spec=>({spec})},scriptSecurityManager:{getSystemPrincipal:()=>({})}},Zotero:{initializationPromise:Promise.resolve(),ItemPaneManager:{registerSection:()=>1},Reader:{registerEventListener(){}},getMainWindows:()=>[],logError:()=>{}}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../addon/bootstrap.js'),'utf8'),sandbox);await sandbox.startup({rootURI:'file:///test/'});
  const m=sandbox.Mirror;let generation=1,registered=0,loaded=0;
  m.endpoint=async()=>new URL('http://127.0.0.1:23128/#token-'+generation);
  const p={paper:{key:'fixture',title:'Fixture'},win:{fetch:async()=>{registered++;await new Promise(r=>setTimeout(r,20));return{ok:true,json:async()=>({id:'context-'+registered})};}},browser:{currentURI:{spec:''},loadURI(uri){loaded++;this.currentURI=uri;}},view:{},status:{}};
  await Promise.all([m.open(p,'blank'),m.open(p,'blank')]);assert.equal(registered,1);assert.equal(loaded,1);
  await m.open(p,'blank');assert.equal(loaded,1,'reopening preserves the active document and draft');
  generation++;await m.open(p,'blank');assert.equal(registered,2);assert.equal(loaded,2,'a new service token refreshes the context');
});
