const fs=require('node:fs'),path=require('node:path'),Sessions=require('./sessions.cjs');
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
const cloudID=s=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s||'');
class EventSessions extends Sessions {
  constructor(runtime,stream,app=null){
    super(runtime,()=>{throw Error('事件桥不使用桌面模拟输入');},app);this.stream=stream;this.history=new Map();
    stream.on('snapshot',s=>this.remember(s));if(stream.state)this.remember(stream.state);
  }
  remember(s){if(!s.inPaper||!cloudID(s.threadId))return;const prior=this.history.get(s.threadId)?.turns||[];let turns=s.turns;if(turns.every(t=>t.id)){const incoming=new Set(turns.map(t=>t.id));const merged=new Map(prior.filter(t=>t.id&&(!t.id.startsWith('fallback-turn-')||incoming.has(t.id))).map(t=>[t.id,t]));for(const t of turns)merged.set(t.id,t);turns=[...merged.values()].slice(-80);while(turns.length>1&&turns.reduce((n,t)=>n+t.text.length,0)>250000)turns.shift();}this.history.delete(s.threadId);this.history.set(s.threadId,{...s,turns});while(this.history.size>20)this.history.delete(this.history.keys().next().value);}
  async prepare(id,allowCreate=true){
    await this.stream.ensure?.(allowCreate);
    const p=this.context(id),b=this.bindings[p.key];
    if(['uncertain','sending','generating'].includes(b?.phase))throw Error('上次发送尚未确认，请检查原聊天后恢复关联。');
    if(b?.title&&!b.threadId){const s=await this.stream.open(null,b.title);if(cloudID(s.threadId)){b.threadId=s.threadId;this.save();}else if(b.localId===s.threadId)return p;}
    if(b?.threadId){if(b.localId)this.stream.alias(b.localId,b.threadId);await this.stream.open(b.threadId,b.title);return p;}
    if(b?.localId){await this.stream.open(b.localId,b.title);return p;}
    const current=await this.stream.read();
    if(current.newPaper&&(this.prepared===p.key||b?.draftId===current.threadId)){this.prepared=p.key;return p;}
    const draft=await this.stream.newChat();this.prepared=p.key;
    this.bindings[p.key]={...b,draftId:draft.threadId,phase:'idle'};this.save();return p;
  }
  async model(id){return this.exclusive(async()=>{await this.prepare(id);return this.stream.models();});}
  async config(id,choice){return this.exclusive(async()=>{await this.prepare(id);return choice.model?this.stream.model(choice.model):this.stream.strength(choice.delta,choice.index);});}
  async recover(id){return this.exclusive(async()=>{await this.stream.ensure?.();const p=this.context(id),b=this.bindings[p.key];if(!b)throw Error('尚无会话需要恢复');const target=b.threadId||b.localId;if(target)await this.stream.open(target,b.title);const s=await this.stream.read();if(!s.inPaper||target&&s.threadId!==target||!target&&s.localThreadId!==b.draftId)throw Error('无法确认原聊天，未重复发送');const last=s.turns.map(t=>t.role).lastIndexOf('user');if(!b.pendingPrompt||norm(s.turns[last]?.text)!==norm(b.pendingPrompt)||s.sending||!s.turns.slice(last+1).some(t=>t.role==='assistant'&&t.text.trim()))throw Error('原回答尚未完成或发送状态未确认，请稍后重连；未重复发送');if(cloudID(s.threadId))b.threadId=s.threadId;else b.localId=s.threadId;b.phase='ready';b.title=s.title;b.uploaded=p.mode==='paper';delete b.pendingPrompt;this.remember(s);this.save();return this.info(id);});}
  async bind(id,uploaded){return this.exclusive(async()=>{const p=this.context(id),s=await this.stream.read();if(!s.inPaper||!cloudID(s.threadId)||s.draft||s.sending)throw Error('请先打开已完成的 Paper 聊天');this.bindings[p.key]={title:s.title,threadId:s.threadId,uploaded:p.mode==='paper'&&!!uploaded,phase:'ready'};this.save();return this.info(id);});}
  transcript(id){const p=this.context(id),b=this.bindings[p.key];if(!b?.threadId)return{turns:[],unbound:true};const s=this.history.get(b.threadId);return s?{turns:s.turns,generating:s.sending}:{turns:[],mismatch:true};}
  async send(id,text,notify=()=>{},files=[]){return this.exclusive(async()=>{
    if(typeof text!=='string'||!text.trim()||text.length>12000)throw Error('请输入 1–12000 字的问题');
    const p=await this.prepare(id,false),before=await this.stream.read(),first=!(this.bindings[p.key]?.threadId||this.bindings[p.key]?.localId);
    const prompt=first&&p.mode==='paper'?'论文：'+p.title+'\n\n'+text:text;
    if(before.sending||before.draft&&norm(before.draft)!==norm(prompt))throw Error('App 中有其他草稿或正在生成的回答');
    let b=this.bindings[p.key]||{};const needsPDF=p.mode==='paper'&&!b.uploaded;
    if(needsPDF){const stat=fs.statSync(p.pdfPath);if(!stat.isFile()||stat.size>512*1024*1024)throw Error('PDF 不可用或超过 512 MB');}
    const started=Date.now(),oldUsers=before.turns.filter(t=>t.role==='user'),beforeUserId=oldUsers.at(-1)?.id;
    let submitted=false,settle=()=>{};
    try{
      await this.stream.draft(prompt);
      if(needsPDF){notify({type:'phase',text:'正在上传本篇 PDF，上传完成后提交…'});await this.stream.attach(p.pdfPath);}
      for(const file of files){notify({type:'phase',text:'正在附加文件…'});await this.stream.attach(file);}
      b=this.bindings[p.key]={...b,phase:'uncertain',pendingPrompt:prompt};this.save();
      let listener,closed,timer,seenGenerating=false,attachedId=b.threadId||b.localId;
      const completion=new Promise((resolve,reject)=>{
        settle=(e,s)=>{clearTimeout(timer);this.stream.off('snapshot',listener);this.stream.off('disconnected',closed);e?reject(e):resolve(s);};
        listener=s=>{
          if(!s.inPaper)return;
          if(attachedId&&s.threadId!==attachedId){if(first&&s.localThreadId===attachedId&&cloudID(s.threadId)){b.localId=attachedId;attachedId=s.threadId;b.threadId=attachedId;this.save();}else return;}
          seenGenerating=seenGenerating||s.sending;
          const users=s.turns.filter(t=>t.role==='user'),last=users.at(-1);
          if(!last||(last.id?last.id===beforeUserId:users.length<=oldUsers.length)||norm(last.text)!==norm(prompt))return;
          if(!attachedId){if(!cloudID(s.threadId)&&!/^local-chatgpt:/.test(s.threadId))return;attachedId=s.threadId;if(cloudID(attachedId))b.threadId=attachedId;else b.localId=attachedId;b.title=s.title;b.uploaded=p.mode==='paper'&&(b.uploaded||needsPDF);this.save();}
          const lastUser=s.turns.map(t=>t.role).lastIndexOf('user'),hasAnswer=s.turns.slice(lastUser+1).some(t=>t.role==='assistant'&&t.text.trim());
          notify({type:'snapshot',turns:this.history.get(s.threadId)?.turns||s.turns,generating:s.sending||!hasAnswer,elapsedMs:Date.now()-started,transferMs:s.publishedAt?Date.now()-s.publishedAt:undefined});
          if(hasAnswer&&seenGenerating&&!s.sending)settle(null,s);
        };
        closed=()=>settle(Error('App 中转连接断开，未重复发送'));timer=setTimeout(()=>settle(Error('回答等待超时，请检查原聊天；未重复发送')),360000);
        this.stream.on('snapshot',listener);this.stream.on('disconnected',closed);
      });completion.catch(()=>{});
      submitted=true;await this.stream.submit(prompt);this.prepared=null;
      notify({type:'accepted',background:true,acceptedMs:Date.now()-started});b.phase='generating';this.save();
      const final=await completion;delete b.pendingPrompt;b.phase='ready';b.title=final.title;delete b.draftId;this.save();
      let warning;
      if(!b.threadId){try{const identified=await this.stream.waitFor(s=>cloudID(s?.threadId)&&s.localThreadId===b.localId,10000);b.threadId=identified.threadId;this.history.set(b.threadId,identified);this.save();}catch(e){warning='回答已完成，云端会话标识暂未确认：'+e.message;}}
      if(first&&p.mode==='paper'){try{await this.stream.rename(p.title.slice(0,160));b.title=p.title.slice(0,160);this.save();}catch(e){warning='回答已完成并保存会话；自动命名未确认：'+e.message;}}
      return{...this.info(id),sent:true,background:true,transport:'app-dom-events',elapsedMs:Date.now()-started,warning};
    }catch(e){settle(e);if(submitted){b.phase='uncertain';this.save();}throw e;}
  });}
}
module.exports=EventSessions;
