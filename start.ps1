# YMS Enhanced - single-command local start (Windows PowerShell). Usage: .\start.ps1  or double-click start.bat
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$Port = if ($env:PORT) { $env:PORT } else { "8080" }; $OcrPort = if ($env:OCR_PORT) { $env:OCR_PORT } else { "8001" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "Node.js 20+ is required: https://nodejs.org"; exit 1 }
if ([int](node -p "process.versions.node.split('.')[0]") -lt 20) { Write-Host "Node.js 20+ required"; exit 1 }
if (-not (Test-Path services\core\node_modules)) { Write-Host "[1/3] Installing core dependencies..."; Push-Location services\core; npm ci --no-audit --no-fund; Pop-Location }
if (-not (Test-Path apps\web\dist\index.html)) { Write-Host "[2/3] Building web app..."; Push-Location apps\web; npm ci --no-audit --no-fund; npx vite build; Pop-Location }
$py = (Get-Command py -ErrorAction SilentlyContinue); $pyArgs = @("-3")
if (-not $py) { $py = (Get-Command python -ErrorAction SilentlyContinue); $pyArgs = @() }
$ocr = $null
if ($py) {
  if (-not (Test-Path services\ocr\.venv\Scripts\uvicorn.exe)) { Write-Host "[3/3] Setting up OCR (Python venv)..."; & $py.Source @pyArgs -m venv services\ocr\.venv; & services\ocr\.venv\Scripts\pip.exe install -q -r services\ocr\requirements.txt }
  $ocr = Start-Process -FilePath "$PSScriptRoot\services\ocr\.venv\Scripts\uvicorn.exe" -ArgumentList "main:app","--host","127.0.0.1","--port",$OcrPort -WorkingDirectory "$PSScriptRoot\services\ocr" -RedirectStandardOutput "$PSScriptRoot\ocr.log" -RedirectStandardError "$PSScriptRoot\ocr.err.log" -PassThru -WindowStyle Hidden
  Write-Host "OCR service starting on :$OcrPort"
} else { Write-Host "WARNING: Python 3.10+ not found - OCR disabled; manual gate entry still works." }
Write-Host "Open http://localhost:$Port   (demo login: tenant.admin@ksap.example / Ymsnow!2026)"
try { Set-Location services\core; $env:PORT = $Port; $env:OCR_URL = "http://127.0.0.1:$OcrPort"; npx tsx src/server.ts }
finally { if ($ocr) { Stop-Process -Id $ocr.Id -ErrorAction SilentlyContinue } }
