@echo off
rem Oplati sa - jednorazove nastavenie automatickej aktualizacie akcii na tomto PC.
rem Staci dvojklik. Nainstaluje Node.js a Git (ak chybaju), prepoji priecinok s GitHubom,
rem naplanuje denne spustenie (7:10 a 15:10) a hned spravi prvu aktualizaciu.
setlocal
cd /d "%~dp0"
title Oplati sa - nastavenie automatickej aktualizacie
echo.
echo  === Oplati sa: nastavenie automatickej aktualizacie ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [1/5] Instalujem Node.js LTS ^(Windows sa moze opytat na povolenie - klikni Ano^)...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
) else echo [1/5] Node.js uz je nainstalovany.

where git >nul 2>nul
if errorlevel 1 (
  echo [2/5] Instalujem Git ^(Windows sa moze opytat na povolenie - klikni Ano^)...
  winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
) else echo [2/5] Git uz je nainstalovany.

rem cerstvo nainstalovane programy este nie su v PATH tohto okna
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd"
where node >nul 2>nul || goto :nonode
where git >nul 2>nul || goto :nogit

echo [3/5] Prepajam priecinok s GitHubom (M1notaurLool/oplati-sa)...
if not exist ".git" (
  git init -q -b main
  git remote add origin https://github.com/M1notaurLool/oplati-sa.git
)
git config user.name >nul 2>nul || git config user.name "M1notaurLool"
git config user.email >nul 2>nul || git config user.email "M1notaurLool@users.noreply.github.com"
git fetch -q origin main || goto :nofetch
git reset -q origin/main
rem subory v priecinku nahradi aktualnou verziou z GitHubu (vlastne subory mimo projektu ostanu)
git checkout -q -- .
git branch -q --set-upstream-to=origin/main main
echo       Ak sa otvori okno GitHubu, prihlas sa (len raz - Git si to zapamata).
git push --dry-run -q origin main || goto :noauth

echo [4/5] Planujem dennu aktualizaciu (Planovac uloh, 7:10 a 15:10)...
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\naplanuj.ps1" || goto :nosched

echo [5/5] Prva aktualizacia akcii (moze trvat par minut)...
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\aktualizuj.ps1"
echo.
echo  Hotovo. Akcie sa odteraz aktualizuju samy, ked je PC zapnute.
echo  Zaznam z behu: data\raw\aktualizacia.log
echo.
pause
exit /b 0

:nonode
echo Node.js sa nepodarilo nainstalovat. Stiahni ho z https://nodejs.org (verzia LTS) a spusti tento subor znova.
pause & exit /b 1
:nogit
echo Git sa nepodarilo nainstalovat. Stiahni ho z https://git-scm.com a spusti tento subor znova.
pause & exit /b 1
:nofetch
echo Nepodarilo sa spojit s GitHubom. Skontroluj internet a ze repozitar M1notaurLool/oplati-sa existuje.
pause & exit /b 1
:noauth
echo Prihlasenie na GitHub sa nepodarilo. Spusti tento subor znova a v okne GitHubu sa prihlas.
pause & exit /b 1
:nosched
echo Naplanovanie ulohy sa nepodarilo. Skus tento subor spustit znova.
pause & exit /b 1
