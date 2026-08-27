[CmdletBinding()]
param(
  [string]$ZoneName = 'turquazsf.com',
  [string]$DatabaseName = 'turquaz-content',
  [ValidateSet('wnam', 'enam', 'weur', 'eeur', 'apac', 'oc')]
  [string]$DatabaseLocation = 'wnam',
  [switch]$ActivateProductionRoutes,
  [switch]$SkipSecretPrompt
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$workerRoot = Join-Path $repoRoot 'worker'
$configPath = Join-Path $workerRoot 'wrangler.toml'

& (Join-Path $PSScriptRoot 'predeploy-check.ps1')
Push-Location $workerRoot
try {
  if (-not (Test-Path 'node_modules')) {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
  }

  Write-Host 'Checking Cloudflare authentication...'
  & npx wrangler whoami
  if ($LASTEXITCODE -ne 0) {
    throw 'Cloudflare authentication is required. Run npx wrangler login, approve the browser request, then rerun this script.'
  }

  $databaseId = ''
  $databaseListJson = & npx wrangler d1 list --json 2>$null | Out-String
  if ($LASTEXITCODE -eq 0 -and $databaseListJson.Trim()) {
    $database = ($databaseListJson | ConvertFrom-Json) | Where-Object { $_.name -eq $DatabaseName } | Select-Object -First 1
    if ($database) { $databaseId = [string]$database.uuid }
  }

  if (-not $databaseId) {
    Write-Host "Creating D1 database $DatabaseName..."
    $createOutput = & npx wrangler d1 create $DatabaseName --location $DatabaseLocation 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "D1 creation failed:`n$createOutput" }
    $uuidMatch = [regex]::Match($createOutput, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
    if (-not $uuidMatch.Success) { throw 'D1 was created but its database ID could not be parsed.' }
    $databaseId = $uuidMatch.Value
  }

  $config = Get-Content -Raw $configPath
  if ($config -match 'database_id\s*=\s*"[^"]+"') {
    $config = [regex]::Replace($config, 'database_id\s*=\s*"[^"]+"', "database_id = `"$databaseId`"", 1)
  } else {
    throw 'wrangler.toml does not contain a database_id setting.'
  }
  [System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))

  Write-Host 'Applying remote D1 migrations and starter content...'
  $previousCi = $env:CI
  $env:CI = 'true'
  try {
    & npx wrangler d1 migrations apply $DatabaseName --remote
    if ($LASTEXITCODE -ne 0) { throw 'Remote D1 migration failed.' }
  } finally {
    $env:CI = $previousCi
  }

  Write-Host 'Deploying Worker to its workers.dev staging URL...'
  & npx wrangler deploy
  if ($LASTEXITCODE -ne 0) { throw 'Worker staging deployment failed.' }

  if (-not $SkipSecretPrompt) {
    Write-Host 'Enter the CONTENT_API_TOKEN stored in your password manager. Input is hidden.'
    $secureToken = Read-Host 'CONTENT_API_TOKEN' -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try {
      $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
      if ($plainToken.Length -lt 32) { throw 'CONTENT_API_TOKEN must be at least 32 characters.' }
      $plainToken | & npx wrangler secret put CONTENT_API_TOKEN
      if ($LASTEXITCODE -ne 0) { throw 'Worker secret upload failed.' }
    } finally {
      if ($tokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
      $plainToken = $null
      $secureToken = $null
    }

    Write-Host 'Choose a new admin password. Input is hidden.'
    $secureAdminPassword = Read-Host 'ADMIN_PASSWORD' -AsSecureString
    $adminPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAdminPassword)
    try {
      $plainAdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPasswordPointer)
      if ($plainAdminPassword.Length -lt 12) { throw 'ADMIN_PASSWORD must be at least 12 characters.' }
      $plainAdminPassword | & npx wrangler secret put ADMIN_PASSWORD
      if ($LASTEXITCODE -ne 0) { throw 'Admin password secret upload failed.' }
    } finally {
      if ($adminPasswordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPasswordPointer) }
      $plainAdminPassword = $null
      $secureAdminPassword = $null
    }
  }

  if ($ActivateProductionRoutes) {
    Write-Host "Deploying production routes for www.$ZoneName..."
    $routeArguments = @(
      'wrangler', 'deploy',
      '--route', "$ZoneName/*",
      '--route', "www.$ZoneName/blog*",
      '--route', "www.$ZoneName/san-francisco/*",
      '--route', "www.$ZoneName/sitemap.xml",
      '--route', "www.$ZoneName/robots.txt",
      '--route', "www.$ZoneName/api/*"
    )
    & npx @routeArguments
    if ($LASTEXITCODE -ne 0) { throw 'Production route deployment failed.' }
  } else {
    Write-Host 'Production routes were not activated. Validate workers.dev, then rerun with -ActivateProductionRoutes.' -ForegroundColor Yellow
  }

  Write-Host "Cloudflare Worker deployment completed. D1 database ID: $databaseId" -ForegroundColor Green
} finally {
  Pop-Location
}
