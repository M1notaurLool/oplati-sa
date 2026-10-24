# Oplatí sa – aktualizácia akcií z tohto počítača (Windows).
# Stiahne akcie, uloží ich a pošle na GitHub; GitHub Pages ich do pár minút zverejní.
# Spúšťa ho Plánovač úloh (nastaví nastav-automaticku-aktualizaciu.cmd), dá sa spustiť aj ručne:
#   powershell -ExecutionPolicy Bypass -File tools\aktualizuj.ps1
# Potrebuje: Node.js 22+ a Git prihlásený na GitHub.

$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:Path = "$env:Path;$env:ProgramFiles\nodejs;$env:ProgramFiles\Git\cmd"
New-Item -ItemType Directory -Force -Path (Join-Path $root 'data\raw') | Out-Null
Start-Transcript -Path (Join-Path $root 'data\raw\aktualizacia.log') -Append | Out-Null

function Krok([string]$popis, [scriptblock]$prikaz) {
  Write-Host "== $popis"
  & $prikaz
  if ($LASTEXITCODE -ne 0) { throw "$popis zlyhalo (kód $LASTEXITCODE)" }
}

try {
  Krok 'Stiahnuť zmeny z GitHubu' { git pull --rebase --autostash -q }
  # knižnica na čítanie PDF letáku Albertu (apka ju nepotrebuje)
  if (-not (Test-Path (Join-Path $root 'node_modules\pdfjs-dist'))) {
    Krok 'Inštalácia pdfjs-dist' { npm install --no-save --no-package-lock --no-audit --no-fund pdfjs-dist@4.10.38 }
  }
  # Kaufland zo záložky (kaufland-zalozka.html): súbory kaufland-*.raw.json zo Stiahnutých súborov
  $downloads = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
  $kDir = Join-Path $root 'data\raw\kaufland'
  New-Item -ItemType Directory -Force -Path $kDir | Out-Null
  $fresh = Get-ChildItem -Path $downloads -Filter 'kaufland-*.raw.json' -ErrorAction SilentlyContinue
  if ($fresh) {
    $fresh | Move-Item -Destination $kDir -Force
    $week = Get-ChildItem -Path $kDir -Filter 'kaufland-*.raw.json' | Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-8) }
    Krok 'Kaufland zo záložky' { node scraper/from-raw.js $week.FullName }
    $converted = $week | ForEach-Object { $_.FullName -replace '\.raw\.json$', '.json' }
    Krok 'Import Kauflandu' { node scraper/import.js $converted }
  }
  Krok 'Stiahnuť akcie' { node scraper/run.js }
  node scraper/stores.js   # predajne raz za týždeň; chyba tu nevadí
  git add app/data data/price-history.json
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    Krok 'Uložiť zmeny' { git commit -q -m "data: akcie z PC $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
    Krok 'Poslať na GitHub' { git push -q }
    Write-Host 'Akcie aktualizované a odoslané na GitHub.'
  } else {
    Write-Host 'Žiadne zmeny v akciách.'
  }
} catch {
  Write-Host "Chyba: $_"
  exit 1
} finally {
  Stop-Transcript | Out-Null
}
