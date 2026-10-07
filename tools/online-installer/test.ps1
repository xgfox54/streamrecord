[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [Parameter(Mandatory=$true)][string]$DownloaderPath,
 [Parameter(Mandatory=$true)][string]$NoticesPath,
 [switch]$DownloadsOnly
)
$ErrorActionPreference='Stop'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$testRoot=[IO.Path]::GetFullPath($OutputDirectory)
$null=New-Item -ItemType Directory -Path $testRoot -Force
$helper=[IO.Path]::GetFullPath($DownloaderPath)
$notices=[IO.Path]::GetFullPath($NoticesPath)
$metadata=Join-Path $testRoot 'DOWNLOADER.json'
$json=@{name='streamrecord-download.exe';bytes=(Get-Item -LiteralPath $helper).Length;sha256=(Get-FileHash -LiteralPath $helper).Hash.ToLowerInvariant()}|ConvertTo-Json
[IO.File]::WriteAllText($metadata,$json,[Text.UTF8Encoding]::new($false))
$fixture=Join-Path $testRoot 'fixture-installer.exe'
$tests=Join-Path $testRoot 'installer-tests.exe'
& $compiler /nologo /target:exe /warnaserror+ /utf8output "/out:$fixture" "$PSScriptRoot\FixtureInstaller.cs"
if($LASTEXITCODE -ne 0){throw 'Fixture compilation failed'}
& $compiler /nologo /target:exe /main:StreamRecordSetup.Tests /warnaserror+ /utf8output "/out:$tests" /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/resource:$PSScriptRoot\release.json,release.json" "/resource:$helper,download-helper.exe" "/resource:$metadata,downloader.json" "/resource:$notices,THIRD_PARTY_NOTICES.txt" "$PSScriptRoot\Download.cs" "$PSScriptRoot\NativeTransport.cs" "$PSScriptRoot\Install.cs" "$PSScriptRoot\Program.cs" "$PSScriptRoot\Tests.cs"
if($LASTEXITCODE -ne 0){throw 'Test compilation failed'}
if($DownloadsOnly){& $tests --downloads-only}else{& $tests}
if($LASTEXITCODE -ne 0){throw 'Installer tests failed'}
