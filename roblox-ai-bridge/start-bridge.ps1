$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path "bridge\logs")) {
    New-Item -ItemType Directory -Path "bridge\logs" | Out-Null
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Roblox AI Bridge" -ForegroundColor Cyan
Write-Host "Dossier : $root" -ForegroundColor Gray
Write-Host "Console : bridge\logs\server.log" -ForegroundColor Gray
Write-Host "Appuie sur Ctrl+C pour arreter proprement." -ForegroundColor Gray
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$exitCode = 0
try {
    & node "bridge/server.js"
    $exitCode = $LASTEXITCODE
} catch {
    $exitCode = 1
    Write-Host ""
    Write-Host "Erreur PowerShell :" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
    Write-Host ""
    if ($exitCode -ne 0) {
        Write-Host "Le bridge s'est arrete avec le code $exitCode." -ForegroundColor Red
        Write-Host "Regarde la console ci-dessus ou bridge\logs\server.log" -ForegroundColor Yellow
    } else {
        Write-Host "Le bridge s'est arrete proprement." -ForegroundColor Green
    }
    Write-Host ""
    Read-Host "Appuie sur Entree pour fermer"
}

exit $exitCode
