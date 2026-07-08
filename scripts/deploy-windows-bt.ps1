param(
  [string]$Repo = "LindongCityServer/ldpass",
  [string]$Ref = "",
  [switch]$UseLatestRelease,
  [string]$Domain = "ldpass.shangxiaoguan.top",
  [int]$AppPort = 3200,
  [string]$Pm2Name = "ldpass-web",
  [string]$PnpmVersion = "10.14.0",
  [string]$NodePath = "C:\BtSoft\nodejs\v24.15.0\node.exe",
  [string]$NpxPath = "C:\BtSoft\nodejs\v24.15.0\npx.cmd",
  [string]$Pm2Path = "C:\BtSoft\pm2\18.6.0\pm2.cmd",
  [string]$NginxPath = "C:\BtSoft\nginx\nginx.exe",
  [int]$HealthTimeoutSeconds = 90,
  [int]$KeepReleases = 5,
  [switch]$SkipDbPush,
  [switch]$SkipNginxReload,
  [switch]$SkipPublicCheck,
  [switch]$AllowPublicCheckFailure,
  [switch]$EnableSharedNextStatic
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Write-Detail {
  param([string]$Message)
  Write-Host "    $Message"
}

function Fail {
  param([string]$Message)
  throw $Message
}

function Resolve-Tool {
  param(
    [string]$Path,
    [string]$Name
  )

  if ($Path -and (Test-Path -LiteralPath $Path)) {
    return (Resolve-Path -LiteralPath $Path).Path
  }

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  Fail "找不到 $Name。已检查 '$Path' 和 PATH。"
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Push-Location -LiteralPath $WorkingDirectory
  try {
    Write-Host "+ $FilePath $($Arguments -join ' ')"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      Fail "命令退出码为 $LASTEXITCODE：$FilePath $($Arguments -join ' ')"
    }
  }
  finally {
    Pop-Location
  }
}

