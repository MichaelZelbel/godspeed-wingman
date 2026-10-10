# The Wingman, an add-on for Godspeed Mission Control: the installer for Windows.
#
#   irm https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.ps1 | iex
#
# With options for the setup (for example a mission control folder it does not find by itself):
#
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.ps1))) --godspeed D:\my-mission-control
#
# What it does:
#   1. Finds Node.js 22 or newer: on the PATH, the Node that Hermes brings (%LOCALAPPDATA%\hermes\node),
#      the one Godspeed Mission Control brings (%LOCALAPPDATA%\Godspeed Mission Control*\payload\runtime),
#      or C:\Program Files\nodejs. It installs nothing of its own.
#   2. Downloads the newest release of the Wingman from GitHub (main, when there is no release yet)
#      into a temporary folder. GODSPEED_WINGMAN_REF=<tag or branch> picks another one.
#   3. Stops a Wingman that already runs here, so the update takes effect.
#   4. Runs the Wingman's setup with your options. The setup copies the program to
#      %USERPROFILE%\.godspeed\addons\godspeed-wingman, adds the godspeed-wingman command to
#      %USERPROFILE%\.godspeed\bin, makes the private folder %USERPROFILE%\.godspeed\wingman, writes
#      your files in <mission control>\routines\wingman (never over files you already have), copies
#      the recipes to <mission control>\skills, connects Hermes and Claude Code when it finds them,
#      and adds the scheduled task "Godspeed Wingman" that starts the worker when you log in.
#   5. Deletes the temporary folder.
#
# What it asks: nothing itself. The setup then opens the setup questions in your browser (the
# Wingman's desk), or asks them in this window when no browser can be opened.
#
# What only you do: answer the setup questions (your taste is yours; nobody fills it in for you),
# log into your dating site once in the Wingman's own browser, and answer the first practice round.
#
# Safe to run again: it is also the update. Your preferences, watch list, settings and everything
# the Wingman kept stay as they are. To take it out: godspeed-wingman uninstall

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $Repo = 'MichaelZelbel/godspeed-wingman'
  $setupArgs = @($args)

  function Say([string]$text) { Write-Host $text }
  function Fail([string]$text) { Write-Host $text -ForegroundColor Red }

  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

  # 1. Node.js 22 or newer.
  function NodeMajor([string]$exe) {
    try {
      $v = (& $exe --version 2>$null | Select-Object -First 1)
      if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
    } catch { }
    return 0
  }
  $local = $env:LOCALAPPDATA
  if (-not $local) { $local = Join-Path $env:USERPROFILE 'AppData\Local' }
  $candidates = New-Object System.Collections.Generic.List[string]
  $onPath = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($onPath) { $candidates.Add($onPath.Source) }
  $candidates.Add((Join-Path $local 'hermes\node\node.exe'))
  Get-ChildItem -Path $local -Directory -Filter 'Godspeed Mission Control*' -ErrorAction SilentlyContinue | ForEach-Object {
    $candidates.Add((Join-Path $_.FullName 'payload\runtime\node.exe'))
  }
  if ($env:USERPROFILE) {
    Get-ChildItem -Path (Join-Path $env:USERPROFILE '.hermes\tools') -Directory -Filter 'node-*' -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending | ForEach-Object { $candidates.Add((Join-Path $_.FullName 'node.exe')) }
  }
  if ($env:ProgramFiles) { $candidates.Add((Join-Path $env:ProgramFiles 'nodejs\node.exe')) }
  $node = $null
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf) -and ((NodeMajor $c) -ge 22)) { $node = $c; break }
  }
  if (-not $node) {
    Fail 'The Wingman needs Node.js 22 or newer, and none was found on this computer.'
    Say 'Install Godspeed Mission Control first (it brings its own Node), or Node.js LTS from https://nodejs.org'
    Say '(or in PowerShell: winget install OpenJS.NodeJS.LTS), then run this line again in a new window.'
    return
  }

  # 2. The newest release, or main.
  $ref = $env:GODSPEED_WINGMAN_REF
  if (-not $ref) {
    try {
      $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'godspeed-wingman-installer' } -TimeoutSec 30
      $ref = $rel.tag_name
    } catch { $ref = $null }
    if (-not $ref) { $ref = 'main' }
  }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("godspeed-wingman-" + [Guid]::NewGuid().ToString('N').Substring(0, 12))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'wingman.zip'
    $url = "https://codeload.github.com/$Repo/zip/$ref"
    try {
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 120
    } catch {
      Fail "Could not download the Wingman ($ref) from GitHub: $($_.Exception.Message)"
      Say 'Check the internet connection and run this line again.'
      return
    }
    $unpacked = Join-Path $tmp 'src'
    Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force
    $pkg = Get-ChildItem -LiteralPath $unpacked -Directory | Select-Object -First 1
    $script = if ($pkg) { Join-Path $pkg.FullName 'bin\godspeed-wingman.mjs' } else { $null }
    if (-not $script -or -not (Test-Path -LiteralPath $script)) {
      Fail 'The download did not hold the Wingman. Run this line again in a few minutes.'
      return
    }
    Say "The Wingman ($ref), with Node $(& $node --version) at $node"

    # 3. A worker that already runs keeps the old program in memory: stop it, the setup starts the new one.
    $state = $env:GODSPEED_WINGMAN_STATE
    for ($i = 0; $i -lt $setupArgs.Count - 1; $i++) { if ($setupArgs[$i] -eq '--state') { $state = $setupArgs[$i + 1] } }
    if (-not $state) { $state = Join-Path $env:USERPROFILE '.godspeed\wingman' }
    $pidFile = Join-Path $state 'worker.pid'
    if (Test-Path -LiteralPath $pidFile) {
      $old = 0
      [void][int]::TryParse(((Get-Content -LiteralPath $pidFile -Raw) -replace '\s', ''), [ref]$old)
      $proc = if ($old -gt 0) { Get-Process -Id $old -ErrorAction SilentlyContinue } else { $null }
      if ($proc -and $proc.ProcessName -eq 'node') {
        Stop-Process -Id $old -Force -ErrorAction SilentlyContinue
        Say 'Stopped the running Wingman for the update; the setup starts it again.'
      }
    }

    # 4. The setup, with the options given to this line.
    & $node $script setup @setupArgs
    if ($LASTEXITCODE -ne 0) {
      Fail "The setup stopped (exit $LASTEXITCODE). What it printed above says why; run this line again once that is fixed."
    }
  } finally {
    # 5. The temporary folder.
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
} @args
