[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory,[Parameter(Mandatory=$true)][string]$DownloaderPath,[Parameter(Mandatory=$true)][string]$NoticesPath)
$ErrorActionPreference='Stop'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$release=Get-Content -LiteralPath "$PSScriptRoot\release.json" -Raw | ConvertFrom-Json
$destination=Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) "Stream-Record-$($release.version)-online-cpu-win10-win11-setup.exe"
$helperInfo=Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'DOWNLOADER.json'
$helperJson=@{name='streamrecord-download.exe';bytes=(Get-Item -LiteralPath $DownloaderPath).Length;sha256=(Get-FileHash -LiteralPath $DownloaderPath -Algorithm SHA256).Hash.ToLowerInvariant();transport='reqwest 0.13.5 / Rustls / TLS 1.3';platform='Windows 10+ x64';crt='static'} | ConvertTo-Json
[IO.File]::WriteAllText($helperInfo,$helperJson,[Text.UTF8Encoding]::new($false))
 $manifestOption="/win32manifest:$PSScriptRoot\app.manifest"
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /warnaserror+ /utf8output "/out:$destination" $manifestOption "/win32icon:$PSScriptRoot\..\..\app\frontend\src-tauri\icons\icon.ico" "/resource:$PSScriptRoot\release.json,release.json" "/resource:$DownloaderPath,download-helper.exe" "/resource:$helperInfo,downloader.json" "/resource:$NoticesPath,THIRD_PARTY_NOTICES.txt" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Runtime.Serialization.dll "$PSScriptRoot\Download.cs" "$PSScriptRoot\NativeTransport.cs" "$PSScriptRoot\Install.cs" "$PSScriptRoot\Program.cs"
if($LASTEXITCODE -ne 0) { throw 'Online installer compilation failed' }
Write-Output $destination
