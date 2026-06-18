@echo off
chcp 65001 >nul
title Instalar inicio automático - Logística Andreani
echo.
echo  Esto agrega un acceso directo en "Inicio de Windows"
echo  para que la API Andreani y NOT-BRAIN arranquen solos al prender la PC.
echo.
echo  Marcador en el navegador:
echo  http://localhost:5173/logistica-andreani
echo.

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%~dp0scripts\iniciar-al-arrancar.vbs"
set "LINK=%STARTUP%\NOTMID-Logistica-Andreani.lnk"

if not exist "%VBS%" (
  echo Error: no se encontró %VBS%
  pause
  exit /b 1
)

powershell -NoProfile -Command ^
  "$s = New-Object -ComObject WScript.Shell; ^
   $l = $s.CreateShortcut('%LINK%'); ^
   $l.TargetPath = 'wscript.exe'; ^
   $l.Arguments = '\"\"\"%VBS%\"\"\"'; ^
   $l.WorkingDirectory = '%~dp0'; ^
   $l.WindowStyle = 7; ^
   $l.Description = 'NOTMID Logistica Andreani - API + NOT-BRAIN'; ^
   $l.Save()"

if exist "%LINK%" (
  echo.
  echo  Listo. Al iniciar sesión en Windows se abrirá todo en segundo plano.
  echo  Acceso directo: %LINK%
  echo.
  echo  Para probar ahora sin reiniciar, ejecutá INICIAR-LOGISTICA.bat
  echo  o hacé doble clic en el acceso directo de Inicio.
) else (
  echo  No se pudo crear el acceso directo.
)

echo.
pause
