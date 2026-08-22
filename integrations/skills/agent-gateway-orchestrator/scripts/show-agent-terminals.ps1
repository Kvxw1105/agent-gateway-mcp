param(
  [Parameter(Mandatory = $true)]
  [string]$TaskId,
  [Parameter(Mandatory = $true)]
  [string]$LogPath,
  [Parameter(Mandatory = $true)]
  [string]$StatusPath
)

$ErrorActionPreference = 'Stop'
$log = [System.IO.Path]::GetFullPath($LogPath)
$status = [System.IO.Path]::GetFullPath($StatusPath)
if (-not (Test-Path -LiteralPath $log -PathType Leaf)) { throw "Task log not found: $log" }
if (-not (Test-Path -LiteralPath $status -PathType Leaf)) { throw "Task status not found: $status" }

$host.UI.RawUI.WindowTitle = "Agent Gateway observer - $TaskId"
Write-Host "Observing existing task $TaskId (read-only)" -ForegroundColor Cyan
Write-Host "This window never starts or resumes an Agent." -ForegroundColor DarkGray

$position = 0L
$terminalStates = @('succeeded', 'failed', 'timed_out', 'cancelled')
while ($true) {
  $stream = [System.IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
  try {
    [void]$stream.Seek($position, 'Begin')
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true, 4096, $true)
    try {
      $newText = $reader.ReadToEnd()
      if ($newText.Length -gt 0) { Write-Host -NoNewline $newText }
      $position = $stream.Position
    } finally {
      $reader.Dispose()
    }
  } finally {
    $stream.Dispose()
  }

  $task = Get-Content -LiteralPath $status -Raw | ConvertFrom-Json
  if ($terminalStates -contains $task.status) {
    $length = (Get-Item -LiteralPath $log).Length
    if ($position -ge $length) {
      Write-Host "`n[$($task.status)] task $TaskId finished." -ForegroundColor Green
      break
    }
  }
  Start-Sleep -Milliseconds 250
}
