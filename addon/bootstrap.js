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
        for(const [k,v]of Object.entries({type:'content',remote:'false',maychangeremoteness:'true',disableglobalhistory:'true',flex:'1'}))browser.setAttribute(k,v);
        browser.style.cssText='flex:1;min-width:0;height:100%;border:0';p.view.append(browser);p.browser=browser;await Zotero.Promise.delay(80);
      }
      p.view.hidden=false;
      const href=url.origin+'/?context='+p.context+url.hash;
      if(p.browser.currentURI?.spec!==href)p.browser.loadURI(Services.io.newURI(href),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
      p.status.textContent=mode==='paper'?'当前论文：'+p.paper.title+'。首次提问才上传 PDF。':'空白聊天，不附带 PDF。';
    }catch(e){p.status.textContent='无法打开：'+e.message+'（本地服务需先启动）';Zotero.logError(e);throw e;}
  };
  Mirror.destroy=body=>{const p=Mirror.panes.get(body);if(p){p.browser?.remove();body.replaceChildren();Mirror.panes.delete(body);}};
  Mirror.render=({body,doc,item})=>{
    const paper=Mirror.paper(item);if(!paper)return;
    let p=Mirror.panes.get(body);if(p&&p.paper.key===paper.key)return;Mirror.destroy(body);
    const html=(tag,text,parent=body)=>{const e=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text)e.textContent=text;parent.append(e);return e;};
    const row=html('div');row.style.cssText='display:flex;gap:5px;flex-wrap:wrap;margin:5px 0';
    const status=html('p','打开不会上传或发消息。首次提问后继续同一篇论文的聊天。');status.style.cssText='font:12px system-ui;line-height:1.5;margin:5px 0;overflow-wrap:anywhere';
    const view=html('div');view.style.cssText='height:calc(100vh - 245px);min-height:330px;min-width:280px;display:flex;resize:vertical;overflow:hidden;border-radius:8px';view.hidden=true;
    p={body,paper,status,view,win:doc.defaultView,browser:null};Mirror.panes.set(body,p);
    const button=(label,fn)=>{const b=html('button',label,row);b.style.cssText='font:12px system-ui;padding:6px;cursor:pointer';b.onclick=()=>Promise.resolve(fn()).catch(()=>{});};
    button('当前论文',()=>Mirror.open(p,'paper'));button('空白聊天',()=>{p.context=null;return Mirror.open(p,'blank');});button('收起',()=>{view.hidden=true;});
    // ItemPane render is passive. Opening the sidenav displays a local page only.
    Mirror.open(p,'paper').catch(()=>{});
  };
  Mirror.show=async(reader,excerpt)=>{
    const win=reader._window||reader._iframe?.ownerDocument.defaultView||Zotero.getMainWindow();
    if(win.ZoteroContextPane)win.ZoteroContextPane.collapsed=false;
    const context=win.document.querySelector('context-pane');if(context){context.collapsed=false;context.mode='item';}
    const paper=Mirror.paper(Zotero.Items.get(reader.itemID));
    for(let i=0;i<40;i++){
      const details=context?._getItemContext?.(reader.tabID)||[...win.document.querySelectorAll('item-details')].find(e=>Mirror.paper(e.item)?.key===paper?.key);
      if(details){details.pinnedPane=Mirror.pane;await details.scrollToPane(Mirror.pane);}
      const p=[...Mirror.panes.values()].find(p=>p.paper.key===paper?.key&&p.body.isConnected&&(!details||p.body.closest('item-details')===details));
      if(p){p.readerID=reader.itemID;await Mirror.open(p,'paper',excerpt||'');return;}
      await Zotero.Promise.delay(100);
    }
  };
  Mirror.pane=Zotero.ItemPaneManager.registerSection({paneID:'paper-chat-local-mirror',pluginID:Mirror.id,header:{l10nID:'paper-chat-mirror-title',icon:rootURI+'icon.svg'},sidenav:{l10nID:'paper-chat-mirror-title',icon:rootURI+'icon.svg'},onInit:({doc})=>doc.defaultView.MozXULElement.insertFTLIfNeeded('mirror.ftl'),onItemChange:({item,body,setEnabled})=>{const paper=Mirror.paper(item);setEnabled(!!paper);if(Mirror.panes.get(body)?.paper.key!==paper?.key)Mirror.destroy(body);},onRender:Mirror.render,onDestroy:({body})=>Mirror.destroy(body)});
  for(const type of ['renderToolbar','renderTextSelectionPopup']){
    const handler=({reader,doc,params,append})=>{const b=doc.createElement('button');b.className='toolbar-button';b.style.cssText='-moz-window-dragging:no-drag;color:var(--fill-primary);cursor:pointer;width:auto;min-width:68px;white-space:nowrap;padding:5px 8px;border-radius:5px';b.textContent=type==='renderToolbar'?'Local Chat':'问 Local Chat';b.onclick=()=>Mirror.show(reader,type==='renderTextSelectionPopup'?params.annotation?.text:undefined).catch(Zotero.logError);append(b);for(const old of Mirror.nodes)if(!old.isConnected)Mirror.nodes.delete(old);Mirror.nodes.add(b);};
    Zotero.Reader.registerEventListener(type,handler,Mirror.id);Mirror.handlers.push([type,handler]);
  }
  for(const win of Zotero.getMainWindows())onMainWindowLoad({window:win});
}
function onMainWindowLoad({window:win}){
  if(Mirror.windows.has(win))return;win.MozXULElement.insertFTLIfNeeded('mirror.ftl');
  const fn=e=>{if(e.ctrlKey&&e.altKey&&e.code==='KeyM'){const r=Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);if(r){e.preventDefault();Mirror.show(r).catch(Zotero.logError);}}};win.addEventListener('keydown',fn);Mirror.windows.set(win,fn);
}
function onMainWindowUnload({window:win}){const fn=Mirror.windows.get(win);if(fn)win.removeEventListener('keydown',fn);Mirror.windows.delete(win);for(const [body,p]of Mirror.panes)if(p.win===win)Mirror.destroy(body);}
function shutdown(){for(const [type,h]of Mirror.handlers)Zotero.Reader.unregisterEventListener(type,h);for(const n of Mirror.nodes)n.remove();for(const win of [...Mirror.windows.keys()])onMainWindowUnload({window:win});if(Mirror.pane)Zotero.ItemPaneManager.unregisterSection(Mirror.pane);delete Zotero.PaperChatMirror;}
