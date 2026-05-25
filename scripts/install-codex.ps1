param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ConfigPath = (Join-Path $env:USERPROFILE ".codex\config.toml"),
  [string]$ServerName = "seedance-movie",
  [string]$NodeVersion = "v24.16.0",
  [string]$ArkModel = "doubao-seedance-2-0-260128",
  [string]$ArkBaseUrl = "https://ark.cn-beijing.volces.com/api/v3",
  [string]$ArkMaxConcurrency = "3",
  [string]$FfmpegPath = "ffmpeg",
  [switch]$SkipBuild,
  [switch]$UpdateSource
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[seedance-movie] $Message"
}

function Ensure-Node {
  param(
    [string]$Root,
    [string]$Version
  )

  $arch = "win-x64"
  $runtimeDir = Join-Path $Root ".mcp-runtime"
  $nodeDir = Join-Path $runtimeDir "node-$Version-$arch"
  $nodeExe = Join-Path $nodeDir "node.exe"
  $npmCmd = Join-Path $nodeDir "npm.cmd"

  if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $npmCmd)) {
    return @{
      NodeExe = $nodeExe
      NpmCmd = $npmCmd
      NodeDir = $nodeDir
    }
  }

  Write-Step "Installing Node.js $Version to $runtimeDir"
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

  $zipName = "node-$Version-$arch.zip"
  $zipPath = Join-Path $runtimeDir $zipName
  $distUrl = "https://nodejs.org/dist/$Version/$zipName"
  $shaUrl = "https://nodejs.org/dist/$Version/SHASUMS256.txt"

  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  if (Test-Path -LiteralPath $nodeDir) {
    Remove-Item -LiteralPath $nodeDir -Recurse -Force
  }

  Invoke-WebRequest -Uri $distUrl -OutFile $zipPath
  $expectedLine = (Invoke-WebRequest -Uri $shaUrl).Content -split "`n" | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1
  if (-not $expectedLine) {
    throw "Cannot find checksum for $zipName"
  }
  $expectedHash = ($expectedLine -split "\s+")[0].ToUpperInvariant()
  $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "SHA256 mismatch for $zipName"
  }

  tar -xf $zipPath -C $runtimeDir
  if (!(Test-Path -LiteralPath $nodeExe) -or !(Test-Path -LiteralPath $npmCmd)) {
    throw "Node.js install did not create expected files in $nodeDir"
  }

  return @{
    NodeExe = $nodeExe
    NpmCmd = $npmCmd
    NodeDir = $nodeDir
  }
}

function Update-SourceIfRequested {
  param([string]$Root)

  if (-not $UpdateSource) {
    return
  }
  if (!(Test-Path -LiteralPath (Join-Path $Root ".git"))) {
    Write-Step "Skipping source update because this folder is not a git repository"
    return
  }

  Write-Step "Updating source with git pull --ff-only"
  git -C $Root pull --ff-only
}

function Ensure-Build {
  param(
    [string]$Root,
    [string]$NpmCmd
  )

  if ($SkipBuild) {
    return
  }

  Write-Step "Installing dependencies"
  & $NpmCmd install --prefix $Root
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed"
  }

  Write-Step "Building TypeScript output"
  & $NpmCmd run build --prefix $Root
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed"
  }
}

function Remove-TomlTable {
  param(
    [string[]]$Lines,
    [string]$TableName
  )

  $result = New-Object System.Collections.Generic.List[string]
  $inTargetTable = $false
  $tableHeader = "[$TableName]"

  foreach ($line in $Lines) {
    $trimmed = $line.Trim()
    if ($trimmed -eq $tableHeader) {
      $inTargetTable = $true
      continue
    }
    if ($inTargetTable -and $trimmed.StartsWith("[") -and $trimmed.EndsWith("]")) {
      $inTargetTable = $false
    }
    if (-not $inTargetTable) {
      $result.Add($line)
    }
  }

  return $result.ToArray()
}

function Write-CodexConfig {
  param(
    [string]$Path,
    [string]$Name,
    [string]$Root,
    [string]$NodeExe,
    [string]$Model,
    [string]$BaseUrl,
    [string]$MaxConcurrency,
    [string]$Ffmpeg
  )

  $configDir = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $configDir | Out-Null

  $lines = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path } else { @() }
  $backupPath = "$Path.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  if (Test-Path -LiteralPath $Path) {
    Copy-Item -LiteralPath $Path -Destination $backupPath
    Write-Step "Backed up existing Codex config to $backupPath"
  }

  $serverTable = "mcp_servers.$Name"
  $envTable = "mcp_servers.$Name.env"
  $lines = Remove-TomlTable -Lines $lines -TableName $serverTable
  $lines = Remove-TomlTable -Lines $lines -TableName $envTable

  $startScript = Join-Path $Root "scripts\start-mcp.mjs"
  $block = @(
    "",
    "[$serverTable]",
    'type = "stdio"',
    "command = '$NodeExe'",
    "args = ['$startScript']",
    "startup_timeout_sec = 120",
    "",
    "[$envTable]",
    "ARK_MODEL = `"$Model`"",
    "ARK_BASE_URL = `"$BaseUrl`"",
    "ARK_MAX_CONCURRENCY = `"$MaxConcurrency`"",
    "FFMPEG_PATH = `"$Ffmpeg`"",
    "# Set ARK_API_KEY as a Windows user environment variable or add it here locally.",
    "# Optional: SEEDANCE_STORY_SKILL_PATH = `"C:\\path\\to\\story-skill.md`""
  )

  Set-Content -LiteralPath $Path -Value ($lines + $block) -Encoding UTF8
  Write-Step "Installed MCP server '$Name' into $Path"
}

$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
Update-SourceIfRequested -Root $resolvedRoot
$node = Ensure-Node -Root $resolvedRoot -Version $NodeVersion
Ensure-Build -Root $resolvedRoot -NpmCmd $node.NpmCmd
Write-CodexConfig `
  -Path $ConfigPath `
  -Name $ServerName `
  -Root $resolvedRoot `
  -NodeExe $node.NodeExe `
  -Model $ArkModel `
  -BaseUrl $ArkBaseUrl `
  -MaxConcurrency $ArkMaxConcurrency `
  -Ffmpeg $FfmpegPath

Write-Step "Checking launcher"
& $node.NodeExe (Join-Path $resolvedRoot "scripts\start-mcp.mjs") --check
if ($LASTEXITCODE -ne 0) {
  throw "MCP launcher check failed"
}

Write-Step "Done. Restart Codex Desktop or Codex CLI to load the new MCP server."
