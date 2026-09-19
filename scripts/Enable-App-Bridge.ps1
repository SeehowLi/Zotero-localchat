$ErrorActionPreference='Stop'
$package=Get-AppxPackage | Where-Object { $_.Name -match '^OpenAI\.(Codex|ChatGPT)' } | Sort-Object Version -Descending | Select-Object -First 1
if(-not $package){throw '未找到已安装的 ChatGPT App'}
$exe=Join-Path $package.InstallLocation 'app\ChatGPT.exe'
if(-not(Test-Path -LiteralPath $exe)){throw '此 App 版本没有可识别的 ChatGPT.exe'}
$shortcutPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'ChatGPT - Local Chat.lnk'
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath=$exe
$shortcut.Arguments='--remote-debugging-address=127.0.0.1 --remote-debugging-port=23129'
$shortcut.WorkingDirectory=Split-Path $exe
$shortcut.Save()
Write-Host '已创建桌面快捷方式。首次设置时，请在 ChatGPT 菜单中退出 App，再用 ChatGPT - Local Chat 快捷方式打开。无需退出账号。'
