# Oplatí sa – nastaví Plánovač úloh vo Windows, aby sa akcie aktualizovali samy každý deň.
# Spúšťa ho nastav-automaticku-aktualizaciu.cmd (dvojklik). Ručne: powershell -ExecutionPolicy Bypass -File tools\naplanuj.ps1
# Zrušenie:    Unregister-ScheduledTask -TaskName 'Oplati sa - aktualizacia akcii' -Confirm:$false
#
# Úloha beží o 7:10 a 15:10. Keď je počítač v tom čase vypnutý, spustí sa hneď po zapnutí.

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'aktualizuj.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At '07:10'),
  (New-ScheduledTaskTrigger -Daily -At '15:10')
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'Oplati sa - aktualizacia akcii' -Action $action -Trigger $triggers `
  -Settings $settings -Description 'Stiahne akcie pre apku Oplatí sa a pošle ich na GitHub.' -Force | Out-Null
Write-Host 'Hotovo: akcie sa budú aktualizovať každý deň o 7:10 a 15:10 (alebo hneď po zapnutí PC).'
