param(
    [Parameter(Mandatory=$true)][string]$WorkDirectory,
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot "../../outputs/diarization-native/runtime" }
$engine = '4c101bc7113f49101a3e11d2c994c519f41939f6'
$ggml = 'c03b4e2bcece5134827881af90242086daf75be5'
$modelRevision = 'f667ed73aee57d40cc39428eb768b4fd87a0a29e'
$modelHash = '08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1'
$licenseRevision = 'b26b32b34ad2edcc29a7707abb68dcfb25a538c1'
$work = [IO.Path]::GetFullPath($WorkDirectory)
$output = [IO.Path]::GetFullPath($OutputDirectory)
if ($work.Length -gt 100) { throw 'Use a short dedicated build directory (100 characters maximum).' }
New-Item -ItemType Directory -Force -Path $work,$output | Out-Null
function Fetch-Archive([string]$Url, [string]$Target) {
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    $archive = Join-Path $Target 'source.tar.gz'
    Invoke-WebRequest -Uri $Url -OutFile $archive -UseBasicParsing -TimeoutSec 180
    & "$env:SystemRoot/System32/tar.exe" -xzf $archive -C $Target --strip-components=1 --exclude="*/python/*"
    if ($LASTEXITCODE -ne 0) { throw "Archive extraction failed: $Target" }
}
Fetch-Archive "https://github.com/NVIDIA/NeMo-Speech.cpp/archive/$engine.tar.gz" $work
Fetch-Archive "https://github.com/ggml-org/ggml/archive/$ggml.tar.gz" (Join-Path $work 'ggml')
Fetch-Archive 'https://github.com/google/sentencepiece/archive/refs/tags/v0.2.0.tar.gz' (Join-Path $work 'sp')
$spInstall = Join-Path $work 'spinstall'
& cmake -S (Join-Path $work 'sp') -B (Join-Path $work 'spbuild') -G 'Visual Studio 17 2022' -A x64 '-DCMAKE_POLICY_VERSION_MINIMUM=3.5' '-DSPM_ENABLE_SHARED=OFF' '-DSPM_BUILD_TEST=OFF' "-DCMAKE_INSTALL_PREFIX=$spInstall"
if ($LASTEXITCODE -ne 0) { throw 'SentencePiece configuration failed.' }
& cmake --build (Join-Path $work 'spbuild') --config Release --target install -j 4
if ($LASTEXITCODE -ne 0) { throw 'SentencePiece build failed.' }
& cmake -S $work -B (Join-Path $work 'build') -G 'Visual Studio 17 2022' -A x64 "-DCMAKE_PREFIX_PATH=$spInstall" '-DNEMO_SPEECH_BUILD_ASR=OFF' '-DNEMO_SPEECH_BUILD_DIAR=ON' '-DNEMO_SPEECH_BUILD_TTS=OFF' '-DNEMO_SPEECH_BUILD_MIC_CAPTURE=OFF' '-DNEMO_SPEECH_GGML_PATCHED=OFF' '-DGGML_CUDA=OFF' '-DGGML_NATIVE=OFF' '-DCMAKE_CXX_FLAGS=/DWIN32 /D_WINDOWS /EHsc /utf-8' '-DCMAKE_C_FLAGS=/DWIN32 /D_WINDOWS /utf-8'
if ($LASTEXITCODE -ne 0) { throw 'Native runtime configuration failed.' }
& cmake --build (Join-Path $work 'build') --config Release -j 4
if ($LASTEXITCODE -ne 0) { throw 'Native runtime build failed.' }
$binaryDirectory = Join-Path $work 'build/bin/Release'
Copy-Item -LiteralPath (Join-Path $binaryDirectory 'nemo-speech.exe') -Destination $output
Get-ChildItem -LiteralPath $binaryDirectory -Filter '*.dll' | Copy-Item -Destination $output
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$redist = Get-ChildItem -LiteralPath (Join-Path $vs 'VC/Redist/MSVC') -Directory | Where-Object Name -match '^14[.]' | Sort-Object Name -Descending | Select-Object -First 1
foreach ($file in @('concrt140.dll','msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll')) {
    Copy-Item -LiteralPath (Join-Path $redist.FullName "x64/Microsoft.VC143.CRT/$file") -Destination $output
}
Copy-Item -LiteralPath (Join-Path $redist.FullName 'x64/Microsoft.VC143.OpenMP/vcomp140.dll') -Destination $output
$licenses = Join-Path $output 'licenses'
New-Item -ItemType Directory -Force -Path $licenses | Out-Null
Copy-Item -LiteralPath (Join-Path $work 'LICENSE') -Destination (Join-Path $licenses 'NeMo-Speech.cpp-APACHE-2.0.txt')
Copy-Item -LiteralPath (Join-Path $work 'NOTICE') -Destination (Join-Path $licenses 'NeMo-Speech.cpp-NOTICE.txt')
Copy-Item -LiteralPath (Join-Path $work 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $licenses 'UPSTREAM-THIRD-PARTY-NOTICES.md')
Copy-Item -LiteralPath (Join-Path $work 'ggml/LICENSE') -Destination (Join-Path $licenses 'ggml-MIT.txt')
Copy-Item -LiteralPath (Join-Path $work 'sp/LICENSE') -Destination (Join-Path $licenses 'sentencepiece-APACHE-2.0.txt')
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/OpenMDW/OpenMDW/$licenseRevision/1.1/LICENSE.OpenMDW-1.1" -OutFile (Join-Path $licenses 'OpenMDW-1.1.txt') -UseBasicParsing -TimeoutSec 60
Invoke-WebRequest -Uri "https://huggingface.co/nvidia/Nemotron-3-Diarization/raw/$modelRevision/README.md" -OutFile (Join-Path $licenses 'MODEL-CARD.md') -UseBasicParsing -TimeoutSec 60
$model = Join-Path $output 'Nemotron-3-Diarization.q8_0.gguf'
if (-not (Test-Path -LiteralPath $model)) {
    Invoke-WebRequest -Uri "https://huggingface.co/nvidia/Nemotron-3-Diarization/resolve/$modelRevision/Nemotron-3-Diarization.q8_0.gguf" -OutFile $model -UseBasicParsing -TimeoutSec 300
}
if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelHash) { throw 'Model SHA256 mismatch.' }
$files = @(Get-ChildItem -LiteralPath $output -File -Recurse | Where-Object Name -ne 'manifest.json' | ForEach-Object {
    @{path=$_.FullName.Substring($output.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
@{schemaVersion=1;engineRevision=$engine;ggmlRevision=$ggml;modelRevision=$modelRevision;modelId='nvidia/Nemotron-3-Diarization';backend='cpu';cpuRequirement='x86_64 AVX2';sourceChanges='none; stock ggml, UTF8 compiler flags';files=$files} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding UTF8
Write-Output "Runtime prepared: $output"
