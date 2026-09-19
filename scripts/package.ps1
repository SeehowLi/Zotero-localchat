$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
& (Join-Path $PSScriptRoot 'build-native.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dist=Join-Path $root 'dist'
[IO.Directory]::CreateDirectory($dist) | Out-Null
$xpi=Join-Path $dist 'Zotero-localchat-0.4.4.xpi'
if(Test-Path -LiteralPath $xpi){Remove-Item -LiteralPath $xpi}
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $root 'addon'),$xpi)
$addonArchive=[IO.Compression.ZipFile]::Open($xpi,'Update')
try {
  # Zotero enumerates locale directories as explicit ZIP entries.
  foreach($dir in Get-ChildItem -LiteralPath (Join-Path $root 'addon') -Directory -Recurse){
    $entry=$dir.FullName.Substring((Join-Path $root 'addon').Length+1).Replace('\','/')+'/'
    if(-not $addonArchive.GetEntry($entry)){$directoryEntry=$addonArchive.CreateEntry($entry);$directoryEntry.ExternalAttributes=16}
  }
} finally {$addonArchive.Dispose()}
$zip=Join-Path $dist 'Zotero-localchat-0.4.4-windows.zip'
if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip}
$archive=[IO.Compression.ZipFile]::Open($zip,'Create')
try {
  foreach($folder in @('bridge','scripts','native','bin','docs')) {
    foreach($file in Get-ChildItem -LiteralPath (Join-Path $root $folder) -File -Recurse) {
      $relative=$file.FullName.Substring($root.Length+1).Replace('\','/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,$relative) | Out-Null
    }
  }
  foreach($name in @('README.md','LICENSE','Start-LocalChat.cmd','Stop-LocalChat.cmd')){[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $root $name),$name) | Out-Null}
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$xpi,'Zotero-localchat-0.4.4.xpi') | Out-Null
} finally {$archive.Dispose()}
Write-Host $zip
