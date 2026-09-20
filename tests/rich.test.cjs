const test=require('node:test'),assert=require('node:assert/strict'),Rich=require('../bridge/rich.js');
test('stream patches keep unchanged history out of the payload and preserve its object identity',()=>{
  const before=Array.from({length:80},(_,i)=>({id:'turn-'+i,role:i%2?'assistant':'user',text:'history '.repeat(600)}));
  const diff=Rich.differ();diff(before);
  const after=[...before.slice(0,-1),{...before.at(-1),text:'new tokens'}],patch={type:'patch',...diff(after)};
  assert.equal(patch.turns.length,1);assert.equal(patch.order,undefined);
  const next=Rich.apply(before,patch);assert.equal(next[0],before[0]);assert.equal(next.at(-1).text,'new tokens');
  const fullBytes=Buffer.byteLength(JSON.stringify({type:'snapshot',turns:after})),patchBytes=Buffer.byteLength(JSON.stringify(patch));
  assert.ok(patchBytes<fullBytes/100);console.log(JSON.stringify({source:'synthetic 80-message history',fullBytes,patchBytes}));
  const removed={type:'patch',...diff(after.slice(1))};assert.equal(Rich.apply(next,removed)[0].id,'turn-1');
});
