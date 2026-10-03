[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$destination=Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'Stream-Record-0.6.4-online-cpu-setup.exe'
 $manifestOption="/win32manifest:$PSScriptRoot\app.manifest"
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /warnaserror+ /utf8output "/out:$destination" $manifestOption "/win32icon:$PSScriptRoot\..\..\app\frontend\src-tauri\icons\icon.ico" "/resource:$PSScriptRoot\release.json,release.json" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Runtime.Serialization.dll "$PSScriptRoot\Download.cs" "$PSScriptRoot\Install.cs" "$PSScriptRoot\Program.cs"
if($LASTEXITCODE -ne 0) { throw 'Online installer compilation failed' }
Write-Output $destination
