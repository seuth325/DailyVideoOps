param(
  [string]$Root,
  [string]$WeekStartDate,
  [switch]$Deduplicate = $true,
  [switch]$WriteReport = $true,
  [string]$ReportDir = 'output/reports',
  [switch]$AllowEmptyAnalytics,
  [switch]$AllowNoCurrentWeek
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Root)) {
  if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  } elseif ($MyInvocation.MyCommand.Path) {
    $Root = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..')).Path
  } else {
    $Root = (Get-Location).Path
  }
}

if ([IO.Path]::IsPathRooted($ReportDir)) {
  $ResolvedReportDir = $ReportDir
} else {
  $ResolvedReportDir = Join-Path $Root $ReportDir
}

function Get-Monday {
  param([datetime]$Date)
  $offset = (([int]$Date.DayOfWeek + 6) % 7)
  return $Date.Date.AddDays(-$offset)
}

function To-Number {
  param($Value, [double]$Default = 0)
  try { return [double]$Value } catch { return $Default }
}

function Write-NoDataReport {
  param(
    [datetime]$WeekStart,
    [string]$Reason
  )

  $weekEnd = $WeekStart.AddDays(6)
  $lines = @(
    "# Weekly Summary ($($WeekStart.ToString('yyyy-MM-dd')) to $($weekEnd.ToString('yyyy-MM-dd')))"
    ''
    '## KPI Snapshot'
    '- Posts: 0'
    '- Views: 0 (WoW: n/a)'
    '- Avg retention proxy: n/a (WoW: n/a)'
    '- Follows: 0 (WoW: n/a)'
    ''
    '## Recommendation (Keep 2 / Replace 1)'
    '- Keep: n/a'
    '- Replace/Improve first: n/a'
    '- Action: log daily metrics this week, then rerun weekly summary.'
    ''
    '## Notes'
    "- Reason: $Reason"
  )

  if ($WriteReport) {
    New-Item -ItemType Directory -Path $ResolvedReportDir -Force | Out-Null
    $path = Join-Path $ResolvedReportDir ("weekly-summary-{0}.md" -f $WeekStart.ToString('yyyy-MM-dd'))
    $lines -join "`r`n" | Set-Content -Path $path -Encoding UTF8
    Write-Output "Report written: $path"
  }

  Write-Output ("Week: {0} to {1}" -f $WeekStart.ToString('yyyy-MM-dd'), $weekEnd.ToString('yyyy-MM-dd'))
  Write-Output 'No analytics data available for this report window.'
}

if ([string]::IsNullOrWhiteSpace($WeekStartDate)) {
  $requestedWeekStart = Get-Monday -Date (Get-Date)
} else {
  try {
    $requestedWeekStart = Get-Monday -Date ([datetime]::ParseExact($WeekStartDate, 'yyyy-MM-dd', $null))
  } catch {
    throw 'WeekStartDate must be in yyyy-MM-dd format.'
  }
}

$csvPath = Join-Path $Root 'data/analytics-log.csv'
if (-not (Test-Path $csvPath)) {
  if ($AllowEmptyAnalytics) {
    Write-NoDataReport -WeekStart $requestedWeekStart -Reason "Missing analytics log at $csvPath"
    return
  }
  throw "Missing analytics log: $csvPath"
}

$raw = Import-Csv $csvPath
if (-not $raw -or $raw.Count -eq 0) {
  if ($AllowEmptyAnalytics) {
    Write-NoDataReport -WeekStart $requestedWeekStart -Reason 'Analytics log is empty.'
    return
  }
  throw 'Analytics log is empty. Add daily metrics first.'
}

$parsed = foreach ($r in $raw) {
  if (-not $r.date -or -not $r.platform) { continue }
  try { $d = [datetime]::ParseExact($r.date, 'yyyy-MM-dd', $null) } catch { continue }
  [pscustomobject]@{
    date = $d.Date
    platform = $r.platform
    views = [int](To-Number $r.views)
    retention_proxy = [double](To-Number $r.retention_proxy)
    likes = [int](To-Number $r.likes)
    comments = [int](To-Number $r.comments)
    shares = [int](To-Number $r.shares)
    follows = [int](To-Number $r.follows)
  }
}

