# Oplatí sa – aktualizácia akcií z tohto počítača (Windows).
# Stiahne akcie, uloží ich a pošle na GitHub; GitHub Pages ich do pár minút zverejní.
# Spúšťa ho Plánovač úloh (nastaví tools/naplanuj.ps1), dá sa spustiť aj ručne:
#   powershell -ExecutionPolicy Bypass -File tools\aktualizuj.ps1
# Potrebuje: Node.js 22+ a Git (prihlásený na GitHub – stačí raz urobiť git push ručne).

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
New-Item -ItemType Directory -Force -Path (Join-Path $root 'data\raw') | Out-Null
Start-Transcript -Path (Join-Path $root 'data\raw\aktualizacia.log') -Append | Out-Null

try {
  git pull --rebase --autostash
  # knižnica na čítanie PDF letáku Albertu (apka ju nepotrebuje)
  if (-not (Test-Path (Join-Path $root 'node_modules\pdfjs-dist'))) {
    npm install --no-save --no-package-lock pdfjs-dist@4.10.38
  }
  node scraper/run.js
  node scraper/stores.js
  git add app/data data/price-history.json
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    git commit -m "data: akcie z PC $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    git push
  } else {
    Write-Host 'Žiadne zmeny v akciách.'
  }
} catch {
  Write-Host "Chyba: $_"
  exit 1
} finally {
  Stop-Transcript | Out-Null
}
