const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile),CDP=require('./cdp.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
class Host {
  constructor(runtime){this.file=path.join(runtime,'host.json');this.helper=path.join(__dirname,'../bin/LocalChatWindow.exe');}
  async native(...args){const r=await execFile(this.helper,args,{windowsHide:true,timeout:10000,encoding:'utf8'});return JSON.parse(r.stdout);}
  async inspect(){
    let targets;try{targets=await CDP.targets();}catch{const r=await execFile('powershell.exe',['-NoProfile','-Command',"[bool](Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)"],{windowsHide:true,timeout:5000,encoding:'utf8'});return{appOpen:r.stdout.trim().toLowerCase()==='true',debugReady:false,projects:[]};}
    const target=targets.find(t=>new URL(t.url).pathname==='/index.html'&&!new URL(t.url).searchParams.has('initialRoute'))||targets[0];
    if(!target)return{appOpen:true,debugReady:false,projects:[]};
    const c=new CDP();try{await c.connect(target.webSocketDebuggerUrl);const projects=await c.evaluate("[...document.querySelectorAll('[data-app-action-sidebar-project-label]')].map(e=>e.getAttribute('data-app-action-sidebar-project-label')).filter(Boolean)");return{appOpen:true,debugReady:true,projects};}finally{c.close();}
  }
  async openApp(){
    let targets=[];try{targets=await CDP.targets();}catch{}
    const main=targets.find(t=>new URL(t.url).pathname==='/index.html'&&!new URL(t.url).searchParams.has('initialRoute'));
    if(main){const c=new CDP();try{await c.connect(main.webSocketDebuggerUrl);await c.call('Page.bringToFront');return{opened:true};}finally{c.close();}}
    await execFile('powershell.exe',['-NoProfile','-Command',"$link=Join-Path ([Environment]::GetFolderPath('Desktop')) 'ChatGPT - Local Chat.lnk'; if(-not(Test-Path -LiteralPath $link)){throw 'Run scripts/Enable-App-Bridge.ps1 first'}; Start-Process -FilePath $link -WindowStyle Normal"],{windowsHide:true,timeout:10000});return{opened:true};
  }
  async target(allowCreate=true){
    const targets=await CDP.targets();let saved;try{saved=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{}
    let target=targets.find(t=>t.id===saved?.targetId);
    if(target){try{const status=await this.native('status',saved.handle,String(saved.pid),saved.started);if(!status.visible)return target;}catch{} }
    if(!target){
      if(!allowCreate)throw Error("后台连接已关闭，请点击重连后再发送；未创建窗口或重复发送");
      const main=targets.find(t=>new URL(t.url).pathname==='/index.html'&&!new URL(t.url).searchParams.has('initialRoute'));
      if(!main)throw Error('请先启动已启用本地连接的 ChatGPT App');
      const control=new CDP();try{
        await control.connect(main.webSocketDebuggerUrl);
        const point=await control.evaluate(`(()=>{const e=document.getElementById('application-menu-trigger-file-menu');if(!e)throw Error('App 菜单未就绪');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        for(const type of ['mousePressed','mouseReleased'])await control.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
        await pause(150);
        await control.evaluate(`(()=>{const e=[...document.querySelectorAll('[role=menuitem]')].find(e=>['新建窗口','New Window'].includes(e.innerText.trim()));if(!e)throw Error('未找到 App 新窗口命令');e.click()})()`);
      }finally{control.close();}
      for(let i=0;i<60;i++){await pause(100);const fresh=(await CDP.targets()).filter(t=>!targets.some(old=>old.id===t.id)&&new URL(t.url).pathname==='/index.html');if(fresh.length===1){target=fresh[0];break;}}
      if(!target)throw Error('后台 App 页面未就绪');
    }
    const control=new CDP();let title;
    try{
      await control.connect(target.webSocketDebuggerUrl);
      for(let i=0;i<50;i++){if(await control.evaluate('!!document.querySelector("[data-app-action-sidebar-project-label]")'))break;await pause(100);}
      title=await control.evaluate('document.title');const marker='LocalChat-'+crypto.randomBytes(12).toString('hex');
      await control.evaluate('document.title='+JSON.stringify(marker));await pause(250);
      const state=await this.native('hide',marker);if(state.visible)throw Error('无法隐藏后台页面');
      fs.writeFileSync(this.file,JSON.stringify({targetId:target.id,...state}),'utf8');return target;
    }finally{if(title!==undefined)await control.evaluate('document.title='+JSON.stringify(title)).catch(()=>{});control.close();}
  }
}
module.exports=Host;
