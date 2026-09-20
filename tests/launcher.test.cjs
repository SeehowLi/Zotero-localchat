const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync,spawnSync}=require('node:child_process');
test('Start-menu launcher rejects malformed package families before invoking PowerShell',{skip:process.platform!=='win32'},t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'localchat-launcher-')),exe=path.join(root,'launcher.exe');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  execFileSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe','/platform:x64','/r:System.Windows.Forms.dll','/r:System.Web.Extensions.dll','/out:'+exe,path.join(__dirname,'../native/ChatGPTLauncher.cs')],{windowsHide:true,encoding:'utf8'});
  for(const family of ["OpenAI.Codex_fake'; Write-Output unexpected; '",'OpenAI.Codex_fake\nWrite-Output unexpected','Unrelated.Package_publisher']){
    fs.writeFileSync(path.join(root,'app-family.txt'),family,'utf8');const result=spawnSync(exe,['--inspect'],{windowsHide:true,encoding:'utf8',timeout:3000});assert.equal(result.status,1);assert.match(result.stderr,/Invalid App package family/);assert.equal(result.stdout,'');
  }
});