function Invoke-Pnpm {
  param(
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Invoke-Checked `
    -FilePath $script:Npx `
    -Arguments (@("--yes", "pnpm@$PnpmVersion") + $Arguments) `
    -WorkingDirectory $WorkingDirectory
}

function Set-TextFileNoBom {
  param(
    [string]$Path,
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Assert-NodeRuntime {
  param([string]$Path)

  $versionOutput = & $Path "--version"
  if ($LASTEXITCODE -ne 0 -or -not $versionOutput) {
    Fail "无法执行 Node：$Path"
  }

  $versionText = [string]($versionOutput | Select-Object -First 1)
  if ($versionText -notmatch "^v(?<major>\d+)\.") {
    Fail "无法解析 Node 版本：$versionText"
  }

  $major = [int]$Matches["major"]
  if ($major -lt 20) {
    Fail "Node 版本过旧：$versionText。请使用 Node 20 或更新版本。"
  }

  Write-Detail "Node runtime: $versionText ($Path)"
}

function Get-GitHubHeaders {
  $headers = @{
    "Accept" = "application/vnd.github+json"
    "User-Agent" = "ldpass-deploy-script"
    "X-GitHub-Api-Version" = "2022-11-28"
  }

  if ($env:GITHUB_TOKEN) {
    $headers["Authorization"] = "Bearer $env:GITHUB_TOKEN"
  }

  return $headers
}

function Invoke-WithRetry {
  param(
    [scriptblock]$Script,
    [string]$Description,
    [int]$Attempts = 3
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      return & $Script
    }
    catch {
      if ($attempt -ge $Attempts) {
        throw
      }

      Write-Warning "$Description 第 $attempt/$Attempts 次失败：$($_.Exception.Message)"
      Start-Sleep -Seconds ([Math]::Min(10, $attempt * 3))
    }
  }
}

function Invoke-GitHubJson {
  param([string]$Uri)

  $headers = Get-GitHubHeaders
  $request = {
    Invoke-RestMethod -Uri $Uri -Headers $headers
  }.GetNewClosure()

  Invoke-WithRetry -Description "GitHub 请求 $Uri" -Script $request
}

function Get-ObjectValue {
  param(
    [object]$InputObject,
    [string]$Key
  )

  if ($null -eq $InputObject) {
    return $null
  }

  if ($InputObject -is [System.Collections.IDictionary]) {
    return $InputObject[$Key]
  }

  return $InputObject.$Key
}

function Import-DotEnvFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    Fail "找不到生产环境变量文件：$Path"
  }

  $lines = Get-Content -LiteralPath $Path -Encoding UTF8
  foreach ($line in $lines) {
    if ($line -notmatch "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$") {
      continue
    }

    $key = $Matches[1]
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2) {
      $first = $value.Substring(0, 1)
      $last = $value.Substring($value.Length - 1, 1)
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }

    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

function Get-Pm2Processes {
  $json = & $script:Pm2 jlist
  if ($LASTEXITCODE -ne 0 -or -not $json) {
    return @()
  }

  $jsonText = $json -join [Environment]::NewLine
  if (-not $jsonText.Trim()) {
    return @()
  }

  if ($PSVersionTable.PSVersion.Major -ge 6) {
    return @($jsonText | ConvertFrom-Json -AsHashtable)
  }

  return @($jsonText | ConvertFrom-Json)
}

function Get-CurrentPm2Cwd {
  param([string]$ProcessName)

  try {
    $processes = Get-Pm2Processes
    foreach ($process in $processes) {
      if ((Get-ObjectValue -InputObject $process -Key "name") -eq $ProcessName) {
        $pm2Env = Get-ObjectValue -InputObject $process -Key "pm2_env"
        return [string](Get-ObjectValue -InputObject $pm2Env -Key "pm_cwd")
      }
    }
  }
  catch {
    return ""
  }

  return ""
}

function Stop-Pm2IfExists {
  param([string]$ProcessName)

  $exists = $false
  try {
    $processes = Get-Pm2Processes
    foreach ($process in $processes) {
      if ((Get-ObjectValue -InputObject $process -Key "name") -eq $ProcessName) {
        $exists = $true
        break
      }
    }
  }
  catch {
    $exists = $true
  }

  if ($exists) {
    Invoke-Checked -FilePath $script:Pm2 -Arguments @("delete", $ProcessName) -WorkingDirectory $script:DeployRoot
  }
}

function Convert-ToReleaseRoot {
  param([string]$Path)

  if (-not $Path) {
    return ""
  }

  if ((Test-Path -LiteralPath (Join-Path $Path "package.json")) -and
      (Test-Path -LiteralPath (Join-Path $Path "apps\web"))) {
    return $Path
  }

  $leaf = Split-Path -Leaf $Path
  $parent = Split-Path -Parent $Path
  if ($leaf -eq "web" -and (Split-Path -Leaf $parent) -eq "apps") {
    $candidate = Split-Path -Parent $parent
    if ((Test-Path -LiteralPath (Join-Path $candidate "package.json")) -and
        (Test-Path -LiteralPath (Join-Path $candidate "apps\web"))) {
      return $candidate
    }
  }

  return ""
}

function Start-LdpassPm2 {
  param([string]$ReleaseDir)

  $webDir = Join-Path $ReleaseDir "apps\web"
  $nextCli = Join-Path $webDir "node_modules\next\dist\bin\next"
  if (-not (Test-Path -LiteralPath $nextCli)) {
    Fail "找不到 Next CLI：$nextCli。请确认依赖安装已完成。"
  }

  $env:NODE_ENV = "production"
  $env:PROJECT_ROOT_PATH = $ReleaseDir
  $env:PROJECT_DATA_PATH = Join-Path $ReleaseDir "data"
  Import-DotEnvFile -Path (Join-Path $ReleaseDir ".env")

  Invoke-Checked `
    -FilePath $script:Pm2 `
    -Arguments @(
      "start",
      $script:Node,
      "--name",
      $Pm2Name,
      "--cwd",
      $webDir,
      "--interpreter",
      "none",
      "--",
      $nextCli,
      "start",
      "-p",
      [string]$AppPort
    ) `
    -WorkingDirectory $webDir
}

function Assert-Pm2ProcessOnline {
  param([string]$ProcessName)

  $processes = Get-Pm2Processes
  foreach ($process in $processes) {
    if ((Get-ObjectValue -InputObject $process -Key "name") -eq $ProcessName) {
      $pm2Env = Get-ObjectValue -InputObject $process -Key "pm2_env"
      $status = [string](Get-ObjectValue -InputObject $pm2Env -Key "status")
      $processPid = Get-ObjectValue -InputObject $process -Key "pid"
      if ($status -eq "online" -and [int]$processPid -gt 0) {
        Write-Detail "PM2 进程在线：$ProcessName (pid $processPid)"
        return
      }

      Fail "PM2 进程未在线：$ProcessName，status=$status pid=$processPid"
    }
  }

  Fail "启动后没有找到 PM2 进程：$ProcessName"
}

function Wait-Health {
  param(
    [string]$Uri,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 5
      if ($response.ok -eq $true) {
        return
      }
      $lastError = "健康检查响应异常：$($response | ConvertTo-Json -Compress)"
    }
    catch {
      $lastError = $_.Exception.Message
    }

    Start-Sleep -Seconds 3
  }

  Fail "健康检查失败：$Uri。最后错误：$lastError"
}

