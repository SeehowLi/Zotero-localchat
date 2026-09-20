const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
function runtime(){
  // MSIX virtualizes AppData for App-launched children; Home is shared with Zotero.
  const root=path.join(os.homedir(),'.zotero-localchat');fs.mkdirSync(root,{recursive:true});
  const previous=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'ZoteroLocalChat');
  for(const name of ['papers.json','settings.json','launcher.json']){const source=path.join(previous,name),dest=path.join(root,name);if(!fs.existsSync(dest)&&fs.existsSync(source))fs.copyFileSync(source,dest);}
  const old=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'PaperChatMirror','papers.json'),current=path.join(root,'papers.json');if(!fs.existsSync(current)&&fs.existsSync(old))fs.copyFileSync(old,current);return root;
}
module.exports=runtime;
