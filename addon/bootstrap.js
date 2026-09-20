var Mirror={panes:new Map(),nodes:new Set(),handlers:[],windows:new Map(),id:'paper-chat-mirror@local.zotero'};
function install(){}
function uninstall(){}
async function startup({rootURI}){
  await Zotero.initializationPromise;Mirror.root=rootURI;Zotero.PaperChatMirror=Mirror;
  Mirror.endpoint=async()=>{
    const folder=Services.dirsvc.get('LocalAppData',Components.interfaces.nsIFile).path;
    const info=await IOUtils.readJSON(PathUtils.join(folder,'ZoteroLocalChat','endpoint.json'));
    const url=new URL(info.url);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!/^#[a-f0-9]{64}$/.test(url.hash)||url.username||url.password)throw Error('本机聊天地址无效。');return url;
  };
  Mirror.paper=item=>{while(item?.parentID)item=Zotero.Items.get(item.parentID);return item?.key&&!item.isNote()?{key:item.libraryID+':'+item.key,title:item.getField('title')||'Untitled paper',item}:null;};
  Mirror.open=async(p,...args)=>{while(p.opening)await p.opening.catch(()=>{});const job=Mirror.load(p,...args);p.opening=job;try{return await job;}finally{if(p.opening===job)p.opening=null;}};
  Mirror.load=async(p,mode='paper',excerpt='')=>{
    try{
      const url=await Mirror.endpoint();if(p.endpoint!==url.href){p.context=null;p.endpoint=url.href;}let pdfPath;
      if(mode==='paper'){
        const active=Zotero.Reader.getByTabID(p.win.Zotero_Tabs?.selectedID);
        const activeItem=active?Zotero.Items.get(active.itemID):null;
        let pdf=activeItem&&Mirror.paper(activeItem)?.key===p.paper.key?activeItem:(p.readerID?Zotero.Items.get(p.readerID):(p.paper.item.isAttachment()?p.paper.item:null));
        if(!pdf?.isAttachment())pdf=(await p.paper.item.getBestAttachment());
        if(!pdf||pdf.attachmentContentType!=='application/pdf')throw Error('这篇条目没有 PDF，请选择空白聊天。');
        pdfPath=await pdf.getFilePathAsync();if(!pdfPath)throw Error('PDF 不在本机，请先下载。');
      }
      if(p.pdfPath!==pdfPath){p.context=null;p.pdfPath=pdfPath;}
      if(!p.context||p.mode!==mode||excerpt){
        const response=await p.win.fetch(url.origin+'/api/context',{method:'POST',headers:{'X-Mirror-Token':url.hash.slice(1),'Content-Type':'application/json'},body:JSON.stringify({mode,key:p.paper.key,title:p.paper.title,pdfPath,excerpt})});
        const info=await response.json();if(!response.ok)throw Error(info.error);p.context=info.id;p.mode=mode;
      }
      if(!p.browser){
        const browser=p.body.ownerDocument.createXULElement('browser');
        for(const [k,v]of Object.entries({type:'content',remote:'false',maychangeremoteness:'false',disableglobalhistory:'true',flex:'1'}))browser.setAttribute(k,v);
        browser.style.cssText='flex:1;min-width:0;min-height:0;width:100%;height:100%;border:0';p.view.append(browser);p.browser=browser;
        browser.addEventListener('load',()=>Mirror.theme(p),true);await Zotero.Promise.delay(0);
      }
      p.view.hidden=false;p.status.hidden=true;
      p.origin=url.origin;const href=url.origin+'/?context='+p.context+'&zoteroTheme='+Mirror.hostTheme(p.win)+url.hash;
      if(p.loadedContext!==p.context||p.loadedEndpoint!==url.href){p.browser.loadURI(Services.io.newURI(href),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});p.loadedContext=p.context;p.loadedEndpoint=url.href;}Mirror.theme(p);
      p.status.textContent=mode==='paper'?'当前论文：'+p.paper.title+'。首次提问才上传 PDF。':'空白聊天，不附带 PDF。';
    }catch(e){p.status.hidden=false;p.status.textContent='无法打开：'+e.message+'（本地服务需先启动）';Zotero.logError(e);throw e;}
  };
  Mirror.hostTheme=win=>{const mode=Services.prefs?.getIntPref('browser.theme.toolbar-theme',2)??2;return mode===0?'dark':mode===1?'light':win.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';};
  Mirror.theme=p=>{if(!p.context||!p.endpoint)return;const theme=Mirror.hostTheme(p.win),url=new URL(p.endpoint);p.win.fetch(url.origin+'/api/appearance',{method:'POST',headers:{'X-Mirror-Token':url.hash.slice(1),'Content-Type':'application/json'},body:JSON.stringify({id:p.context,theme})}).catch(Zotero.logError);};
  Mirror.destroy=body=>{const p=Mirror.panes.get(body);if(p){p.browser?.remove();body.remove();Mirror.panes.delete(body);}};
  Mirror.hide=win=>{const state=Mirror.windows.get(win);if(!state)return;state.open=false;state.context.removeAttribute('data-localchat-open');state.button.setAttribute('aria-pressed','false');};
  Mirror.show=async(reader,excerpt)=>{
    const win=reader._window||reader._iframe?.ownerDocument.defaultView||Zotero.getMainWindow();
    onMainWindowLoad({window:win});const state=Mirror.windows.get(win);if(!state)throw Error('阅读器侧栏尚未就绪');
    const paper=Mirror.paper(Zotero.Items.get(reader.itemID));if(!paper)return;
    if(win.ZoteroContextPane)win.ZoteroContextPane.collapsed=false;
    state.context.collapsed=false;state.open=true;state.context.setAttribute('data-localchat-open','true');state.button.setAttribute('aria-pressed','true');
    let p=[...Mirror.panes.values()].find(p=>p.win===win&&p.paper.key===paper.key);
    if(!p){
      const doc=win.document,body=doc.createXULElement('vbox');body.className='localchat-page';body.setAttribute('flex','1');state.host.append(body);
      const html=(tag,text,parent=body)=>{const e=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text)e.textContent=text;parent.append(e);return e;};
      const row=html('div');row.className='localchat-toolbar';
      const status=html('p');status.className='localchat-error';status.hidden=true;
      const view=doc.createXULElement('vbox');view.className='localchat-view';view.setAttribute('flex','1');body.append(view);
      p={body,paper,status,view,win,browser:null};Mirror.panes.set(body,p);
      const button=(label,fn)=>{const b=html('button',label,row);b.type='button';b.onclick=()=>Promise.resolve(fn()).catch(Zotero.logError);return b;};
      button('论文对话',()=>Mirror.open(p,'paper'));button('空白聊天',()=>{p.context=null;return Mirror.open(p,'blank');});button('论文信息',()=>{Mirror.hide(win);state.context.mode='item';return state.context._getItemContext?.(win.Zotero_Tabs.selectedID)?.scrollToPane('info','instant');});
    }
    for(const other of Mirror.panes.values())if(other.win===win)other.body.hidden=other!==p;
    p.readerID=reader.itemID;p.tabID=reader.tabID;
    await Mirror.open(p,excerpt?'paper':p.mode||'paper',excerpt||'');
  };
  for(const type of ['renderToolbar','renderTextSelectionPopup']){
    const handler=({reader,doc,params,append})=>{const b=doc.createElement('button');b.className='toolbar-button';b.style.cssText='-moz-window-dragging:no-drag;color:var(--fill-primary);cursor:pointer;width:auto;min-width:68px;white-space:nowrap;padding:5px 8px;border-radius:5px';b.textContent=type==='renderToolbar'?'Local Chat':'问 Local Chat';b.onclick=()=>Mirror.show(reader,type==='renderTextSelectionPopup'?params.annotation?.text:undefined).catch(Zotero.logError);append(b);for(const old of Mirror.nodes)if(!old.isConnected)Mirror.nodes.delete(old);Mirror.nodes.add(b);};
    Zotero.Reader.registerEventListener(type,handler,Mirror.id);Mirror.handlers.push([type,handler]);
  }
  for(const win of Zotero.getMainWindows())onMainWindowLoad({window:win});
}
function onMainWindowLoad({window:win}){
  if(Mirror.windows.has(win))return;
  const doc=win.document,context=doc.querySelector('context-pane'),sidenav=doc.getElementById('zotero-context-pane-sidenav');if(!context||!sidenav)return;
  const style=doc.createElementNS('http://www.w3.org/1999/xhtml','style');style.textContent=`
    context-pane[data-localchat-open] > #zotero-context-pane-deck{display:none!important}
    .localchat-host{display:none;flex:1;min-width:0;min-height:0;overflow:hidden}
    context-pane[data-localchat-open] > .localchat-host{display:flex;flex-direction:column}
    .localchat-page,.localchat-view{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
    .localchat-page[hidden],.localchat-error[hidden]{display:none!important}
    .localchat-toolbar{display:flex;flex:none;gap:6px;padding:6px 10px;border-bottom:1px solid var(--fill-quinary);flex-wrap:wrap}
    .localchat-toolbar button{font:12px system-ui;color:inherit;background:transparent;border:0;border-radius:6px;padding:4px 6px;cursor:pointer}
    .localchat-toolbar button:hover{background:var(--fill-quinary)}
    .localchat-error{font:13px system-ui;padding:8px;overflow-wrap:anywhere}
    item-pane-sidenav .localchat-button{background-image:url('${Mirror.root}icon-20-light.png');border:0;flex-shrink:0;cursor:pointer}
    item-pane-sidenav .localchat-button[aria-pressed=true]{background-color:var(--fill-quinary)}
    @media(prefers-color-scheme:dark){item-pane-sidenav .localchat-button{background-image:url('${Mirror.root}icon-20-dark.png')}}
  `;doc.documentElement.append(style);
  const host=doc.createXULElement('vbox');host.className='localchat-host';host.setAttribute('flex','1');context.prepend(host);
  const button=doc.createElementNS('http://www.w3.org/1999/xhtml','button');button.className='btn localchat-button';button.type='button';button.title='Local Chat';button.setAttribute('aria-label','Local Chat');button.setAttribute('aria-pressed','false');
  sidenav.insertBefore(button,sidenav.querySelector('.highlight-notes-inactive'));
  // Retire the old scroll-section pin when upgrading to the independent panel.
  if(sidenav.container?.pinnedPane?.includes('paper-chat-local-mirror'))sidenav.container.pinnedPane=null;
  const current=()=>Zotero.Reader.getByTabID(win.Zotero_Tabs?.selectedID);
  button.onclick=()=>{const r=current();if(r)Mirror.show(r).catch(Zotero.logError);};
  const key=e=>{if(e.ctrlKey&&e.altKey&&e.code==='KeyM'){const r=current();if(r){e.preventDefault();Mirror.show(r).catch(Zotero.logError);}}};win.addEventListener('keydown',key);
  const click=e=>{if(e.button!==0)return;const target=e.target.closest?.('[data-pane]');if(target?.closest('item-pane-sidenav'))Mirror.hide(win);};win.addEventListener('click',click,true);
  const media=win.matchMedia('(prefers-color-scheme: dark)'),theme=()=>{for(const p of Mirror.panes.values())if(p.win===win)Mirror.theme(p);};media.addEventListener('change',theme);const prefObserver={observe:theme};Services.prefs?.addObserver('browser.theme.toolbar-theme',prefObserver);
  const state={context,host,button,style,key,click,media,theme,prefObserver,open:false};Mirror.windows.set(win,state);
  state.notifier=Zotero.Notifier.registerObserver({notify(action,type,ids){
    if(action==='close')for(const [body,p]of Mirror.panes)if(p.win===win&&ids.includes(p.tabID))Mirror.destroy(body);
    if(['select','load','close'].includes(action)&&state.open){const r=current();if(r)Mirror.show(r).catch(Zotero.logError);else Mirror.hide(win);}
  }},['tab'],'localchat');
}
function onMainWindowUnload({window:win}){
  const state=Mirror.windows.get(win);if(!state)return;Mirror.hide(win);
  win.removeEventListener('keydown',state.key);win.removeEventListener('click',state.click,true);state.media.removeEventListener('change',state.theme);Services.prefs?.removeObserver('browser.theme.toolbar-theme',state.prefObserver);Zotero.Notifier.unregisterObserver(state.notifier);
  for(const [body,p]of Mirror.panes)if(p.win===win)Mirror.destroy(body);
  state.button.remove();state.host.remove();state.style.remove();Mirror.windows.delete(win);
}
function shutdown(){for(const [type,h]of Mirror.handlers)Zotero.Reader.unregisterEventListener(type,h);for(const n of Mirror.nodes)n.remove();for(const win of [...Mirror.windows.keys()])onMainWindowUnload({window:win});delete Zotero.PaperChatMirror;}
