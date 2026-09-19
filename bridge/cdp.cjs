// Small localhost-only CDP client. No cookies, credentials, or response bodies are logged.
const {EventEmitter}=require('node:events');
class CDP extends EventEmitter {
  constructor(){super();this.next=0;this.pending=new Map();}
  static async targets(port=23129){
    if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local debug port');
    const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1500)});
    if(!r.ok)throw Error('App 调试连接不可用');
    return (await r.json()).filter(t=>t.type==='page'&&/^app:\/\//.test(t.url));
  }
  async connect(url){
    const u=new URL(url);if(u.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('Only localhost CDP is allowed');
    const ws=this.ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('App 调试连接失败')),{once:true});});
    ws.addEventListener('message',e=>{let m;try{m=JSON.parse(e.data);}catch{return;}
      if(m.id){const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}
      else this.emit(m.method,m.params);
    });
    ws.addEventListener('close',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('App 连接中断；未自动重复操作。'));}this.pending.clear();this.emit('disconnected');});
  }
  call(method,params={}){return new Promise((resolve,reject)=>{if(this.ws?.readyState!==WebSocket.OPEN)return reject(Error('App 尚未连接'));const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('App 页面操作超时；未自动重试。'));},10000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
  async evaluate(expression){const r=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text).split('\n')[0].replace(/^Error: /,''));return r.result?.value;}
  close(){this.ws?.close();}
}
module.exports=CDP;
