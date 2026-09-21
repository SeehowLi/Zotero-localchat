const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class Sessions {
  constructor(runtime){this.file=path.join(runtime,'papers.json');this.contexts=new Map();this.busy=false;this.prepared=null;this.bindings=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{};}
  save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.bindings,null,2),'utf8');fs.renameSync(this.file+'.tmp',this.file);}
  register(p){if(!p||!['paper','blank'].includes(p.mode))throw Error('Invalid context');if(p.mode==='paper'&&(typeof p.key!=='string'||!p.key||p.key.length>200||typeof p.title!=='string'||!p.title||p.title.length>500||typeof p.pdfPath!=='string'||!path.isAbsolute(p.pdfPath)||!p.pdfPath.toLowerCase().endsWith('.pdf')))throw Error('请打开有本地 PDF 的论文');const id=crypto.randomBytes(16).toString('hex');this.contexts.set(id,{...p,key:p.mode==='paper'?'paper:'+p.key:'blank:'+id,title:p.mode==='paper'?p.title:'空白聊天'});return{id,...this.info(id)};}
  context(id){const p=this.contexts.get(id);if(!p)throw Error('阅读上下文已过期，请重新打开侧栏');return p;}
  info(id){const p=this.context(id),b=this.bindings[p.key];return{draftKey:p.key,mode:p.mode,title:p.title,excerpt:p.excerpt||'',binding:b?.title||null,uploaded:!!b?.uploaded,reused:!!b?.reused,phase:b?.phase||'idle'};}
  async exclusive(fn){if(this.busy)throw Error('正在处理另一个聊天操作，请稍候');this.busy=true;try{return await fn();}finally{this.busy=false;}}
  open(id){return this.exclusive(async()=>{await this.prepare(id);return this.info(id);});}
}
module.exports=Sessions;
