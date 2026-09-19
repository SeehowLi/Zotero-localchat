const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
  if(Number(process.versions.node.split('.')[0])<22)throw Error('请安装 Node.js 22 或更新版本');
  const runtime=require('../bridge/runtime.cjs')(),file=path.join(runtime,'endpoint.json');let endpoint;
  try{endpoint=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  if(endpoint){const u=new URL(endpoint.url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!/^#[a-f0-9]{64}$/.test(u.hash))throw Error('本地连接地址无效');const headers={'X-Mirror-Token':u.hash.slice(1),'Content-Type':'application/json'};let r;try{r=await fetch(u.origin+'/api/status',{headers,signal:AbortSignal.timeout(1500)});}catch(e){if(e.cause?.code!=='ECONNREFUSED')throw e;}if(r){if(!r.ok)throw Error('已有服务状态未确认');if(process.argv.includes('--stop')){const stopped=await fetch(u.origin+'/api/stop',{method:'POST',headers,body:'{}'});if(!stopped.ok)throw Error((await stopped.json()).error);console.log('Local Chat 已停止');return;}console.log('Local Chat 已运行，在 Zotero 点击“当前论文”即可。');return;}}
  if(process.argv.includes('--stop')){console.log('Local Chat 未运行');return;}
  if(!fs.existsSync(path.join(__dirname,'../bin/LocalChatWindow.exe')))throw Error('请先运行 scripts/build-native.ps1，或使用 Windows 发布包');
  const child=spawn(process.execPath,[path.join(__dirname,'../bridge/server.cjs')],{detached:true,windowsHide:true,stdio:'ignore'});child.unref();
  for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));try{const e=JSON.parse(fs.readFileSync(file,'utf8'));if(e.pid===child.pid){console.log('Local Chat 已启动，在 Zotero 点击“当前论文”即可。');return;}}catch{}}
  throw Error('无法启动本机服务，请检查端口 23128 是否占用');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
