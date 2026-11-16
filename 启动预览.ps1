$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw '请安装 Node.js 22.13+，然后重新运行。' }
if (-not (Test-Path -LiteralPath 'node_modules/next/dist/bin/next')) { throw '请先执行 pnpm install --frozen-lockfile。' }
& $nodeCommand.Source (Join-Path $PSScriptRoot 'scripts/server-local.mjs')
