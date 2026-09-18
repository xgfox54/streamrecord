# Stream-Record release helper. Invoke only through an owner-approved release command.
param(
    [Parameter(Mandatory=$true)][ValidateSet('Inspect','Locate','Close','Install','Token','FunctionsOnly')][string]$Action,
    [string]$SourceRoot,
    [string]$Installer,
    [string]$ExpectedExe
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Test-ProductName([string]$Name) {
    # Installer display names can include the product version. Do not match unrelated Meetily products.
    return $Name.Trim() -match '(?i)^stream[- _]?record(?:\.exe)?(?:\s+v?\d[0-9a-z.+_-]*)?$'
}
function Get-ExecutableFromRegistration([string]$Value) {
    $expanded = [Environment]::ExpandEnvironmentVariables($Value.Trim())
    if ($expanded -match '^\s*"([^"]+\.exe)"') { return $Matches[1] }
    if ($expanded -match '^\s*(.+?\.exe)(?=\s|,|$)') { return $Matches[1] }
    return $null
}
function Get-VerifiedInstallation([string]$Exe, [string]$Evidence, [string]$RegisteredVersion = '') {
    if (-not $Exe) { return $null }
    try {
        $full = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Exe.Trim().Trim('"')))
        if ([IO.Path]::GetFileName($full) -ine 'stream-record.exe') { return $null }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return $null }
        $file = Get-Item -LiteralPath $full
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $null }
        if (-not (Test-ProductName ([string]$file.VersionInfo.ProductName))) { return $null }
        $dir = $file.DirectoryName
        if ($SourceRoot) {
            $source = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
            if ($dir -ieq $source -or $dir.StartsWith($source + '\',[StringComparison]::OrdinalIgnoreCase)) { return $null }
        }
        if ($dir -ieq [IO.Path]::GetPathRoot($dir)) { return $null }
        # Do not mistake a downloaded installer (also named stream-record.exe) for the installed application.
        $companions = @('onnxruntime.dll','ffmpeg.exe','ffmpeg-x86_64-pc-windows-msvc.exe','llama-helper.exe','llama-helper-x86_64-pc-windows-msvc.exe','uninstall.exe','uninst.exe')
        if (-not @($companions | Where-Object { Test-Path -LiteralPath (Join-Path $dir $_) -PathType Leaf }).Count) { return $null }
        $version = $RegisteredVersion
        if (-not $version) { $version = [string]$file.VersionInfo.ProductVersion }
        return [pscustomobject]@{installDir=$dir;exe=$full;displayVersion=$version;fileVersion=[string]$file.VersionInfo.FileVersion;evidence=$Evidence}
    } catch { return $null }
}
function Get-InstallationCandidates {
    $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
    $found = @()
    foreach ($key in $keys) {
        if (-not (Test-Path -LiteralPath $key)) { continue }
        foreach ($subkey in @(Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue)) {
            $item = Get-ItemProperty -LiteralPath $subkey.PSPath -ErrorAction SilentlyContinue
            if (-not (Test-ProductName ([string]$item.DisplayName))) { continue }
            $paths = @()
            $dir = [Environment]::ExpandEnvironmentVariables(([string]$item.InstallLocation).Trim().Trim('"'))
            if ($dir) { $paths += Join-Path $dir 'stream-record.exe' }
            $icon = Get-ExecutableFromRegistration ([string]$item.DisplayIcon)
            if ($icon) { $paths += $icon }
            foreach ($value in @($item.UninstallString,$item.QuietUninstallString)) {
                $uninstaller = Get-ExecutableFromRegistration ([string]$value)
                if ($uninstaller) { $paths += Join-Path (Split-Path -Parent $uninstaller) 'stream-record.exe' }
            }
            foreach ($candidate in $paths) {
                $verified = Get-VerifiedInstallation $candidate ('registry:' + $subkey.Name) ([string]$item.DisplayVersion)
                if ($verified) { $found += $verified }
            }
        }
    }
    # A missing uninstaller entry must not force an arbitrary default install path.
    # Check only bounded, product-specific per-user locations and verify executable metadata and companions.
    $local = [Environment]::GetFolderPath('LocalApplicationData')
    if ($local) {
        foreach ($relative in @('stream-record','Stream-Record','Programs\stream-record','Programs\Stream-Record')) {
            $candidate = Get-VerifiedInstallation (Join-Path (Join-Path $local $relative) 'stream-record.exe') 'verified-per-user-location'
            if ($candidate) { $found += $candidate }
        }
    }
    return @($found | Sort-Object exe -Unique)
}
function Get-Installation {
    if ($ExpectedExe) {
        $selected = Get-VerifiedInstallation $ExpectedExe 'previously-selected-and-revalidated'
        if (-not $selected) { throw 'The previously selected installation is no longer valid. Nothing was installed.' }
        return $selected
    }
    $found = @(Get-InstallationCandidates)
    if ($found.Count -eq 1) { return $found[0] }
    if ($Action -ne 'Locate') { throw "Found $($found.Count) verified installations. Select the actual installed executable; no default path was assumed." }
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Stream-Record: select the existing installed stream-record.exe (not the downloaded installer)'
    $picker.Filter = 'Installed Stream-Record (stream-record.exe)|stream-record.exe'
    $picker.CheckFileExists = $true; $picker.Multiselect = $false
    try {
        if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'Installation selection cancelled. No files were replaced.' }
        $selected = Get-VerifiedInstallation $picker.FileName 'explicit-user-selection'
        if (-not $selected) { throw 'Select the installed application with its runtime files, not a downloaded setup file or a development build.' }
        return $selected
    } finally { $picker.Dispose() }
}
if ($Action -eq 'FunctionsOnly') { return }
if ($Action -eq 'Token') {
    # The caller captures stdout privately in memory. Do not transcript this branch or print the value to logs.
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Stream-Record - GitLab access token'
    $form.ClientSize = New-Object System.Drawing.Size(590,225)
    $form.StartPosition = 'CenterScreen'; $form.TopMost = $true
    $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false; $form.MinimizeBox = $false
    $label = New-Object System.Windows.Forms.Label
    $label.Text = "GitLab: gitlab.aigov.go.kr / memory365/streamrecord`r`nEnter an access token with api access to publish source and release assets.`r`nThe token is masked, used in memory, and not saved in the project or chat."
    $label.Location = New-Object System.Drawing.Point(18,16)
    $label.Size = New-Object System.Drawing.Size(550,75)
    $box = New-Object System.Windows.Forms.TextBox
    $box.Location = New-Object System.Drawing.Point(18,100); $box.Size = New-Object System.Drawing.Size(550,28)
    $box.UseSystemPasswordChar = $true; $box.MaxLength = 512
    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = 'Use token'; $ok.Location = New-Object System.Drawing.Point(345,155); $ok.Size = New-Object System.Drawing.Size(105,32)
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Cancel'; $cancel.Location = New-Object System.Drawing.Point(460,155); $cancel.Size = New-Object System.Drawing.Size(105,32)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.AddRange(@($label,$box,$ok,$cancel)); $form.AcceptButton = $ok; $form.CancelButton = $cancel
    $form.Add_Shown({ $box.Focus() })
    try {
        if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK -or -not $box.Text.Trim()) { exit 3 }
        [Console]::Write($box.Text.Trim())
    } finally { $box.Clear(); $form.Dispose() }
    exit 0
}
if ($Action -eq 'Inspect') {
    $candidates = @(Get-InstallationCandidates)
    [pscustomobject]@{candidates=$candidates;count=$candidates.Count;selectionRequired=($candidates.Count -ne 1)} | ConvertTo-Json -Depth 5 -Compress
    exit 0
}
if ($Action -eq 'Locate') { Get-Installation | ConvertTo-Json -Compress; exit 0 }
if ($Action -eq 'Close') {
    $installed = Get-Installation
    $prefix = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\') + '\'
    foreach ($p in @(Get-Process -Name 'stream-record' -ErrorAction SilentlyContinue)) {
        $processPath = $p.Path
        if (-not $processPath) { throw 'A Stream-Record process cannot be inspected; close the application manually.' }
        if ($processPath -ieq $installed.exe -or $processPath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) {
            if ($p.MainWindowHandle -eq 0 -or -not $p.CloseMainWindow()) { throw 'Stream-Record is still running. Finish recording and exit the application manually.' }
            try { $p.WaitForExit(8000) | Out-Null } catch {}
            $p.Refresh()
            if (-not $p.HasExited) { throw 'The application did not close. No process was force-killed; finish any active work first.' }
        }
    }
    Write-Output '{"closed":true,"forceKilled":false}'
    exit 0
}
if ($Action -eq 'Install') {
    $before = Get-Installation
    if (-not (Test-Path -LiteralPath $Installer -PathType Leaf) -or [IO.Path]::GetExtension($Installer) -ine '.exe') { throw 'A verified installer file is required.' }
    if (@(Get-Process -Name 'stream-record' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Close Stream-Record before installing. No process was killed.' }
    # NSIS requires /D= to be last and unquoted; its value comes from a verified existing executable.
    if ($before.installDir -match '[\r\n"]') { throw 'Unsupported installation path.' }
    $p = Start-Process -FilePath $Installer -ArgumentList ('/S /D=' + $before.installDir) -WindowStyle Hidden -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Installer returned exit code $($p.ExitCode)." }
    $after = Get-Installation
    if ($after.installDir -ine $before.installDir) { throw 'Installer changed the installation directory; verify the installation before publication.' }
    $after | ConvertTo-Json -Compress
}
