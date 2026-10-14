param(
    [string]$Version = '0.1.0',
    [string]$InnoSetupCompiler
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repositoryRoot 'src/GameChatOverlay/GameChatOverlay.csproj'
$publishDirectory = Join-Path $repositoryRoot 'artifacts/installer/publish'
$installerScript = Join-Path $repositoryRoot 'installer/Agripa.iss'

if (-not $InnoSetupCompiler) {
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { $InnoSetupCompiler = $command.Source }
    else {
        $candidates = @(@(
            (Join-Path $env:LOCALAPPDATA 'Programs/Inno Setup 6/ISCC.exe'),
            (Join-Path $env:ProgramFiles 'Inno Setup 6/ISCC.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe')
        ) | Where-Object { $_ -and (Test-Path $_) })
        if ($candidates.Count -gt 0) { $InnoSetupCompiler = $candidates[0] }
    }
}
if (-not $InnoSetupCompiler -or -not (Test-Path $InnoSetupCompiler)) {
    throw 'Inno Setup 6 compiler (ISCC.exe) not found. Install Inno Setup 6 or pass -InnoSetupCompiler.'
}

New-Item -ItemType Directory -Path $publishDirectory -Force | Out-Null
dotnet publish $project `
    -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $publishDirectory
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }
if (-not (Test-Path (Join-Path $publishDirectory 'Agripa.exe'))) {
    throw 'Publish succeeded but Agripa.exe is missing.'
}

& $InnoSetupCompiler "/DAppVersion=$Version" "/DPublishDir=$publishDirectory" $installerScript
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed with exit code $LASTEXITCODE" }
Write-Host "Installer: $(Join-Path $repositoryRoot 'artifacts/installer/Agripa-Setup-win-x64.exe')"
