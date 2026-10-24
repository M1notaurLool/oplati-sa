@echo off
rem Oplati sa - aktualizuj akcie hned (napr. po ulozeni Kauflandu zalozkou).
cd /d "%~dp0"
title Oplati sa - aktualizacia akcii
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\aktualizuj.ps1"
echo.
pause