function Assert-ReleaseBuildOutput {
  param([string]$ReleaseDir)

  $webNext = Join-Path $ReleaseDir "apps\web\.next"
  $buildIdPath = Join-Path $webNext "BUILD_ID"
  $staticPath = Join-Path $webNext "static"
  $serverManifestPath = Join-Path $webNext "server\app-paths-manifest.json"

  foreach ($path in @($buildIdPath, $staticPath, $serverManifestPath)) {
    if (-not (Test-Path -LiteralPath $path)) {
      Fail "构建产物缺失：$path"
    }
  }

  $assetCount = @(Get-ChildItem -LiteralPath $staticPath -Recurse -File).Count
  if ($assetCount -lt 10) {
    Fail "Next 静态资源数量异常：$assetCount。请检查构建是否完整。"
  }

  $buildId = (Get-Content -LiteralPath $buildIdPath -Raw -Encoding UTF8).Trim()
  if (-not $buildId) {
    Fail "BUILD_ID 为空：$buildIdPath"
  }

  Write-Detail "BUILD_ID: $buildId"
  Write-Detail "Next 静态资源数量：$assetCount"
}

function Get-SmokeRoutes {
  return @(
    "/",
    "/login",
    "/register",
    "/admin/login",
    "/provider/login"
  )
}

