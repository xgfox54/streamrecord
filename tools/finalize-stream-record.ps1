# Stream-Record final validation and requested root-folder rename.
# Run only through an explicitly approved local command. No network or installation.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Parent = Split-Path -Parent $Root
$Destination = Join-Path $Parent 'Stream-Record'
if (-not (Test-Path -LiteralPath (Join-Path $Root 'STREAM_RECORD_FORK.json'))) {
    throw 'Independent-project marker is missing. Nothing was renamed.'
}
if (-not (Test-Path -LiteralPath (Join-Path $Root 'app\frontend\src-tauri\Cargo.toml'))) {
    throw 'Expected Stream-Record source is missing. Nothing was renamed.'
}
if (($Root -ne $Destination) -and (Test-Path -LiteralPath $Destination)) {
    throw 'Stream-Record already exists. No existing folder will be overwritten.'
}
$ReportDirectory = Join-Path $Root 'app\frontend\test-results'
New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null
$LogPath = Join-Path $ReportDirectory 'rust-check.log'
# The connector deliberately provides a minimal process environment. Recover
# standard per-user paths through Windows, not by assuming inherited variables.
if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    $env:USERPROFILE = [Environment]::GetFolderPath('UserProfile')
}
if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    throw 'Windows could not resolve the user profile for the Rust toolchain.'
}
if ([string]::IsNullOrWhiteSpace($env:APPDATA)) { $env:APPDATA = [Environment]::GetFolderPath('ApplicationData') }
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $env:LOCALAPPDATA = [Environment]::GetFolderPath('LocalApplicationData') }
if ([string]::IsNullOrWhiteSpace($env:SystemRoot)) { $env:SystemRoot = [Environment]::GetFolderPath('Windows') }
if ([string]::IsNullOrWhiteSpace($env:WINDIR)) { $env:WINDIR = $env:SystemRoot }
if ([string]::IsNullOrWhiteSpace($env:COMSPEC)) { $env:COMSPEC = Join-Path $env:SystemRoot 'System32\cmd.exe' }
if ([string]::IsNullOrWhiteSpace($env:ProgramFiles)) { $env:ProgramFiles = [Environment]::GetFolderPath('ProgramFiles') }
if ([string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) { ${env:ProgramFiles(x86)} = [Environment]::GetFolderPath('ProgramFilesX86') }
if ([string]::IsNullOrWhiteSpace($env:TEMP)) { $env:TEMP = Join-Path $env:LOCALAPPDATA 'Temp' }
if ([string]::IsNullOrWhiteSpace($env:TMP)) { $env:TMP = $env:TEMP }
if ([string]::IsNullOrWhiteSpace($env:CARGO_HOME)) { $env:CARGO_HOME = Join-Path $env:USERPROFILE '.cargo' }
if ([string]::IsNullOrWhiteSpace($env:RUSTUP_HOME)) { $env:RUSTUP_HOME = Join-Path $env:USERPROFILE '.rustup' }
$CargoBin = Join-Path $env:CARGO_HOME 'bin'
$env:Path = "$CargoBin;C:\Program Files\nodejs;C:\Program Files\CMake\bin;C:\Program Files\LLVM\bin;$env:SystemRoot\System32;" + $env:Path
$LocalClang = Join-Path $Root 'tools\libclang-16'
if (Test-Path -LiteralPath (Join-Path $LocalClang 'libclang.dll')) {
    $env:LIBCLANG_PATH = $LocalClang
}
$env:CFLAGS = (($env:CFLAGS + ' /utf-8').Trim())
$env:CXXFLAGS = (($env:CXXFLAGS + ' /utf-8 /EHsc').Trim())
$env:CARGO_NET_OFFLINE = 'true'
$Result = [ordered]@{
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    originalRoot = $Root
    requestedRoot = $Destination
    rustCommand = 'cargo check --locked --offline'
    rustExitCode = $null
    rustError = $null
    frontendTestsExitCode = $null
    typecheckExitCode = $null
    rustTestsExitCode = $null
    rustTestsCommand = 'cargo test --lib stream_record_ --locked --offline -- --nocapture'
    renamed = $false
    renameError = $null
    finalRoot = $Root
    sourceExists = $true
    installedExecutableUpdated = $false
}
$PreviousPreference = $ErrorActionPreference
Push-Location -LiteralPath (Join-Path $Root 'app\frontend')
try {
    $Node = (Get-Command 'node.exe' -ErrorAction Stop).Source
    $ErrorActionPreference = 'Continue'
    & $Node 'tests\stream-record.cjs' *> (Join-Path $ReportDirectory 'frontend-tests.log')
    $Result.frontendTestsExitCode = $LASTEXITCODE
    & $Node 'node_modules\typescript\bin\tsc' '--noEmit' *> (Join-Path $ReportDirectory 'typecheck.log')
    $Result.typecheckExitCode = $LASTEXITCODE
} catch { $Result.rustError = 'Frontend validation failed: ' + $_.Exception.Message }
finally { $ErrorActionPreference = $PreviousPreference; Pop-Location }
Push-Location -LiteralPath (Join-Path $Root 'app\frontend\src-tauri')
try {
    $Cargo = (Get-Command 'cargo.exe' -ErrorAction Stop).Source
    # Cargo writes ordinary diagnostics to stderr. Record them without treating each line as a terminating PowerShell error.
    $ErrorActionPreference = 'Continue'
    & $Cargo check --locked --offline *> $LogPath
    $Result.rustExitCode = $LASTEXITCODE
    if ($null -eq $Result.rustExitCode) { $Result.rustError = 'Cargo returned no process exit code.' }
    if ($Result.rustExitCode -eq 0) {
        & $Cargo test --lib stream_record_ --locked --offline -- --nocapture *> (Join-Path $ReportDirectory 'rust-tests.log')
        $Result.rustTestsExitCode = $LASTEXITCODE
    }
} catch {
    $Result.rustError = $_.Exception.Message
} finally {
    $ErrorActionPreference = $PreviousPreference
    Pop-Location
}
if (Test-Path -LiteralPath $LogPath) { Get-Content -LiteralPath $LogPath -Tail 70 }
foreach ($Name in @('frontend-tests.log', 'typecheck.log', 'rust-tests.log')) {
    $Path = Join-Path $ReportDirectory $Name
    if (Test-Path -LiteralPath $Path) { Write-Output "=== $Name ==="; Get-Content -LiteralPath $Path -Tail 40 }
}
# Naming is independent of compilation success; preserve and report any compiler failure.
try {
    if ($Root -ne $Destination) { Rename-Item -LiteralPath $Root -NewName 'Stream-Record' -ErrorAction Stop }
    $Result.renamed = $true
    $Result.finalRoot = $Destination
} catch {
    $Result.renameError = $_.Exception.Message
}
$Result.sourceExists = Test-Path -LiteralPath (Join-Path $Result.finalRoot 'app\frontend\package.json')
$Result.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
$FinalReport = Join-Path $Result.finalRoot 'app\frontend\test-results\finalization.json'
$Result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $FinalReport -Encoding UTF8
$Result | ConvertTo-Json -Depth 5 | Write-Output
if (-not $Result.renamed) { exit 2 }
if (($Result.rustExitCode -ne 0) -or ($Result.rustTestsExitCode -ne 0) -or ($Result.frontendTestsExitCode -ne 0) -or ($Result.typecheckExitCode -ne 0) -or $Result.rustError) { exit 1 }
exit 0
