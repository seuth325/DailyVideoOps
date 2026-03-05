param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$TestDate = '2026-03-08'
)

$ErrorActionPreference = 'Stop'

function Assert-True {
  param(
    [Parameter(Mandatory=$true)][bool]$Condition,
    [Parameter(Mandatory=$true)][string]$Message
  )
  if (-not $Condition) {
    throw "ASSERT FAILED: $Message"
  }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory=$true)][string]$ScriptPath,
    [Parameter(Mandatory=$true)][string[]]$Arguments
  )

  & powershell -ExecutionPolicy Bypass -File $ScriptPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw ("Command failed with exit code {0}: {1} {2}" -f $LASTEXITCODE, $ScriptPath, ($Arguments -join ' '))
  }
}

function Invoke-ExpectFailure {
  param(
    [Parameter(Mandatory=$true)][string]$ScriptPath,
    [Parameter(Mandatory=$true)][string[]]$Arguments
  )

  $argString = @('-ExecutionPolicy','Bypass','-File',('"{0}"' -f $ScriptPath)) + $Arguments
  $proc = Start-Process -FilePath powershell -ArgumentList $argString -Wait -PassThru -WindowStyle Hidden
  return ($proc.ExitCode -ne 0)
}

Write-Output "[1/6] Verifying required files..."
$required = @(
  'scripts/new-daily-package.ps1',
  'scripts/log-analytics.ps1',
  'data/topic-bank.csv',
  'data/analytics-log.csv',
  'templates/content-brief-template.md',
  'templates/caption-templates.md',
  'templates/daily-publish-checklist.md',
  'config/schedule.json'
)
foreach ($rel in $required) {
  $path = Join-Path $Root $rel
  Assert-True (Test-Path $path) "Missing required file: $rel"
}

Write-Output "[2/6] Generating daily package with -SkipMarkUsed..."
$newDaily = Join-Path $Root 'scripts/new-daily-package.ps1'
Invoke-Checked -ScriptPath $newDaily -Arguments @('-Date', $TestDate, '-SkipMarkUsed', '-Root', $Root)

$outDir = Join-Path $Root "output/$TestDate"
Assert-True (Test-Path (Join-Path $outDir 'content-brief.md')) 'content-brief.md not generated'
Assert-True (Test-Path (Join-Path $outDir 'captions-draft.md')) 'captions-draft.md not generated'
Assert-True (Test-Path (Join-Path $outDir 'publish-checklist.md')) 'publish-checklist.md not generated'
Assert-True (Test-Path (Join-Path $outDir 'manifest.json')) 'manifest.json not generated'

Write-Output "[3/6] Validating manifest fields..."
$manifest = Get-Content (Join-Path $outDir 'manifest.json') -Raw | ConvertFrom-Json
Assert-True ($manifest.date -eq $TestDate) 'Manifest date mismatch'
Assert-True ($manifest.timezone -eq 'America/New_York') 'Manifest timezone mismatch'
Assert-True ($manifest.post_windows_et.tiktok -eq '12:30') 'TikTok schedule mismatch'
Assert-True ($manifest.post_windows_et.instagram -eq '13:00') 'Instagram schedule mismatch'
Assert-True ($manifest.post_windows_et.facebook -eq '13:30') 'Facebook schedule mismatch'
Assert-True ($manifest.post_windows_et.youtube_shorts -eq '14:00') 'YouTube schedule mismatch'
Assert-True ($manifest.post_windows_et.whatsapp_status_broadcast -eq '18:00') 'WhatsApp schedule mismatch'

Write-Output "[4/6] Appending analytics row and verifying persistence..."
$logScript = Join-Path $Root 'scripts/log-analytics.ps1'
Invoke-Checked -ScriptPath $logScript -Arguments @(
  '-Date', $TestDate,
  '-Platform', 'tiktok',
  '-Views', '999',
  '-RetentionProxy', '40.5',
  '-Likes', '50',
  '-Comments', '7',
  '-Shares', '9',
  '-Follows', '11',
  '-Root', $Root
)

$rows = Import-Csv (Join-Path $Root 'data/analytics-log.csv')
$match = $rows | Where-Object {
  $_.date -eq $TestDate -and $_.platform -eq 'tiktok' -and $_.views -eq '999' -and $_.retention_proxy -eq '40.5'
} | Select-Object -First 1
Assert-True ($null -ne $match) 'Analytics row not found after append'

Write-Output "[5/6] Running negative test (invalid date should fail)..."
$failedAsExpected = Invoke-ExpectFailure -ScriptPath $logScript -Arguments @(
  '-Date', '03-08-2026',
  '-Platform', 'tiktok',
  '-Views', '1',
  '-RetentionProxy', '1',
  '-Likes', '1',
  '-Comments', '1',
  '-Shares', '1',
  '-Follows', '1',
  '-Root', $Root
)
Assert-True $failedAsExpected 'Invalid date did not fail as expected'

Write-Output "[6/6] Running negative test (negative metrics should fail)..."
$failedAsExpected = Invoke-ExpectFailure -ScriptPath $logScript -Arguments @(
  '-Date', $TestDate,
  '-Platform', 'tiktok',
  '-Views', '-1',
  '-RetentionProxy', '1',
  '-Likes', '1',
  '-Comments', '1',
  '-Shares', '1',
  '-Follows', '1',
  '-Root', $Root
)
Assert-True $failedAsExpected 'Negative metrics did not fail as expected'

Write-Output 'PASS: All smoke tests passed.'