function Test-RoutesAndStaticAssets {
  param(
    [string]$BaseUrl,
    [string[]]$Routes,
    [switch]$AllowUnauthorized,
    [switch]$WarnOnly
  )

  $failures = New-Object System.Collections.Generic.List[string]
  $checkedAssets = New-Object "System.Collections.Generic.HashSet[string]"

  foreach ($route in $Routes) {
    $routeUri = "$BaseUrl$route"

    try {
      $response = Invoke-WebRequest `
        -Uri $routeUri `
        -UseBasicParsing `
        -TimeoutSec 15 `
        -Headers @{ "Cache-Control" = "no-cache"; "Pragma" = "no-cache" }
    }
    catch {
      $failures.Add("$route 请求失败：$($_.Exception.Message)")
      continue
    }

    $allowedStatusCodes = @(200)
    if ($AllowUnauthorized) {
      $allowedStatusCodes += 401
      $allowedStatusCodes += 403
      $allowedStatusCodes += 302
    }

    if ($allowedStatusCodes -notcontains [int]$response.StatusCode) {
      $failures.Add("$route 返回 HTTP $($response.StatusCode)")
      continue
    }

    $staticUrls = [regex]::Matches($response.Content, '/_next/static/[^"''<>\s\\]+') |
      ForEach-Object { $_.Value } |
      Sort-Object -Unique

    foreach ($staticUrl in $staticUrls) {
      if (-not $checkedAssets.Add($staticUrl)) {
        continue
      }

      try {
        $assetResponse = Invoke-WebRequest `
          -Uri "$BaseUrl$staticUrl" `
          -UseBasicParsing `
          -TimeoutSec 15
        if ($assetResponse.StatusCode -ne 200) {
          $failures.Add("$staticUrl 返回 HTTP $($assetResponse.StatusCode)")
        }
      }
      catch {
        $failures.Add("$staticUrl 请求失败：$($_.Exception.Message)")
      }
    }
  }

  if ($failures.Count -gt 0) {
    $message = $failures -join [Environment]::NewLine
    if ($WarnOnly) {
      Write-Warning "路由和静态资源检查失败，但部署已继续：`n$message"
      return
    }

    Fail "路由和静态资源检查失败：`n$message"
  }

  Write-Detail "路由和静态资源检查通过：$($Routes.Count) 个路由，$($checkedAssets.Count) 个静态资源。"
}

function Convert-ToNginxPath {
  param([string]$Path)
  return (($Path -replace "\\", "/").TrimEnd("/") + "/")
}

function Get-NginxNextStaticConfPath {
  param([string]$DomainName)

  $proxyRoot = Join-Path (Join-Path $script:NginxRoot "conf\proxy") $DomainName
  New-Item -ItemType Directory -Force -Path $proxyRoot | Out-Null
  return Join-Path $proxyRoot "000-next-static.conf"
}

function Publish-NextStaticAssets {
  param(
    [string]$ReleaseDir,
    [string]$StaticRoot
  )

  $source = Join-Path $ReleaseDir "apps\web\.next\static"
  if (-not (Test-Path -LiteralPath $source)) {
    Fail "找不到 Next 静态资源目录：$source"
  }

  New-Item -ItemType Directory -Force -Path $StaticRoot | Out-Null
  Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $StaticRoot -Recurse -Force
  }
}

function Publish-RetainedNextStaticAssets {
  param(
    [string]$Root,
    [string]$StaticRoot,
    [int]$Keep
  )

  if (-not (Test-Path -LiteralPath $Root)) {
    return
  }

  $releases = Get-ChildItem -LiteralPath $Root -Directory |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First $Keep

  foreach ($release in $releases) {
    Publish-NextStaticAssets -ReleaseDir $release.FullName -StaticRoot $StaticRoot
  }
}

function Ensure-NginxNextStaticLocation {
  param(
    [string]$DomainName,
    [string]$StaticRoot
  )

  $confPath = Get-NginxNextStaticConfPath -DomainName $DomainName
  $aliasPath = Convert-ToNginxPath -Path $StaticRoot
  $content = @"
location ^~ /_next/static/ {
    alias $aliasPath;
    access_log off;
    expires 30d;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}
"@

  Set-TextFileNoBom -Path $confPath -Content $content
  Write-Detail "已启用 Nginx 共享静态资源配置：$confPath"
}

function Disable-NginxNextStaticLocation {
  param([string]$DomainName)

  $confPath = Get-NginxNextStaticConfPath -DomainName $DomainName
  if (-not (Test-Path -LiteralPath $confPath)) {
    return
  }

  $disabledPath = "$confPath.disabled"
  Move-Item -LiteralPath $confPath -Destination $disabledPath -Force
  Write-Detail "已停用旧的 Nginx 共享静态资源配置：$disabledPath"
}

