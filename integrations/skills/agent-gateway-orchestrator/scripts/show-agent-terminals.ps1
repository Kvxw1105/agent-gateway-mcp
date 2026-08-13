param(
  [Parameter(Mandatory = $true)]
  [string]$GatewayRepo,
  [Parameter(Mandatory = $true)]
  [string]$PromptFile,
  [string[]]$Providers = @('pi', 'kimi', 'zcode'),
  [string]$NodePath = 'node',
  [string]$OutputDirectory = (Join-Path $env:TEMP 'agent-gateway-demo')
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath $GatewayRepo -ErrorAction Stop).Path
$prompt = (Resolve-Path -LiteralPath $PromptFile -ErrorAction Stop).Path
$entry = Join-Path $repo 'dist\tests\provider-live-smoke.js'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw "Build the gateway first: $entry" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$allowed = @('zcode', 'kimi', 'codex', 'pi')
foreach ($provider in $Providers) {
  if ($provider -notin $allowed) { throw "Unsupported visible provider: $provider" }
  $result = Join-Path $OutputDirectory "$provider-result.json"
  $command = "Set-Location -LiteralPath '$($repo.Replace("'", "''"))'; " +
    "`$host.UI.RawUI.WindowTitle='Agent Gateway - $provider'; " +
    "Write-Host '[$provider] dispatched by controller' -ForegroundColor Cyan; " +
    "& '$($NodePath.Replace("'", "''"))' '$($entry.Replace("'", "''"))' '$provider' '$($prompt.Replace("'", "''"))' '$($result.Replace("'", "''"))'; " +
    "Write-Host '[$provider] result returned; terminal retained' -ForegroundColor Green"
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoLogo', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $command
  ) -WindowStyle Normal | Out-Null
}

Write-Output "Started $($Providers.Count) visible Agent Gateway terminals."