if (-not $parsed -or $parsed.Count -eq 0) {
  if ($AllowEmptyAnalytics) {
    Write-NoDataReport -WeekStart $requestedWeekStart -Reason 'No valid analytics rows after parsing.'
    return
  }
  throw 'No valid analytics rows found after parsing.'
}

if ($Deduplicate) {
  $parsed = $parsed |
    Sort-Object date |
    Group-Object { "{0}|{1}" -f $_.date.ToString('yyyy-MM-dd'), $_.platform } |
    ForEach-Object { $_.Group | Select-Object -Last 1 }
}

if ([string]::IsNullOrWhiteSpace($WeekStartDate)) {
  $latestDate = ($parsed | Sort-Object date | Select-Object -Last 1).date
  $weekStart = Get-Monday -Date $latestDate
} else {
  $weekStart = $requestedWeekStart
}

$weekEnd = $weekStart.AddDays(7)
$prevWeekStart = $weekStart.AddDays(-7)
$prevWeekEnd = $weekStart

$current = $parsed | Where-Object { $_.date -ge $weekStart -and $_.date -lt $weekEnd }
$previous = $parsed | Where-Object { $_.date -ge $prevWeekStart -and $_.date -lt $prevWeekEnd }

if (-not $current -or $current.Count -eq 0) {
  if ($AllowNoCurrentWeek) {
    Write-NoDataReport -WeekStart $weekStart -Reason 'No analytics rows found in requested week.'
    return
  }
  throw ("No analytics rows found for week {0} to {1}." -f $weekStart.ToString('yyyy-MM-dd'), $weekEnd.AddDays(-1).ToString('yyyy-MM-dd'))
}

function Aggregate-ByPlatform {
  param([object[]]$Rows)
  return $Rows |
    Group-Object platform |
    ForEach-Object {
      $g = $_.Group
      $views = ($g | Measure-Object views -Sum).Sum
      $likes = ($g | Measure-Object likes -Sum).Sum
      $comments = ($g | Measure-Object comments -Sum).Sum
      $shares = ($g | Measure-Object shares -Sum).Sum
      $follows = ($g | Measure-Object follows -Sum).Sum
      $ret = [double](($g | Measure-Object retention_proxy -Average).Average)
      $posts = $g.Count
      $score = ($views * 1.0) + ($likes * 2.0) + ($comments * 10.0) + ($shares * 15.0) + ($follows * 12.0) + ($ret * 10.0)

      [pscustomobject]@{
        platform = $_.Name
        posts = $posts
        views = [int]$views
        avg_retention_proxy = [math]::Round($ret, 2)
        likes = [int]$likes
        comments = [int]$comments
        shares = [int]$shares
        follows = [int]$follows
        score = [math]::Round($score, 2)
      }
    } |
    Sort-Object score -Descending
}

function Aggregate-Total {
  param([object[]]$Rows)
  $views = ($Rows | Measure-Object views -Sum).Sum
  $likes = ($Rows | Measure-Object likes -Sum).Sum
  $comments = ($Rows | Measure-Object comments -Sum).Sum
  $shares = ($Rows | Measure-Object shares -Sum).Sum
  $follows = ($Rows | Measure-Object follows -Sum).Sum
  $ret = [double](($Rows | Measure-Object retention_proxy -Average).Average)

  return [pscustomobject]@{
    views = [int]$views
    avg_retention_proxy = [math]::Round($ret, 2)
    likes = [int]$likes
    comments = [int]$comments
    shares = [int]$shares
    follows = [int]$follows
    posts = $Rows.Count
  }
}