function Invoke-NginxReload {
  Invoke-Checked -FilePath $script:Nginx -Arguments @("-p", "$script:NginxRoot\", "-t") -WorkingDirectory $script:NginxRoot

  Write-Host "+ $script:Nginx -p $script:NginxRoot\ -s reload"
  & $script:Nginx @("-p", "$script:NginxRoot\", "-s", "reload")
  if ($LASTEXITCODE -eq 0) {
    return
  }

  $reloadExitCode = $LASTEXITCODE
  Write-Warning "nginx reload 失败，退出码 $reloadExitCode。尝试重启 Windows 服务。"
  try {
    Restart-Service -Name "nginx" -ErrorAction Stop
    Start-Sleep -Seconds 3
    $service = Get-Service -Name "nginx" -ErrorAction Stop
    if ($service.Status -eq "Running") {
      Write-Detail "nginx 服务已重启。"
      return
    }

    Fail "nginx 重启后状态异常：$($service.Status)"
  }
  catch {
    Fail "nginx 服务重启失败：$($_.Exception.Message)"
  }
}

function Backup-SharedState {
  param(
    [string]$BackupRoot,
    [string]$EnvPath,
    [string]$DataPath
  )

  New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
  Copy-Item -LiteralPath $EnvPath -Destination (Join-Path $BackupRoot ".env") -Force

  if (Test-Path -LiteralPath $DataPath) {
    $backupData = Join-Path $BackupRoot "data"
    New-Item -ItemType Directory -Force -Path $backupData | Out-Null
    Get-ChildItem -LiteralPath $DataPath -Force | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $backupData -Recurse -Force
    }
  }
}

function Remove-OldReleases {
  param(
    [string]$Root,
    [int]$Keep
  )

  if ($Keep -lt 1 -or -not (Test-Path -LiteralPath $Root)) {
    return
  }

  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path.TrimEnd("\")
  $oldReleases = Get-ChildItem -LiteralPath $Root -Directory |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep

  foreach ($release in $oldReleases) {
    $resolvedRelease = (Resolve-Path -LiteralPath $release.FullName).Path
    if (-not $resolvedRelease.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
      Fail "拒绝删除 releases 目录外的路径：$resolvedRelease"
    }

    try {
      Remove-Item -LiteralPath $resolvedRelease -Recurse -Force -ErrorAction Stop
    }
    catch {
      Write-Warning "无法删除旧 release：$resolvedRelease。$($_.Exception.Message)"
    }
  }
}

function Copy-ExtractedSource {
  param(
    [string]$Source,
    [string]$Destination
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

function New-DataJunction {
  param(
    [string]$ReleaseDir,
    [string]$SharedData
  )

  $releaseData = Join-Path $ReleaseDir "data"
  if (Test-Path -LiteralPath $releaseData) {
    Remove-Item -LiteralPath $releaseData -Recurse -Force
  }

  New-Item -ItemType Junction -Path $releaseData -Target $SharedData | Out-Null
}

$mutex = New-Object System.Threading.Mutex($false, "Local\ldpass-deploy")
$hasDeployLock = $false
$tempRoot = $null
$releaseDir = $null
$deploySucceeded = $false
$releaseMayBeRunning = $false

try {
  $hasDeployLock = $mutex.WaitOne(0)
  if (-not $hasDeployLock) {
    Fail "已有部署任务正在运行，请等待它完成后再试。"
  }

  $script:DeployRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $script:Node = Resolve-Tool -Path $NodePath -Name "node.exe"
  $script:Npx = Resolve-Tool -Path $NpxPath -Name "npx.cmd"
  $script:Pm2 = Resolve-Tool -Path $Pm2Path -Name "pm2.cmd"
  $script:Nginx = Resolve-Tool -Path $NginxPath -Name "nginx.exe"
  $script:NginxRoot = Split-Path -Parent $script:Nginx

  Write-Step "检查运行环境"
  Assert-NodeRuntime -Path $script:Node
  $script:NodeDir = Split-Path -Parent $script:Node
  $env:PATH = "${script:NodeDir};$env:PATH"

  $sharedEnv = Join-Path $script:DeployRoot ".env"
  $sharedData = Join-Path $script:DeployRoot "data"
  $sharedNextStatic = Join-Path $script:DeployRoot "shared-next-static"
  $releasesRoot = Join-Path $script:DeployRoot "releases"
  $backupsRoot = Join-Path $script:DeployRoot "backups"

  if (-not (Test-Path -LiteralPath $sharedEnv)) {
    Fail "缺少生产 .env：$sharedEnv"
  }

  New-Item -ItemType Directory -Force -Path $sharedData | Out-Null
  New-Item -ItemType Directory -Force -Path $releasesRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $backupsRoot | Out-Null

  Write-Step "解析 GitHub 源码版本"
  $repoInfo = Invoke-GitHubJson -Uri "https://api.github.com/repos/$Repo"
  $sourceLabel = ""

  if ($UseLatestRelease) {
    try {
      $release = Invoke-GitHubJson -Uri "https://api.github.com/repos/$Repo/releases/latest"
      $Ref = [string]$release.tag_name
      $sourceLabel = "latest release $Ref"
    }
    catch {
      if (-not $Ref) {
        $Ref = [string]$repoInfo.default_branch
        $sourceLabel = "default branch $Ref，latest release 不可用"
      }
    }
  }

  if (-not $Ref) {
    $Ref = [string]$repoInfo.default_branch
    $sourceLabel = "default branch $Ref"
  }
  elseif (-not $sourceLabel) {
    $sourceLabel = "ref $Ref"
  }

  $encodedRef = [System.Uri]::EscapeDataString($Ref)
  $commitInfo = Invoke-GitHubJson -Uri "https://api.github.com/repos/$Repo/commits/$encodedRef"
  $resolvedCommit = [string]$commitInfo.sha
  if (-not $resolvedCommit) {
    Fail "GitHub 没有返回 $Repo@$Ref 的 commit SHA。"
  }

  $shortCommit = $resolvedCommit.Substring(0, 12)
  Write-Detail "Repository: $Repo"
  Write-Detail "Source: $sourceLabel"
  Write-Detail "Commit: $resolvedCommit"

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $safeRef = ($Ref -replace "[^A-Za-z0-9_.-]", "-")
  $releaseDir = Join-Path $releasesRoot "$timestamp-$safeRef-$shortCommit"
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "ldpass-deploy-$timestamp"
  $zipPath = Join-Path $tempRoot "source.zip"
  $extractRoot = Join-Path $tempRoot "extract"

  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null

  Write-Step "下载源码压缩包"
  $archiveUrl = "https://api.github.com/repos/$Repo/zipball/$resolvedCommit"
  $archiveHeaders = Get-GitHubHeaders
  $downloadSource = {
    Invoke-WebRequest -Uri $archiveUrl -Headers $archiveHeaders -OutFile $zipPath
  }.GetNewClosure()
  Invoke-WithRetry -Description "源码下载" -Script $downloadSource

  Write-Step "展开 release 目录"
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
  $sourceDir = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
  if ($null -eq $sourceDir) {
    Fail "源码压缩包中没有目录。"
  }

  Copy-ExtractedSource -Source $sourceDir.FullName -Destination $releaseDir
  if (-not (Test-Path -LiteralPath (Join-Path $releaseDir "package.json"))) {
    Fail "release 目录不像 ldpass 仓库：$releaseDir"
  }

  Copy-Item -LiteralPath $sharedEnv -Destination (Join-Path $releaseDir ".env") -Force
  New-DataJunction -ReleaseDir $releaseDir -SharedData $sharedData

  $deployInfo = [ordered]@{
    repo = $Repo
    requestedRef = $Ref
    commit = $resolvedCommit
    source = $sourceLabel
    deployedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json
  Set-TextFileNoBom -Path (Join-Path $releaseDir ".deploy-info.json") -Content $deployInfo

  Write-Step "安装依赖"
  Invoke-Pnpm -Arguments @("install", "--frozen-lockfile") -WorkingDirectory $releaseDir

  Write-Step "构建 release"
  Invoke-Pnpm -Arguments @("build") -WorkingDirectory $releaseDir
  Assert-ReleaseBuildOutput -ReleaseDir $releaseDir

  if ($EnableSharedNextStatic) {
    Write-Step "发布共享 Next 静态资源"
    New-Item -ItemType Directory -Force -Path $sharedNextStatic | Out-Null
    Publish-RetainedNextStaticAssets -Root $releasesRoot -StaticRoot $sharedNextStatic -Keep $KeepReleases
    Ensure-NginxNextStaticLocation -DomainName $Domain -StaticRoot $sharedNextStatic
  }
  else {
    Write-Step "确认 Nginx 不接管 Next 静态资源"
    Disable-NginxNextStaticLocation -DomainName $Domain
    Write-Detail "默认让 Next.js 自己处理 /_next/static/*，避免 HTML 与静态目录版本错位。"
  }

  Write-Step "备份共享状态"
  $backupDir = Join-Path $backupsRoot $timestamp
  Backup-SharedState -BackupRoot $backupDir -EnvPath $sharedEnv -DataPath $sharedData
  Write-Detail "Backup: $backupDir"

  if (-not $SkipDbPush) {
    Write-Step "同步数据库结构"
    Invoke-Pnpm -Arguments @("db:push") -WorkingDirectory $releaseDir
  }

  Write-Step "切换 PM2 到新 release"
  $oldCwd = Convert-ToReleaseRoot -Path (Get-CurrentPm2Cwd -ProcessName $Pm2Name)
  try {
    Stop-Pm2IfExists -ProcessName $Pm2Name
    Start-LdpassPm2 -ReleaseDir $releaseDir
    Wait-Health -Uri "http://127.0.0.1:$AppPort/api/health" -TimeoutSeconds $HealthTimeoutSeconds
    Assert-Pm2ProcessOnline -ProcessName $Pm2Name
    Test-RoutesAndStaticAssets `
      -BaseUrl "http://127.0.0.1:$AppPort" `
      -Routes (Get-SmokeRoutes) `
      -AllowUnauthorized
    $releaseMayBeRunning = $true
  }
  catch {
    $switchError = $_
    Write-Warning "PM2 切换失败，准备回滚旧 release：$oldCwd"
    try {
      Stop-Pm2IfExists -ProcessName $Pm2Name
      if ($oldCwd -and (Test-Path -LiteralPath $oldCwd)) {
        Start-LdpassPm2 -ReleaseDir $oldCwd
      }
    }
    catch {
      Write-Warning "回滚旧 PM2 进程失败：$($_.Exception.Message)"
    }
    throw $switchError
  }

  Invoke-Checked -FilePath $script:Pm2 -Arguments @("save") -WorkingDirectory $releaseDir

  if (-not $SkipNginxReload) {
    Write-Step "测试并重载 nginx"
    Invoke-NginxReload
  }

  if (-not $SkipPublicCheck) {
    Write-Step "公网烟雾检查"
    $publicBaseUrl = "https://$Domain"
    $publicCheckSucceeded = $false
    try {
      Invoke-RestMethod -Uri "$publicBaseUrl/api/health" -TimeoutSec 10 | Out-Null
      Test-RoutesAndStaticAssets `
        -BaseUrl $publicBaseUrl `
        -Routes @("/", "/admin/login") `
        -AllowUnauthorized `
        -WarnOnly:($AllowPublicCheckFailure)
      $publicCheckSucceeded = $true
      Write-Detail "公网检查通过：$publicBaseUrl"
    }
    catch {
      $message = "本机发布已成功，但公网检查失败：$($_.Exception.Message)"
      if ($AllowPublicCheckFailure) {
        Write-Warning $message
      }
      else {
        Fail $message
      }
    }

    if (-not $publicCheckSucceeded -and -not $AllowPublicCheckFailure) {
      Fail "公网检查失败。新 release 仍可能已经在本机运行：$releaseDir"
    }
  }

  Write-Step "清理旧 release"
  Remove-OldReleases -Root $releasesRoot -Keep $KeepReleases

  $deploySucceeded = $true
  Write-Host ""
  Write-Host "部署完成：$Repo@$resolvedCommit"
  Write-Host "Release: $releaseDir"
}
finally {
  if ($tempRoot -and (Test-Path -LiteralPath $tempRoot)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }

  if (-not $deploySucceeded -and -not $releaseMayBeRunning -and $releaseDir -and (Test-Path -LiteralPath $releaseDir)) {
    Remove-Item -LiteralPath $releaseDir -Recurse -Force
  }
  elseif (-not $deploySucceeded -and $releaseMayBeRunning) {
    Write-Warning "部署脚本未完全通过，但 PM2 可能正在运行此 release：$releaseDir"
  }

  if ($hasDeployLock) {
    [void]$mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}
