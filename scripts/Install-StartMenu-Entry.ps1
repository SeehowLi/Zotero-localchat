param([switch]$VerifyOnly)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$destination=Join-Path $env:USERPROFILE '.zotero-localchat\app-launcher'
$shortcutPath=Join-Path $destination 'ChatGPT.lnk'
$exe=Join-Path $destination 'ChatGPTLauncher.exe'
$package=Get-AppxPackage | Where-Object { $_.Name -match '^OpenAI\.(Codex|ChatGPT)$' } | Sort-Object @{Expression={if($_.Name -eq 'OpenAI.Codex'){0}else{1}}},Version | Select-Object -First 1
if(-not $package){throw '未找到已安装的 ChatGPT App'}
$shell=New-Object -ComObject WScript.Shell
if(-not $VerifyOnly){
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $icon=Join-Path $package.InstallLocation 'app\resources\chatgpt-app-dark.ico'
    if(-not(Test-Path -LiteralPath $icon)){throw '未找到原 App 图标'}
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll ("/win32icon:"+$icon) ("/out:"+$exe) (Join-Path $root 'native\ChatGPTLauncher.cs')
    if($LASTEXITCODE -ne 0){throw '启动入口构建失败'}
    [IO.File]::WriteAllText((Join-Path $destination 'app-family.txt'),$package.PackageFamilyName,[Text.UTF8Encoding]::new($false))
    Copy-Item -LiteralPath $icon -Destination (Join-Path $destination 'chatgpt.ico') -Force
    if(Test-Path -LiteralPath $shortcutPath){
        $old=$shell.CreateShortcut($shortcutPath)
        if($old.TargetPath -ne $exe){$backup=Join-Path $destination 'previous-ChatGPT.lnk';if(Test-Path -LiteralPath $backup){throw '已有入口备份，请先检查再覆盖'};Copy-Item -LiteralPath $shortcutPath -Destination $backup}
    }
    $link=$shell.CreateShortcut($shortcutPath);$link.TargetPath=$exe;$link.Arguments='';$link.WorkingDirectory=$destination;$link.IconLocation=(Join-Path $destination 'chatgpt.ico')+',0';$link.Description='打开已安装的 ChatGPT，并启用 Zotero 本地连接';$link.Save()
}
# Resolve the actual installed App and verify the exact launch arguments without opening it.
$probeInfo=[Diagnostics.ProcessStartInfo]::new($exe,'--inspect');$probeInfo.UseShellExecute=$false;$probeInfo.CreateNoWindow=$true;$probeInfo.RedirectStandardOutput=$true;$probeInfo.RedirectStandardError=$true;$probeInfo.StandardOutputEncoding=[Text.Encoding]::UTF8
$probe=[Diagnostics.Process]::Start($probeInfo)
try { if(-not $probe.WaitForExit(20000)){$probe.Kill();throw '启动入口验证超时'};$resolvedText=$probe.StandardOutput.ReadToEnd();if($probe.ExitCode -ne 0){throw ('ChatGPT 启动入口验证失败：'+$probe.StandardError.ReadToEnd())} } finally {$probe.Dispose()}
$resolved=$resolvedText | ConvertFrom-Json
$registered=$shell.CreateShortcut($shortcutPath)
if($registered.TargetPath -ne $exe -or $resolved.executable -ne (Join-Path $package.InstallLocation 'app\ChatGPT.exe') -or $resolved.arguments -ne '--remote-debugging-address=127.0.0.1 --remote-debugging-port=23129'){throw '启动入口校验不一致'}
[pscustomobject]@{Shortcut=$shortcutPath;Name='ChatGPT';Verified=$true;AppVersion=$package.Version.ToString();StartsExistingApp=$true}
