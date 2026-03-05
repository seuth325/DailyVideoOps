param(
  [string]$Date = (Get-Date -Format 'yyyy-MM-dd'),
  [string]$Root,
  [switch]$SkipMarkUsed
)

if ([string]::IsNullOrWhiteSpace($Root)) {
  if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  } elseif ($MyInvocation.MyCommand.Path) {
    $Root = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..')).Path
  } else {
    $Root = (Get-Location).Path
  }
}

$topicBankPath = Join-Path $Root 'data/topic-bank.csv'
$schedulePath = Join-Path $Root 'config/schedule.json'
$templateBriefPath = Join-Path $Root 'templates/content-brief-template.md'
$templateCaptionsPath = Join-Path $Root 'templates/caption-templates.md'
$templateChecklistPath = Join-Path $Root 'templates/daily-publish-checklist.md'

if (-not (Test-Path $topicBankPath)) { throw "Missing topic bank: $topicBankPath" }
if (-not (Test-Path $schedulePath)) { throw "Missing schedule config: $schedulePath" }

$topics = Import-Csv $topicBankPath
if (-not $topics) { throw 'Topic bank is empty.' }

$priorityRank = @{ high = 1; medium = 2; low = 3 }
$readyTopics = $topics | Where-Object { $_.status -eq 'ready' }
if (-not $readyTopics) { throw "No ready topics found in $topicBankPath. Add rows with status=ready." }

$selected = $readyTopics |
  Sort-Object -Property @{Expression = { $priorityRank[$_.priority] }}, @{Expression = {[int]$_.slot}} |
  Select-Object -First 1

$topicSlug = ($selected.topic -replace '[^a-zA-Z0-9\s-]','' -replace '\s+','-' -replace '-+','-').ToLower()
if ([string]::IsNullOrWhiteSpace($topicSlug)) { $topicSlug = 'daily-topic' }

$outputDir = Join-Path $Root ("output/$Date")
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$schedule = Get-Content $schedulePath -Raw | ConvertFrom-Json

$brief = Get-Content $templateBriefPath -Raw
$brief = $brief.Replace('{{date}}', $Date)
$brief = $brief.Replace('{{topic}}', $selected.topic)

$captions = Get-Content $templateCaptionsPath -Raw
$captions = $captions.Replace('{{hook_line}}', "I learned this the hard way: $($selected.topic)")
$captions = $captions.Replace('{{story_line}}', $selected.story_angle)
$captions = $captions.Replace('{{lesson_line}}', $selected.lesson)
$captions = $captions.Replace('{{cta_line}}', $selected.cta)
$captions = $captions.Replace('{{short_hook}}', 'Hard lesson today')
$captions = $captions.Replace('{{seo_short_title}}', "$($selected.topic): what I learned")
$captions = $captions.Replace('{{topic_keyword}}', ($topicSlug -replace '-',''))

$checklist = Get-Content $templateChecklistPath -Raw
$checklist = $checklist.Replace('{{date}}', $Date)
$checklist = $checklist.Replace('{{topic}}', $selected.topic)

$briefPath = Join-Path $outputDir 'content-brief.md'
$captionsPath = Join-Path $outputDir 'captions-draft.md'
$checklistPath = Join-Path $outputDir 'publish-checklist.md'
$manifestPath = Join-Path $outputDir 'manifest.json'

Set-Content -Path $briefPath -Value $brief -Encoding UTF8
Set-Content -Path $captionsPath -Value $captions -Encoding UTF8
Set-Content -Path $checklistPath -Value $checklist -Encoding UTF8

$manifest = [ordered]@{
  date = $Date
  timezone = $schedule.timezone
  selected_topic = $selected.topic
  story_angle = $selected.story_angle
  lesson = $selected.lesson
  cta = $selected.cta
  naming_standard = $schedule.naming_standard
  post_windows_et = $schedule.post_windows_et
  assets_expected = @(
    "${Date}_${topicSlug}_master_v1.mp4",
    "${Date}_${topicSlug}_tiktok_v1.mp4",
    "${Date}_${topicSlug}_instagram_v1.mp4",
    "${Date}_${topicSlug}_facebook_v1.mp4",
    "${Date}_${topicSlug}_youtube_v1.mp4",
    "${Date}_${topicSlug}_whatsapp_v1.mp4"
  )
  approval_required = $true
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

if (-not $SkipMarkUsed) {
  foreach ($row in $topics) {
    if ($row.slot -eq $selected.slot -and $row.topic -eq $selected.topic -and $row.status -eq 'ready') {
      $row.status = 'used'
      break
    }
  }
  $topics | Export-Csv -Path $topicBankPath -NoTypeInformation
}

Write-Output "Generated daily package: $outputDir"
Write-Output "Selected topic: $($selected.topic)"
Write-Output "Brief: $briefPath"
Write-Output "Captions: $captionsPath"
Write-Output "Checklist: $checklistPath"
Write-Output "Manifest: $manifestPath"
if ($SkipMarkUsed) {
  Write-Output 'Topic bank unchanged (SkipMarkUsed enabled).'
} else {
  Write-Output "Topic marked as used in: $topicBankPath"
}
