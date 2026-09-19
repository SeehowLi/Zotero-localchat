$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nativeOutput = Join-Path $projectRoot 'bin'
New-Item -ItemType Directory -Path $nativeOutput -Force | Out-Null
$nativeCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$nativeWpf = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\WPF'
& $nativeCompiler /nologo /target:exe /platform:x64 /optimize+ /r:System.Web.Extensions.dll ("/r:"+(Join-Path $nativeWpf 'UIAutomationClient.dll')) ("/r:"+(Join-Path $nativeWpf 'UIAutomationTypes.dll')) ("/r:"+(Join-Path $nativeWpf 'WindowsBase.dll')) ("/out:"+(Join-Path $nativeOutput 'LocalChatWindow.exe')) (Join-Path $projectRoot 'native\WindowHost.cs')
if ($LASTEXITCODE -ne 0) { throw 'LocalChat window helper build failed' }
