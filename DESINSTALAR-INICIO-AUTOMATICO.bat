@echo off
chcp 65001 >nul
title Quitar inicio automático - Logística Andreani

set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NOTMID-Logistica-Andreani.lnk"

if exist "%LINK%" (
  del "%LINK%"
  echo Acceso directo de inicio automático eliminado.
) else (
  echo No había inicio automático instalado.
)

echo.
pause
