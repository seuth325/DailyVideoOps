param(
  [Parameter(Mandatory=$true)][string]$Date,
  [Parameter(Mandatory=$true)][ValidateSet('tiktok','instagram','facebook','youtube_shorts','whatsapp')][string]$Platform,
  [Parameter(Mandatory=$true)][int]$Views,
  [Parameter(Mandatory=$true)][double]$RetentionProxy,
  [Parameter(Mandatory=$true)][int]$Likes,
  [Parameter(Mandatory=$true)][int]$Comments,
  [Parameter(Mandatory=$true)][int]$Shares,
  [Parameter(Mandatory=$true)][int]$Follows,
  [string]$Root
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

$logPath = Join-Path $Root 'data/analytics-log.csv'
if (-not (Test-Path $logPath)) {
  'date,platform,views,retention_proxy,likes,comments,shares,follows' | Set-Content -Path $logPath -Encoding UTF8
}

try {
  $null = [datetime]::ParseExact($Date, 'yyyy-MM-dd', $null)
} catch {
  throw 'Date must be in yyyy-MM-dd format.'
}

if ($Views -lt 0 -or $RetentionProxy -lt 0 -or $Likes -lt 0 -or $Comments -lt 0 -or $Shares -lt 0 -or $Follows -lt 0) {
  throw 'Metrics cannot be negative.'
}

$row = [pscustomobject]@{
  date = $Date
  platform = $Platform
  views = $Views
  retention_proxy = $RetentionProxy
  likes = $Likes
  comments = $Comments
  shares = $Shares
  follows = $Follows
}

$row | Export-Csv -Path $logPath -NoTypeInformation -Append
Write-Output "Logged analytics for $Platform on $Date to $logPath"
