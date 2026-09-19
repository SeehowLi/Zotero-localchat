const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class Uploads {
  constructor(runtime){this.root=path.join(runtime,'uploads');fs.mkdirSync(this.root,{recursive:true});this.items=new Map();this.reserved=0;this.limit=128*1024*1024;for(const name of fs.readdirSync(this.root)){const p=path.join(this.root,name);if(/^[a-f0-9]{32}$/.test(name)&&fs.statSync(p).isDirectory()&&Date.now()-fs.statSync(p).mtimeMs>86400000)fs.rmSync(p,{recursive:true});}}
  async add(context,name,req){
    if(typeof name!=='string'||!name.trim()||name.length>180||/[\\/:*?"<>|\x00-\x1f]/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)||/[. ]$/.test(name))throw Error('文件名无效');
    const size=Number(req.headers['content-length']);if(!Number.isSafeInteger(size)||size<1||size>64*1024*1024||this.reserved+size>this.limit)throw Error('单个文件最多 64 MB，待发送文件合计最多 128 MB');
    if([...this.items.values()].filter(x=>x.context===context).length>=8)throw Error('每次最多添加 8 个文件');
    const id=crypto.randomBytes(16).toString('hex'),dir=path.join(this.root,id),file=path.join(dir,name);fs.mkdirSync(dir);this.reserved+=size;this.items.set(id,{context,name,size,file,dir,pending:true});let handle,received=0;
    try{handle=await fs.promises.open(file,'wx');for await(const chunk of req){received+=chunk.length;if(received>size)throw Error('文件大小不一致');await handle.writeFile(chunk);}if(received!==size)throw Error('文件传输未完成');this.items.get(id).pending=false;return{id,name,size};}
    catch(e){await handle?.close();handle=null;this.remove(context,id);throw e;}finally{await handle?.close();}
  }
  get(context,ids){if(!Array.isArray(ids)||ids.length>8||new Set(ids).size!==ids.length)throw Error('附件列表无效');return ids.map(id=>{const x=this.items.get(id);if(!x||x.context!==context||x.pending)throw Error('附件已过期，请重新添加');return x.file;});}
  remove(context,id){const x=this.items.get(id);if(!x||x.context!==context)return;fs.rmSync(x.dir,{recursive:true,force:true});this.items.delete(id);this.reserved-=x.size;}
}
module.exports=Uploads;
