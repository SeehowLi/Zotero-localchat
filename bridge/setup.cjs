const fs=require('node:fs'),path=require('node:path');
class Setup {
  constructor(runtime,host,app,sessions){this.file=path.join(runtime,'settings.json');this.host=host;this.app=app;this.sessions=sessions;this.project=null;if(fs.existsSync(this.file))this.project=JSON.parse(fs.readFileSync(this.file,'utf8')).project||null;}
  async status(){
    const state=await this.host.inspect(),legacy=!this.project&&Object.keys(this.sessions.bindings).length>0;
    const project=this.project||(legacy?'Paper':state.projects.includes('zotero-paper')?'zotero-paper':state.projects.includes('Paper')?'Paper':'zotero-paper');
    const exists=state.projects.filter(name=>name===project).length===1;
    return {...state,launchLabel:this.host.launchLabel?.()||'ChatGPT - Local Chat 快捷方式',project,ready:state.debugReady&&exists&&!!(this.project||legacy),legacy};
  }
  async select(project){
    if(typeof project!=='string'||!project.trim()||project.trim().length>100||/[\x00-\x1f]/.test(project))throw Error('请输入 1–100 个字符的项目名称');project=project.trim();
    const previous=this.project||(Object.keys(this.sessions.bindings).length?'Paper':null);
    if(previous&&previous!==project&&Object.keys(this.sessions.bindings).length)throw Error('已有论文对话关联，请继续使用原项目：'+previous);
    const state=await this.host.inspect();if(!state.debugReady)throw Error('请先从'+(this.host.launchLabel?.()||'ChatGPT - Local Chat 快捷方式')+'打开 App');
    if(state.projects.filter(name=>name===project).length!==1)throw Error('未找到唯一的同名项目。请在 App 的 ChatGPT 聊天项目中创建或展开它，然后重新检查。');
    await this.app.setProject(project);fs.writeFileSync(this.file,JSON.stringify({project},null,2),'utf8');this.project=project;return{ready:true,project};
  }
  async prepare(){const state=await this.status();if(!state.ready)throw Error('请先完成侧栏中的首次使用设置');if(!this.project)await this.select(state.project);else await this.app.setProject(this.project);return state;}
}
module.exports=Setup;
