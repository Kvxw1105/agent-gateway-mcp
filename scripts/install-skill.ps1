param(
  [ValidateSet('codex', 'claude', 'both')]
  [string]$TargetHost = 'codex',
  [string]$CodexSkillsRoot = (Join-Path $env:USERPROFILE '.codex\skills'),
  [string]$ClaudeSkillsRoot = (Join-Path $env:USERPROFILE '.claude\skills')
)

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repository 'integrations\skills\agent-gateway-orchestrator'
if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md') -PathType Leaf)) {
  throw "Bundled skill not found: $source"
}

$destinations = switch ($TargetHost) {
  'codex' { Join-Path $CodexSkillsRoot 'agent-gateway-orchestrator' }
  'claude' { Join-Path $ClaudeSkillsRoot 'agent-gateway-orchestrator' }
  'both' {
    Join-Path $CodexSkillsRoot 'agent-gateway-orchestrator'
    Join-Path $ClaudeSkillsRoot 'agent-gateway-orchestrator'
  }
}

foreach ($destination in $destinations) {
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Copy-Item -LiteralPath (Join-Path $source 'SKILL.md') -Destination $destination -Force
  foreach ($folder in @('agents', 'references', 'scripts')) {
    $from = Join-Path $source $folder
    if (Test-Path -LiteralPath $from -PathType Container) {
      Copy-Item -LiteralPath $from -Destination $destination -Recurse -Force
    }
  }
  Write-Output "Installed Agent Gateway skill: $destination"
}
