const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
function runtime(){const root=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'ZoteroLocalChat');fs.mkdirSync(root,{recursive:true});const old=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'PaperChatMirror','papers.json'),current=path.join(root,'papers.json');if(!fs.existsSync(current)&&fs.existsSync(old))fs.copyFileSync(old,current);return root;}
module.exports=runtime;
