[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectName,
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("turquaz-site-" + [guid]::NewGuid().ToString('N'))

& (Join-Path $PSScriptRoot 'predeploy-check.ps1')
New-Item -ItemType Directory -Path $stageRoot | Out-Null
try {
  $files = @('index.html', 'menu.html', 'check-res.html', 'robots.txt', 'sitemap.xml', 'llms.txt')
  foreach ($file in $files) {
    Copy-Item (Join-Path $repoRoot $file) (Join-Path $stageRoot $file)
  }
  foreach ($directory in @('assets', 'scripts', 'styles')) {
    Copy-Item (Join-Path $repoRoot $directory) (Join-Path $stageRoot $directory) -Recurse
  }

  Write-Host "Deploying public static package to Cloudflare Pages project $ProjectName..."
  & npx wrangler pages deploy $stageRoot --project-name $ProjectName --branch $Branch
  if ($LASTEXITCODE -ne 0) { throw 'Cloudflare Pages deployment failed.' }
  Write-Host 'Static Cloudflare Pages deployment completed.' -ForegroundColor Green
} finally {
  if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force }
}
