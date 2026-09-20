// A shared bridge stays alive while at least one attached Zotero process exists.
class Owners {
  constructor(alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}){this.alive=alive;this.pids=new Set();this.managed=false;}
  add(pid){if(!Number.isSafeInteger(pid)||pid<=0||!this.alive(pid))throw Error('Zotero 进程已退出');this.pids.add(pid);this.managed=true;}
  shouldStop(busy){for(const pid of this.pids)if(!this.alive(pid))this.pids.delete(pid);return this.managed&&!this.pids.size&&!busy;}
}
module.exports=Owners;
