const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const runtime=require('./runtime.cjs')(),Host=require('./host.cjs'),App=require('./app-stream.cjs'),Sessions=require('./event-sessions.cjs'),Uploads=require('./uploads.cjs');
const host=new Host(runtime),app=new App(host),sessions=new Sessions(runtime,app),setup=new(require('./setup.cjs'))(runtime,host,app,sessions),uploads=new Uploads(runtime),token=crypto.randomBytes(32).toString('hex');
const index=process.argv.indexOf('--port'),port=index<0?23128:Number(process.argv[index+1]);let origin,stopped=false;const appearanceClients=new Map();
const reply=(res,status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
function authorized(req){const supplied=Buffer.from(String(req.headers['x-mirror-token']||''));return supplied.length===64&&crypto.timingSafeEqual(supplied,Buffer.from(token))&&(!req.headers.origin||req.headers.origin===origin)&&(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']));}
async function body(req){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>80000)throw Error('请求过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
const server=http.createServer(async(req,res)=>{try{
  if(req.headers.host!==new URL(origin).host)return reply(res,403,{error:'Host rejected'});
  const url=new URL(req.url,origin),route=url.pathname;
  const asset={'/':'index.html','/client.js':'client.js','/style.css':'style.css','/stream.js':'stream.js','/rich.js':'rich.js'}[route];
  if(req.method==='GET'&&asset)return reply(res,200,fs.readFileSync(path.join(__dirname,asset)),asset.endsWith('.js')?'text/javascript; charset=utf-8':asset.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  if(!authorized(req))return reply(res,403,{error:'连接凭据已更新，请在 Zotero 点击“当前论文”重新打开'});
  if(req.method==='GET'){
    if(route==='/api/setup')return reply(res,200,await setup.status());
    if(route==='/api/appearance-stream'){
      const id=url.searchParams.get('id'),p=sessions.context(id);
      res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'});res.flushHeaders();
      const clients=appearanceClients.get(id)||new Set();appearanceClients.set(id,clients);clients.add(res);
      if(p.zoteroTheme)res.write(JSON.stringify({type:'theme',theme:p.zoteroTheme})+'\n');
      res.on('close',()=>{clients.delete(res);if(!clients.size)appearanceClients.delete(id);});return;
    }
    if(route==='/api/status')return reply(res,200,{version:'0.4.10',busy:sessions.busy,streamReady:app.cdp.ws?.readyState===1});
    if(route==='/api/context')return reply(res,200,sessions.info(url.searchParams.get('id')));
    if(route==='/api/transcript')return reply(res,200,sessions.transcript(url.searchParams.get('id')));
  }
  if(req.method!=='POST')return reply(res,404,{error:'Not found'});
  if(route==='/api/upload'){const id=url.searchParams.get('id');sessions.context(id);return reply(res,200,await uploads.add(id,url.searchParams.get('name'),req));}
  const b=await body(req);
  if(route==='/api/context')return reply(res,200,sessions.register(b));
  if(route==='/api/appearance'){
    const p=sessions.context(b.id);if(!['light','dark'].includes(b.theme))throw Error('Invalid theme');p.zoteroTheme=b.theme;
    for(const client of appearanceClients.get(b.id)||[])if(!client.destroyed)client.write(JSON.stringify({type:'theme',theme:b.theme})+'\n');
    return reply(res,200,{ok:true});
  }
  if(route==='/api/stop'){if(sessions.busy)throw Error('聊天仍在进行');reply(res,200,{ok:true});setTimeout(shutdown,100);return;}
  if(route==='/api/setup/project')return reply(res,200,await sessions.exclusive(()=>setup.select(b.project)));
  if(route==='/api/setup/open-app')return reply(res,200,await sessions.exclusive(()=>host.openApp()));
  if(route==='/api/reconnect'){const state=await sessions.exclusive(async()=>{const state=await setup.prepare();await app.ensure();return state;});return reply(res,200,{ok:true,project:state.project});}
  if(route==='/api/upload/remove'){uploads.remove(b.id,b.file);return reply(res,200,{ok:true});}
  if(route==='/api/session/open')return reply(res,200,await sessions.open(b.id));
  if(route==='/api/session/model')return reply(res,200,await sessions.model(b.id));
  if(route==='/api/session/config')return reply(res,200,await sessions.config(b.id,b));
  if(route==='/api/session/recover')return reply(res,200,await sessions.recover(b.id));
  if(route==='/api/session/send-stream'){
    const ids=b.files||[],files=uploads.get(b.id,ids);
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.flushHeaders();
    const emit=e=>{if(!res.destroyed)res.write(JSON.stringify(e)+'\n');};emit({type:'phase',text:'正在提交…'});
    try{const info=await sessions.send(b.id,b.text,emit,files);for(const id of ids)uploads.remove(b.id,id);emit({type:'complete',info});}catch(e){emit({type:'error',error:e.message});}res.end();return;
  }
  reply(res,404,{error:'Not found'});
}catch(e){if(!res.headersSent)reply(res,400,{error:e.message});else res.end();}});
server.requestTimeout=120000;server.headersTimeout=10000;server.maxConnections=24;
function shutdown(){if(stopped)return;stopped=true;app.close().catch(()=>{});server.close();const file=path.join(runtime,'endpoint.json');try{if(JSON.parse(fs.readFileSync(file,'utf8')).pid===process.pid)fs.unlinkSync(file);}catch{}setTimeout(()=>process.exit(0),300).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
server.on('error',e=>{console.error('Local Chat:',e.code);process.exit(1);});
server.listen(port,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;fs.writeFileSync(path.join(runtime,'endpoint.json'),JSON.stringify({url:origin+'/#'+token,pid:process.pid,port:server.address().port}),{encoding:'utf8',mode:0o600});console.log('Zotero-localchat '+origin);});
