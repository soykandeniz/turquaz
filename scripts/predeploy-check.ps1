[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$workerRoot = Join-Path $repoRoot 'worker'

Write-Host 'Checking JavaScript syntax...'
& node --check (Join-Path $repoRoot 'scripts/admin.js')
& node --check (Join-Path $repoRoot 'scripts/main.js')
Get-Content -Raw (Join-Path $repoRoot 'backend/google-apps-script.gs') | & node --check
& node --check (Join-Path $workerRoot 'src/index.js')

Write-Host 'Checking required public files...'
$requiredFiles = @(
  'index.html',
  'menu.html',
  'check-res.html',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'styles/main.css',
  'styles/admin.css',
  'scripts/main.js',
  'scripts/admin.js',
  'backend/google-apps-script.gs',
  'worker/wrangler.toml',
  'worker/migrations/0001_content.sql',
  'worker/migrations/0002_starter_content.sql',
  'worker/migrations/0003_reservations.sql',
  'worker/migrations/0004_admin_sessions.sql',
  'worker/migrations/0005_public_rate_limits.sql',
  'worker/migrations/0006_editorial_expansion.sql',
  'worker/migrations/0007_content_quality_improvements.sql'
)
foreach ($relativePath in $requiredFiles) {
  if (-not (Test-Path (Join-Path $repoRoot $relativePath))) {
    throw "Required file is missing: $relativePath"
  }
}

Write-Host 'Checking SEO metadata...'
$homeHtml = Get-Content -Raw (Join-Path $repoRoot 'index.html')
$menuHtml = Get-Content -Raw (Join-Path $repoRoot 'menu.html')
$adminHtml = Get-Content -Raw (Join-Path $repoRoot 'check-res.html')
if ($homeHtml -notmatch 'rel="canonical" href="https://www.turquazsf.com/"') { throw 'Homepage canonical is missing.' }
if ($homeHtml -notmatch 'type="application/ld\+json"') { throw 'Homepage Restaurant JSON-LD is missing.' }
if ($menuHtml -notmatch 'rel="canonical" href="https://www.turquazsf.com/menu"') { throw 'Menu canonical is missing.' }
if ($adminHtml -notmatch 'content="noindex, nofollow, noarchive"') { throw 'Admin noindex directive is missing.' }
if ($adminHtml -notmatch 'id="runSeoAuditBtn"' -or $adminHtml -notmatch 'id="mediaUpload"' -or $adminHtml -notmatch 'id="htmlSource"') { throw 'Admin SEO and rich media controls are missing.' }
if ($homeHtml -notmatch 'href="blog/"' -or $menuHtml -notmatch 'href="blog/"') { throw 'Public Blog navigation is missing.' }

$workerConfig = Get-Content -Raw (Join-Path $workerRoot 'wrangler.toml')
$workerPackage = Get-Content -Raw (Join-Path $workerRoot 'package.json')
if ($workerConfig -notmatch 'binding = "MEDIA"' -or $workerConfig -notmatch 'bucket_name = "turquaz-media"') { throw 'Worker media storage binding is missing.' }
if ($workerPackage -notmatch '"sanitize-html"') { throw 'Worker rich HTML sanitizer dependency is missing.' }

Write-Host 'Checking crawl files...'
$sitemap = [xml](Get-Content -Raw (Join-Path $repoRoot 'sitemap.xml'))
if ($sitemap.urlset.url.Count -lt 2) { throw 'Static sitemap must contain the home and menu pages.' }
$robots = Get-Content -Raw (Join-Path $repoRoot 'robots.txt')
if ($robots -notmatch 'Sitemap: https://www.turquazsf.com/sitemap.xml') { throw 'robots.txt does not declare the sitemap.' }

Write-Host 'Checking secrets and placeholders...'
$trackedText = Get-ChildItem $repoRoot -Recurse -File | Where-Object {
  $_.FullName -notmatch '[\\/]node_modules[\\/]' -and
  $_.FullName -notmatch '[\\/]\.wrangler[\\/]' -and
  $_.Extension -in @('.js', '.gs', '.html', '.toml', '.md', '.xml', '.txt', '.ps1')
}
$retiredPassword = 'turquaz' + '2026'
foreach ($file in $trackedText) {
  $contents = Get-Content -Raw $file.FullName
  if ($contents.Contains($retiredPassword)) { throw "Retired default password found in $($file.FullName)" }
}

& git -C $repoRoot diff --check
Write-Host 'Predeploy checks passed.' -ForegroundColor Green