$currByPlatform = Aggregate-ByPlatform -Rows $current
$currTotal = Aggregate-Total -Rows $current
$prevTotal = if ($previous.Count -gt 0) { Aggregate-Total -Rows $previous } else { $null }

function DeltaString {
  param($Current, $Previous)
  if ($null -eq $Previous) { return 'n/a' }
  $delta = [double]$Current - [double]$Previous
  $sign = if ($delta -gt 0) { '+' } elseif ($delta -lt 0) { '' } else { '' }
  return "${sign}$([math]::Round($delta,2))"
}

$keep = $currByPlatform | Select-Object -First 2
$replace = $currByPlatform | Sort-Object score | Select-Object -First 1

$reportLines = @()
$reportLines += "# Weekly Summary ($($weekStart.ToString('yyyy-MM-dd')) to $($weekEnd.AddDays(-1).ToString('yyyy-MM-dd')))"
$reportLines += ''
$reportLines += '## KPI Snapshot'
$reportLines += "- Posts: $($currTotal.posts)"
$reportLines += "- Views: $($currTotal.views) (WoW: $(DeltaString $currTotal.views ($prevTotal.views)))"
$reportLines += "- Avg retention proxy: $($currTotal.avg_retention_proxy) (WoW: $(DeltaString $currTotal.avg_retention_proxy ($prevTotal.avg_retention_proxy)))"
$reportLines += "- Follows: $($currTotal.follows) (WoW: $(DeltaString $currTotal.follows ($prevTotal.follows)))"
$reportLines += ''
$reportLines += '## Platform Performance'
$reportLines += '| Platform | Posts | Views | Avg Retention | Likes | Comments | Shares | Follows | Score |'
$reportLines += '|---|---:|---:|---:|---:|---:|---:|---:|---:|'
foreach ($p in $currByPlatform) {
  $reportLines += "| $($p.platform) | $($p.posts) | $($p.views) | $($p.avg_retention_proxy) | $($p.likes) | $($p.comments) | $($p.shares) | $($p.follows) | $($p.score) |"
}
$reportLines += ''
$reportLines += '## Recommendation (Keep 2 / Replace 1)'
if ($keep.Count -gt 0) {
  $reportLines += "- Keep: $((($keep | Select-Object -ExpandProperty platform) -join ', '))"
}
if ($replace) {
  $reportLines += "- Replace/Improve first: $($replace.platform)"
}
$reportLines += '- Action: keep current top format elements for the keep set; test one new hook pattern for the replace candidate next week.'
$reportLines += ''
$reportLines += '## Notes'
$reportLines += '- This report uses analytics-level data only (no hook text metadata yet).'
$reportLines += '- Add per-post hook tags later if you want hook-level winner detection.'

if ($WriteReport) {
  New-Item -ItemType Directory -Path $ResolvedReportDir -Force | Out-Null
  $reportPath = Join-Path $ResolvedReportDir ("weekly-summary-{0}.md" -f $weekStart.ToString('yyyy-MM-dd'))
  $reportLines -join "`r`n" | Set-Content -Path $reportPath -Encoding UTF8
  Write-Output "Report written: $reportPath"
}

Write-Output ("Week: {0} to {1}" -f $weekStart.ToString('yyyy-MM-dd'), $weekEnd.AddDays(-1).ToString('yyyy-MM-dd'))
Write-Output ("Views: {0} (WoW {1})" -f $currTotal.views, (DeltaString $currTotal.views ($prevTotal.views)))
Write-Output ("Avg retention proxy: {0} (WoW {1})" -f $currTotal.avg_retention_proxy, (DeltaString $currTotal.avg_retention_proxy ($prevTotal.avg_retention_proxy)))
Write-Output ("Follows: {0} (WoW {1})" -f $currTotal.follows, (DeltaString $currTotal.follows ($prevTotal.follows)))
Write-Output ("Keep: {0}" -f ((($keep | Select-Object -ExpandProperty platform) -join ', ')))
Write-Output ("Replace/Improve: {0}" -f $replace.platform)
