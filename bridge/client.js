/* All network traffic from this page stays on the authenticated loopback bridge. */
const $=id=>document.getElementById(id),token=location.hash.slice(1),headers={'X-Mirror-Token':token};
let context=new URLSearchParams(location.search).get('context'),busy=false,ready=false,info,queued=[],turns=[],power,sendPending=false,lastSubmittedDraft=null;
const draftKey=()=>`localchat-draft:${info?.draftKey||context}`;
function status(text,error=false){if($('status').textContent!==text)$('status').textContent=text;$('status').classList.toggle('error',error);}
let configPending={},configFlight=null,configTimer=0,configUnconfirmed=false,dragging=false,previewPower=0;
let confirmedModel='';
function closePickers(){for(const [panel,trigger]of [['modelMenu','model'],['powerLabel','powerToggle']]){$(panel).hidden=true;$(trigger).setAttribute('aria-expanded','false');}}
function openPicker(panel,trigger){const open=$(panel).hidden;closePickers();if(open){$(panel).hidden=false;$(trigger).setAttribute('aria-expanded','true');}return open;}
function modelLabel(value){$('model').value=value;$('modelName').textContent=value||'选择模型';$('model').title=value||'选择模型';}
const hasConfig=()=>!!configFlight||!!configTimer||Object.keys(configPending).length>0||dragging;
function controls(){
  const configuring=hasConfig();
  $('send').disabled=busy||!ready||configuring||configUnconfirmed;
  $('model').disabled=busy||!ready;$('power').disabled=busy||!ready;$('powerToggle').disabled=busy||!ready;
  $('powerToggle').setAttribute('aria-busy',String(configuring));if(busy)closePickers();
  for(const id of ['new','attach','reconnect'])$(id).disabled=busy||configuring;
  $('composer').classList.toggle('syncing',configuring);
  $('powerSync').textContent=configUnconfirmed?'未同步':dragging?'松开应用':configuring?'同步中…':'';
  $('powerSync').classList.toggle('error',configUnconfirmed);
}
function lock(value){busy=value;controls();}
async function api(route,data){const r=await fetch('/api/'+route,{method:data===undefined?'GET':'POST',headers:{...headers,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error||'本地连接失败');return result;}
let renderFrame=0,followBottom=true;
const messageNodes=new Map();
function render(){if(!renderFrame)renderFrame=requestAnimationFrame(paint);}
function paint(){
  renderFrame=0;const area=$('messages'),keep=new Set();
  if(turns.length)area.querySelector('.empty')?.remove();let cursor=area.firstElementChild;
  turns.forEach((turn,i)=>{
    if(!['user','assistant'].includes(turn.role))return;
    const key=turn.id||`${turn.role}:${i}`;keep.add(key);let el=messageNodes.get(key);
    if(!el){el=document.createElement('article');el.className='message '+turn.role;el.setAttribute('aria-label',turn.role==='user'?'你':'ChatGPT');messageNodes.set(key,el);}
    if(el._text!==turn.text){
      // Keep existing text nodes during plain-text deltas; older selections survive.
      if(!turn.text.includes('```')&&el.children.length===1&&el.firstChild.tagName==='P'&&el.firstChild.firstChild?.nodeType===3){
        const node=el.firstChild.firstChild;if(turn.text.startsWith(el._text))node.appendData(turn.text.slice(el._text.length));else node.data=turn.text;
      }else{
        el.replaceChildren(...turn.text.split(/```[^\n]*\n([\s\S]*?)```/g).map((text,j)=>{const n=document.createElement(j%2?'pre':'p');n.textContent=text;return n;}));
      }
      el._text=turn.text;
    }
    if(el!==cursor)area.insertBefore(el,cursor);cursor=el.nextElementSibling;
  });
  for(const [key,el]of messageNodes)if(!keep.has(key)){el.remove();messageNodes.delete(key);}
  if(!turns.length&&!area.querySelector('.empty')){const empty=document.createElement('div');empty.className='empty';empty.textContent=info?.mode==='blank'?'今天想聊些什么？':'从这篇论文开始聊聊';area.append(empty);}
  if(followBottom)area.scrollTop=area.scrollHeight;$('latest').hidden=followBottom||!turns.length;
}
$('messages').addEventListener('scroll',()=>{const e=$('messages');followBottom=e.scrollHeight-e.scrollTop-e.clientHeight<60;$('latest').hidden=followBottom||!turns.length;},{passive:true});
$('latest').onclick=()=>{followBottom=true;$('messages').scrollTop=$('messages').scrollHeight;$('latest').hidden=true;};
function models(data,preserve=false){
  const selected=data.models?.find(m=>m.selected&&typeof m.name==='string'&&m.name.trim());
  if(!selected)throw Error('App 尚未返回有效的模型选中状态，请重连后检查');
  const signature=JSON.stringify(data.models.map(m=>[m.name,m.enabled]));
  if($('model').dataset.catalog!==signature){
    $('modelMenu').replaceChildren(...data.models.map(m=>{const o=document.createElement('button');o.type='button';o.setAttribute('role','option');o.dataset.model=m.name;o.textContent=m.name;o.disabled=!m.enabled;o.onclick=()=>{modelLabel(m.name);closePickers();$('model').focus();$('model').onchange();};return o;}));$('model').dataset.catalog=signature;
  }
  confirmedModel=selected.name;modelLabel(preserve&&configPending.model?configPending.model:confirmedModel);
  for(const option of $('modelMenu').children)option.setAttribute('aria-selected',String(option.dataset.model===$('model').value));
  power=data.power;$('powerToggle').hidden=!power;if(!power){$('powerLabel').hidden=true;$('powerToggle').setAttribute('aria-expanded','false');}
  if(power){
    $('power').max=power.max;previewPower=preserve&&(dragging||configPending.index!==undefined)?Math.min(power.max,previewPower):power.index;
    $('power').value=previewPower;powerText(previewPower,data.strength);
    const labels=power.options?.map(o=>o.label)||[];
    if($('powerTicks').dataset.labels!==JSON.stringify(labels)){$('powerTicks').replaceChildren(...labels.map(label=>{const s=document.createElement('span');s.textContent=label;return s;}));$('powerTicks').dataset.labels=JSON.stringify(labels);}
    $('power').title=labels.join(' / ');
  }else delete configPending.index;
}
function powerText(value,fallback){const index=Math.round(value),label=power?.options?.[index]?.label;const text=label||fallback?.split(/[，,]/)[0]||`档位 ${index+1}`;if($('powerText').textContent!==text){$('powerText').textContent=text;$('powerValue').textContent=text;$('power').setAttribute('aria-valuetext',text);}$('power').style.setProperty('--progress',`${power?.max?value/power.max*100:0}%`);}
function scheduleConfig(delay=0){clearTimeout(configTimer);configTimer=setTimeout(()=>{configTimer=0;flushConfig();},delay);controls();}
async function flushConfig(){
  if(configFlight||dragging||busy||!ready)return;
  let choice;
  if(configPending.model!==undefined){choice={model:configPending.model};delete configPending.model;}
  else if(configPending.index!==undefined){choice={index:Math.min(power.max,configPending.index)};delete configPending.index;if(choice.index===power.index&&!configUnconfirmed){controls();return;}}
  else{controls();return;}
  configFlight=choice;controls();
  try{
    const data=await api('session/config',{id:context,...choice});
    if(choice.index!==undefined&&data.power?.index!==choice.index)throw Error('App 尚未确认强度切换');
    if(choice.model&&!data.models.some(m=>m.name===choice.model&&m.selected))throw Error('App 尚未确认模型切换');
    const wasUnconfirmed=configUnconfirmed;configUnconfirmed=false;models(data,true);if(wasUnconfirmed)status('设置已同步');
  }catch(e){
    clearTimeout(configTimer);configTimer=0;configPending={};configUnconfirmed=true;
    modelLabel(confirmedModel);
    if(power){previewPower=power.index;$('power').value=previewPower;powerText(previewPower);}
    status(e.message+'。请重新选择或点击重连；当前设置未确认。',true);
  }finally{configFlight=null;controls();if(Object.keys(configPending).length&&!dragging&&!configTimer)flushConfig();}
}
function commitPower(delay=0){if(busy||!ready||!power)return;previewPower=Math.round(Number($('power').value));$('power').value=previewPower;powerText(previewPower);configPending.index=previewPower;scheduleConfig(delay);}
async function connect(recover=false){lock(true);status('正在连接本机 App…');try{await api('reconnect',{});info=await api('context?id='+context);if(!$('prompt').value)$('prompt').value=localStorage.getItem(draftKey())||(info.excerpt?'请解释这段文字：\n\n'+info.excerpt:'');if(recover&&['uncertain','sending','generating'].includes(info.phase))info=await api('session/recover',{id:context});info=await api('session/open',{id:context});$('paper').textContent=info.mode==='paper'?info.title:'Paper · 空白聊天';$('paper').title=$('paper').textContent;turns=(await api('transcript?id='+context)).turns;render();models(await api('session/model',{id:context}));configUnconfirmed=false;ready=true;resizeInput();status(info.uploaded?'已关联这篇论文 · 可继续提问、追加文件':info.mode==='paper'?'首次发送时附上 PDF':'空白聊天 · 不附带论文');if(sendPending&&info.phase==='ready'){sendPending=false;if($('prompt').value===lastSubmittedDraft){$('prompt').value='';localStorage.removeItem(draftKey());resizeInput();}for(const f of queued)await api('upload/remove',{id:context,file:f.id});queued=[];files();}}catch(e){ready=false;status(e.message+'。可点击重连。',true);}finally{lock(false);}}
$('prompt').value=localStorage.getItem(draftKey())||'';$('prompt').oninput=()=>{localStorage.setItem(draftKey(),$('prompt').value);resizeInput();};
$('reconnect').onclick=()=>connect(true);
$('new').onclick=async()=>{if(busy||hasConfig())return;if(($('prompt').value.trim()||queued.length)&&!confirm('开始新聊天？当前输入会保留在原会话，未发送附件会移除。'))return;lock(true);try{for(const f of queued)await api('upload/remove',{id:context,file:f.id});queued=[];files();const c=await api('context',{mode:'blank'});context=c.id;const url=new URL(location.href);url.searchParams.set('context',context);history.replaceState(null,'',url);$('prompt').value='';sendPending=false;await connect();}catch(e){status(e.message,true);lock(false);}};
$('model').onchange=()=>{configPending={model:$('model').value};scheduleConfig();};
$('model').onclick=()=>{if(openPicker('modelMenu','model'))($('modelMenu').querySelector('[aria-selected="true"]:not(:disabled)')||$('modelMenu').querySelector('button:not(:disabled)'))?.focus();};
$('powerToggle').onclick=()=>{if(openPicker('powerLabel','powerToggle'))$('power').focus({preventScroll:true});};
$('model').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();if($('modelMenu').hidden)$('model').click();}};
$('modelMenu').onkeydown=e=>{const options=[...$('modelMenu').querySelectorAll('button:not(:disabled)')],index=options.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next]?.focus();}};
document.addEventListener('pointerdown',e=>{if(!$('modelPicker').contains(e.target)){$('modelMenu').hidden=true;$('model').setAttribute('aria-expanded','false');}if(!$('powerLabel').contains(e.target)&&!$('powerToggle').contains(e.target)){$('powerLabel').hidden=true;$('powerToggle').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const target=!$('modelMenu').hidden?$('model'):!$('powerLabel').hidden?$('powerToggle'):null;if(target){e.preventDefault();closePickers();target.focus();}}});
$('power').onpointerdown=()=>{if(busy||!ready)return;dragging=true;clearTimeout(configTimer);configTimer=0;controls();};
$('power').oninput=()=>{previewPower=Number($('power').value);powerText(previewPower);};
$('power').onchange=()=>{if(!dragging)commitPower();};
window.addEventListener('pointerup',()=>{if(dragging){dragging=false;commitPower();}});
$('power').onpointercancel=()=>{dragging=false;delete configPending.index;previewPower=power.index;$('power').value=previewPower;powerText(previewPower);if(Object.keys(configPending).length)scheduleConfig();else controls();};
$('power').onkeydown=e=>{if(!power||!['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End','PageUp','PageDown'].includes(e.key))return;e.preventDefault();const down=['ArrowLeft','ArrowDown','PageDown'].includes(e.key),next=e.key==='Home'?0:e.key==='End'?power.max:Math.round(Number($('power').value))+(down?-1:1);$('power').value=Math.max(0,Math.min(power.max,next));commitPower(80);};
$('power').addEventListener('wheel',e=>{if(e.ctrlKey)return;e.preventDefault();if(busy||!ready||!power||dragging)return;const next=Math.min(power.max,Math.max(0,Math.round(Number($('power').value))+(e.deltaY<0?1:-1)));if(next===Number($('power').value))return;$('power').value=next;commitPower(100);},{passive:false});
function files(){$('files').replaceChildren();for(const f of queued){const b=document.createElement('button');b.type='button';b.textContent=f.name+' ×';b.title='移除 '+f.name;b.onclick=async()=>{if(busy)return;try{await api('upload/remove',{id:context,file:f.id});queued=queued.filter(x=>x!==f);files();}catch(e){status(e.message,true);}};$('files').append(b);}}
async function addFiles(list){if(busy||hasConfig()){status('请等当前操作完成后再添加文件');return;}lock(true);try{for(const f of list){if(queued.length>=8)throw Error('每次最多添加 8 个文件');status('正在接收附件：'+f.name);const r=await fetch('/api/upload?id='+context+'&name='+encodeURIComponent(f.name),{method:'POST',headers,body:f});const result=await r.json();if(!r.ok)throw Error(result.error);queued.push(result);files();}status('附件已准备好，点击发送后上传');}catch(e){status(e.message,true);}finally{lock(false);$('fileInput').value='';}}
$('attach').onclick=()=>$('fileInput').click();$('fileInput').onchange=()=>addFiles([...$('fileInput').files]);
for(const name of ['dragenter','dragover'])document.addEventListener(name,e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();document.body.classList.add('dragover');}});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragover');});document.addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('dragover');if(e.dataTransfer.files.length)addFiles([...e.dataTransfer.files]);});
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('composer').requestSubmit();}};
$('composer').onsubmit=async e=>{e.preventDefault();const sentDraft=$('prompt').value,text=sentDraft.trim();if(busy||!ready||hasConfig()||configUnconfirmed||!text)return;lock(true);followBottom=true;sendPending=true;lastSubmittedDraft=sentDraft;status('正在发送…');try{
  const r=await fetch('/api/session/send-stream',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:context,text,files:queued.map(f=>f.id)})});if(!r.ok)throw Error((await r.json()).error);
  let completed=false;await MirrorStream.read(r,event=>{if(event.type==='error')throw Error(event.error);if(event.type==='phase')status(event.text);if(event.type==='accepted')status('等待 ChatGPT 回复…');if(event.type==='snapshot'){turns=event.turns;render();status(event.generating?'正在回复…':'回复完成');}if(event.type==='complete'){completed=true;info=event.info;status(info.warning||'已完成 · 可继续提问');}});
  if(!completed)throw Error('连接中断，发送状态未确认；请点击重连，避免重复提问');sendPending=false;if($('prompt').value===sentDraft){$('prompt').value='';localStorage.removeItem(draftKey());resizeInput();}queued=[];files();
}catch(e){ready=false;status(e.message+'。输入已保留；点击重连确认原回答。',true);}finally{lock(false);}};
function resizeInput(){const e=$('prompt');e.style.height='auto';e.style.height=Math.min(144,Math.max(54,e.scrollHeight))+'px';}
new ResizeObserver(()=>{if(followBottom)render();}).observe($('messages'));
let zoom=Number(localStorage.getItem('localchat-zoom'))||1,zoomFrame=0,zoomSave=0;
function applyZoom(){zoomFrame=0;document.documentElement.style.setProperty('--size',(15*zoom)+'px');$('zoomReset').textContent=Math.round(zoom*100)+'%';resizeInput();}
function setZoom(n){zoom=Math.max(.8,Math.min(1.6,Math.round(n*100)/100));if(!zoomFrame)zoomFrame=requestAnimationFrame(applyZoom);clearTimeout(zoomSave);zoomSave=setTimeout(()=>localStorage.setItem('localchat-zoom',zoom),150);}
window.addEventListener('pagehide',()=>localStorage.setItem('localchat-zoom',zoom));applyZoom();
document.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();setZoom(zoom+(e.deltaY<0?.05:-.05));}},{passive:false});document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='0'){e.preventDefault();setZoom(1);}});$('zoomReset').onclick=()=>setZoom(1);
if(context)connect();else{status('请从 Zotero 侧栏打开 Local Chat',true);lock(false);}
