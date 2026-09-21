// Runs in the App renderer, not a website login/session clone.
(() => {
  if(globalThis.__paperChatObserver)return;
  let project=globalThis.__localChatProject||'Paper';
  const newEditor=e=>!!e&&['在 '+project+' 中新建聊天','New chat in '+project].some(prefix=>name(e).startsWith(prefix));
  function projectRow(){const rows=all('[data-app-action-sidebar-project-label]').filter(e=>e.getAttribute('data-app-action-sidebar-project-label')===project);if(rows.length!==1)throw Error('未找到唯一的聊天项目：'+project);return rows[0];}
  const name=e=>{const label=(e.getAttribute('aria-label')||e.innerText||e.textContent||'').trim();return e.getAttribute('role')==='menuitem'?label.split('\n')[0]:label;};
  const visible=e=>!!e.getClientRects().length;
  const all=(s,root=document)=>[...root.querySelectorAll(s)];
  const cloudID=s=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s||'');
  function propsOf(row,limit=12){const out=[];let f=row?.[Object.keys(row||{}).find(k=>k.startsWith('__reactFiber$'))];for(let i=0;f&&i<limit;i++,f=f.return)if(f.memoizedProps)out.push(f.memoizedProps);return out;}
  function picker(){
    const trigger=all('button').find(e=>name(e)==='选择 ChatGPT 模型');
    return propsOf(trigger,40).find(p=>Array.isArray(p.powerSelections)&&Array.isArray(p.modelListConfig?.options)&&typeof p.onSelectPower==='function');
  }
  function selectedPower(p){
    if(p?.selectedPowerSelection)return p.selectedPowerSelection;
    const candidate=p?.selectedLabelCandidate;
    if(!candidate?.model||candidate.reasoningEffort===undefined)return null;
    const matches=p.powerSelections.filter(o=>o.model===candidate.model&&o.reasoningEffort===candidate.reasoningEffort);
    return matches.length===1?matches[0]:null;
  }
  function settingsSnapshot(p){
    if(!p)return null;
    const models=p.modelListConfig.options.map(o=>({id:o.id,name:o.label,selected:o.selected===true,enabled:!o.disabled}));
    const index=p.powerSelections.findIndex(o=>o.id===selectedPower(p)?.id);
    if(models.filter(o=>o.selected).length!==1||p.powerSelections.length&&index<0)return null;
    const power=p.powerSelections.length?{index,max:p.powerSelections.length-1,options:p.powerSelections.map(o=>({label:o.sliderLabel}))}:null;
    return {models,power,strength:power?.options[index].label||'此模型未提供强度选项',transport:'native-controls'};
  }
  async function settings(choice){
    const initial=picker();if(!initial)return null; // Older App versions keep the menu adapter.
    const thread=()=>document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id'),identity=thread(),started=performance.now();
    let expectedModel,expectedPower;
    if(choice){
      if(initial.disabled)throw Error('App 模型控件暂不可用');
      if(choice.model!==undefined){
        const matches=initial.modelListConfig.options.filter(o=>o.label===choice.model&&!o.disabled);
        if(matches.length!==1||typeof matches[0].onSelect!=='function')throw Error('模型不可用');
        expectedModel=matches[0].id;await matches[0].onSelect();
      }else{
        const before=settingsSnapshot(initial);if(!before?.power)throw Error('此模型没有可调节的强度');
        const index=choice.index!==undefined?choice.index:[-1,1].includes(choice.delta)?Math.max(0,Math.min(before.power.max,before.power.index+choice.delta)):NaN;
        if(!Number.isInteger(index)||index<0||index>before.power.max)throw Error('强度档位无效');
        expectedPower=initial.powerSelections[index].id;
        // Use the same native selection callback as the App slider; no synthetic menu cycle.
        await initial.onSelectPower(initial.powerSelections[index]);
      }
    }
    do{
      if(thread()!==identity)throw Error('App 聊天已切换，设置未确认');
      const current=picker(),snapshot=settingsSnapshot(current);
      if(snapshot&&(!expectedModel||snapshot.models.some(m=>m.id===expectedModel&&m.selected))&&(!expectedPower||selectedPower(current)?.id===expectedPower))return {...snapshot,settingsMs:Math.round(performance.now()-started)};
      await new Promise(resolve=>setTimeout(resolve,16));
    }while(performance.now()-started<1800);
    throw Error('App 尚未确认设置，请重连后检查');
  }
  function paperRows(){let p;try{p=projectRow();}catch{return [];}return all('[role="button"][aria-label]',p.parentElement);}
  function rowID(row){for(const p of propsOf(row)){const id=p.conversation?.id||p.conversation?.conversation_id||p.conversationId;if(cloudID(id))return id;}return null;}
  function one(label,selector='button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="radio"],input'){
    const found=all(selector).filter(e=>visible(e)&&name(e)===label&&!e.disabled);
    if(found.length!==1)throw Error('未找到唯一的 App 控件：'+label);return found[0];
  }
  function editor(){return all('[contenteditable="true"],textarea').find(e=>visible(e)&&(/^(给 ChatGPT 发消息|Message ChatGPT)/.test(name(e))||newEditor(e)));}
  function clean(root){const c=root.cloneNode(true);c.querySelectorAll('button,[role="button"],[role="status"],time,svg,script,style').forEach(e=>e.remove());return(c.innerText||c.textContent||'').replace(/\uFFFC/g,'').trim();}
  const unitCache=new WeakMap();
  function invalidate(records){for(const record of records){const e=record.target.nodeType===1?record.target:record.target.parentElement;const unit=e?.closest('[data-content-search-unit-key],[data-chatgpt-conversation-turn]');if(unit)unitCache.delete(unit);}}
  function cached(unit,build){if(!unitCache.has(unit))unitCache.set(unit,build());return unitCache.get(unit);}
  function blocksIn(unit,selector){return all(selector,unit).filter(e=>!e.parentElement?.closest(selector)||!unit.contains(e.parentElement.closest(selector)));}
  function read(){
    invalidate(observer.takeRecords());
    const main=document.querySelector('main')||document.querySelector('[role="main"]')||document;
    const selected=all('[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-kind="chatgpt"]')
      .filter(e=>e.getAttribute('data-app-action-sidebar-thread-selected')==='true');
    const localThreadId=(document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id')||(selected.length===1?selected[0].getAttribute('data-app-action-sidebar-thread-id'):null))?.replace(/^chatgpt:/,'')||null;
    const currentRow=paperRows().find(e=>e.getAttribute('aria-current')==='page'&&name(e)===document.title);
    const threadId=/^local-chatgpt:/.test(localThreadId||'')?(rowID(currentRow)||propsOf(currentRow).map(p=>p.activeServerConversationId).find(cloudID)||localThreadId):localThreadId;
    const inPaper=all('button',main).some(e=>['项目：'+project,'Project: '+project].includes(name(e)))||newEditor(editor())||!!(cloudID(threadId)&&currentRow&&rowID(currentRow)===threadId);
    const input=editor(),draft=input?(input.value??input.innerText??'').trim():'';
    const sending=all('button',main).some(e=>visible(e)&&/^(停止|停止生成|停止响应|Stop|Stop generating)$/.test(name(e)));
    const turns=[];
    const units=all('[data-content-search-unit-key]',main).filter(e=>/:(user|assistant)$/.test(e.getAttribute('data-content-search-unit-key')));
    if(inPaper&&units.length)for(const unit of units)turns.push(...cached(unit,()=>{
      const id=unit.getAttribute('data-content-search-unit-key'),role=id.endsWith(':user')?'user':'assistant';
      const blocks=blocksIn(unit,role==='user'?'[data-markdown-text-tone="user-message"]':'[data-markdown-text-style="assistant-message"]');
      const text=blocks.length?blocks.map(e=>e.innerText).join('\n\n'):role==='assistant'?'':clean(unit).replace(/^(你说：|ChatGPT 说：|You said:|ChatGPT said:)\s*/,'');
      return text.trim()?[{id,role,text:text.trim(),...(role==='assistant'?{rich:LocalChatRich.capture(blocks)}:{})}]:[];
    }));
    if(inPaper&&!units.length)for(const [turnIndex,turn]of all('[data-chatgpt-conversation-turn]',main).entries())turns.push(...cached(turn,()=>{
      const result=[],headings=all('h1,h2,h3,h4,h5,h6,[role="heading"]',turn).filter(e=>/^(你说：|ChatGPT 说：|You said:|ChatGPT said:)$/.test(name(e)));
      for(let i=0;i<headings.length;i++){
        const h=headings[i],range=document.createRange();range.setStartAfter(h);if(headings[i+1])range.setEndBefore(headings[i+1]);else range.setEndAfter(turn.lastChild);
        const fragment=range.cloneContents(),assistant=/^(ChatGPT 说|ChatGPT said)/.test(name(h)),blocks=blocksIn(fragment,'[data-markdown-text-style="assistant-message"]');
        const text=assistant?blocks.map(e=>e.textContent).join('\n\n'):clean(fragment),role=assistant?'assistant':'user';
        if(text)result.push({id:`fallback-turn-${turnIndex}:${i}:${role}`,role,text,...(assistant?{rich:LocalChatRich.capture(blocks)}:{})});
      }return result;
    }));
    const attachments=all('button[aria-label^="移除 "]',main).filter(e=>e.closest('.composer-attachment-surface')).map(e=>({name:name(e).slice(3),text:e.closest('.composer-attachment-surface').innerText}));
    const send=all('button',main).find(e=>/^(发送|发送消息|Send|Send message)$/.test(name(e)));
    const failed=all('[role="alert"]',main).filter(e=>visible(e)&&/net::ERR_|network|网络|连接|connection|fetch failed/i.test(e.innerText)&&all('button',e).some(b=>/^(重试|Retry|Try again)$/i.test(name(b)))).at(-1);
    const responseError=failed?failed.innerText.replace(/\s*(重试|Retry|Try again)\s*$/i,'').trim().slice(0,500):null;
    return {title:document.title,threadId,localThreadId,inPaper,draft,newPaper:newEditor(input),sending,turns,attachments,responseError,canSend:!!send&&!send.disabled,canRename:!!currentRow&&propsOf(currentRow).some(p=>typeof p.getItems==='function')};
  }
  let signature='',scheduled=false,lastIdentity='',first=true;const changes=LocalChatRich.differ();
  function publish(){
    scheduled=false;const start=performance.now(),state=read(),delta=changes(state.turns),{turns,...meta}=state,next=JSON.stringify(meta),identity=state.threadId+'|'+state.inPaper;
    if(first||identity!==lastIdentity||next!==signature||delta.turns.length||delta.order){
      const timing={publishedAt:Date.now(),captureMs:performance.now()-start};
      const event=first||identity!==lastIdentity?{type:'snapshot',...state,...timing}:{type:'patch',...meta,...delta,...timing};
      signature=next;lastIdentity=identity;first=false;globalThis.__paperChatChanged?.(JSON.stringify(event));
    }
  }
  const observer=new MutationObserver(records=>{invalidate(records);if(!scheduled){scheduled=true;queueMicrotask(publish);}});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','aria-busy','aria-checked','disabled','aria-disabled','data-app-action-sidebar-thread-selected','data-above-composer-conversation-id','class','href','colspan','rowspan','start']});
  globalThis.__paperChatObserver={read,one,name,editor,settings,
    findTitle(title){
      const p=projectRow();
      if(p.getAttribute('data-app-action-sidebar-project-collapsed')==='true'){p.click();return{expanded:true};}
      const more=all('button,[role="button"]',p.parentElement).find(e=>['展开显示','Show more'].includes(name(e)));
      if(more){more.click();return{expanded:true};}
      const normalize=s=>String(s).normalize('NFC').replace(/\s+/g,' ').trim();
      const titles=new Set([normalize(title),normalize(title.slice(0,160))]);
      const matches=paperRows().filter(e=>titles.has(normalize(name(e)))).map(e=>({id:rowID(e),title:name(e)}));
      if(matches.some(m=>!m.id))throw Error('同名聊天的云端标识尚未就绪，请稍后重连');
      return{matches:[...new Map(matches.map(m=>[m.id,m])).values()]};
    },
    setProject(value){project=value;first=true;publish();},
    startChat(){const p=projectRow();if(p.getAttribute('data-app-action-sidebar-project-collapsed')==='true'){p.click();return{expanded:true};}const labels=['在 '+project+' 中开启新聊天','New chat in '+project,'Start a new chat in '+project];const found=all('button,[role="button"]',p.parentElement).filter(e=>visible(e)&&labels.includes(name(e))&&!e.disabled);if(found.length!==1)throw Error('未找到该项目的 ChatGPT 新聊天按钮；请在 App 中展开聊天项目：'+project);found[0].click();return{opened:true};},
    open(id,title){let nodes=id?all('[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-kind="chatgpt"]').filter(e=>e.getAttribute('data-app-action-sidebar-thread-id')?.replace(/^chatgpt:/,'')===id):[];if(!nodes.length){const p=projectRow();if(p?.getAttribute('data-app-action-sidebar-project-collapsed')==='true'){p.click();return{expanded:true};}nodes=id?paperRows().filter(e=>rowID(e)===id):[];if(!nodes.length&&title)nodes=paperRows().filter(e=>name(e)===title);if(!nodes.length&&p){const more=all('button,[role="button"]',p.parentElement).find(e=>name(e)==='展开显示');if(more){more.click();return{expanded:true};}}}if(nodes.length!==1)throw Error('项目中未找到唯一的已关联聊天，请在 App 中打开该聊天一次。');nodes[0].click();return{opened:true};},
    async rename(){const rows=paperRows().filter(e=>e.getAttribute('aria-current')==='page'&&name(e)===document.title);if(rows.length!==1)throw Error('无法唯一定位当前项目聊天');for(const p of propsOf(rows[0]))if(typeof p.getItems==='function'){const items=await p.getItems(),rename=items.find(i=>i.id==='rename-chatgpt-conversation');if(rename&&typeof rename.onSelect==='function'){rename.onSelect();return;}}throw Error('此 App 版本未提供可识别的重命名操作');},
    click(label){one(label).click();},
    focusEditor(){const e=editor();if(!e)throw Error('请在 App 中打开已选择项目的聊天');if((e.value??e.innerText??'').trim())throw Error('App 输入框已有草稿，未覆盖');e.focus();},
    send(expected){const e=editor(),norm=t=>String(t).replace(/\s+/g,' ').trim();if(!e||norm(e.value??e.innerText??'')!==norm(expected))throw Error('App 草稿与待发送内容不一致');const buttons=all('button',document.querySelector('main')||document).filter(e=>visible(e)&&/^(发送|发送消息|Send|Send message)$/.test(name(e))&&!e.disabled);if(buttons.length!==1)throw Error('发送按钮尚未就绪');buttons[0].click();},
    models(){const control=document.querySelector('[data-reasoning-slider]'),slider=control&&document.querySelector('[role=menu] [role=slider]');let options=[];for(const p of propsOf(control,32)){for(const v of Object.values(p)){if(Array.isArray(v)&&v.length>1&&v.length<12&&v.every(o=>o&&typeof o==='object'&&typeof o.sliderLabel==='string'))options=v.map(o=>({label:o.sliderLabel}));}}const power=slider?{index:Number(slider.getAttribute('aria-valuenow')),max:Number(slider.getAttribute('aria-valuemax')),options}:null;return {power,models:all('[role="menuitemradio"],[role="radio"],input[type="radio"]').filter(visible).map(e=>({name:name(e),selected:e.getAttribute('aria-checked')==='true'||e.checked===true,enabled:!e.disabled&&e.getAttribute('aria-disabled')!=='true'})),strength:all('[role="menu"] [role="status"],[role="menuitem"]').map(name).find(n=>/第\s*\d+\s*项，共\s*\d+/.test(n))||'此模型未提供强度选项'};},
    stop(){observer.disconnect();delete globalThis.__paperChatObserver;}
  };
  publish();
})();
