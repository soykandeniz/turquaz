[CmdletBinding()]
param(
  [string]$ScriptId = '1ghz-96qRjsHK7YYNkeU_KTI_Ut0UOZLAcVqkDes_gpAjjyHyZxMKCWON',
  [string]$DeploymentId = 'AKfycbwBKduBq_BzpHv4t0yZ3fRWholk1EIRx2GWUyiVQCV9SHESyBHLAXvZsHd2556HjLp0lw',
  [string]$Description = 'Email-only Gmail relay for Cloudflare Worker',
  [switch]$CreateNewDeployment
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('turquaz-apps-script-' + [guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory -Path $stageRoot | Out-Null
try {
  Copy-Item (Join-Path $repoRoot 'backend/google-apps-script.gs') (Join-Path $stageRoot 'Code.gs')
  $claspConfig = @{
    scriptId = $ScriptId
    rootDir = '.'
  } | ConvertTo-Json
  $manifest = @{
    timeZone = 'America/Los_Angeles'
    dependencies = @{}
    exceptionLogging = 'STACKDRIVER'
    runtimeVersion = 'V8'
    webapp = @{
      access = 'ANYONE_ANONYMOUS'
      executeAs = 'USER_DEPLOYING'
    }
  } | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText((Join-Path $stageRoot '.clasp.json'), $claspConfig, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $stageRoot 'appsscript.json'), $manifest, [System.Text.UTF8Encoding]::new($false))

  Push-Location $stageRoot
  try {
    Write-Host 'Pushing email-only Apps Script source...'
    & npx --yes '@google/clasp' push --force
    if ($LASTEXITCODE -ne 0) { throw 'Apps Script push failed.' }

    $versionOutput = & npx --yes '@google/clasp' version $Description 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Apps Script version creation failed:`n$versionOutput" }
    $versionMatch = [regex]::Match($versionOutput, '(?i)version\s+(\d+)')
    if (-not $versionMatch.Success) { throw "Could not determine the new Apps Script version:`n$versionOutput" }
    $versionNumber = $versionMatch.Groups[1].Value

    if ($CreateNewDeployment) {
      $deployOutput = & npx --yes '@google/clasp' deploy --versionNumber $versionNumber --description $Description 2>&1 | Out-String
    } else {
      $deployOutput = & npx --yes '@google/clasp' deploy --deploymentId $DeploymentId --versionNumber $versionNumber --description $Description 2>&1 | Out-String
    }
    if ($LASTEXITCODE -ne 0) { throw 'Apps Script deployment update failed.' }
    Write-Host $deployOutput.Trim()
    Write-Host "Apps Script deployment completed at version $versionNumber." -ForegroundColor Green
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
}