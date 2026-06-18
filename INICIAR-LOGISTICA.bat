@echo off
title NOTMID - Logistica Andreani
echo.
echo  Iniciando logistica Andreani...
echo  - API Python (NOT-ANDREANI) en puerto 8765
echo  - NOT-BRAIN en http://localhost:5173/logistica-andreani
echo.
echo  Deja esta ventana abierta. Para cerrar todo, cierra las ventanas que se abran.
echo.

start "Andreani API" cmd /k "cd /d C:\Users\santi\Desktop\PROGRAMAS\NOT-ANDREANI && python -m uvicorn api.main:app --host 127.0.0.1 --port 8765"

timeout /t 3 /nobreak >nul

start "NOT-BRAIN" cmd /k "cd /d C:\Users\santi\Desktop\PROGRAMAS\NOTMID-BRAIN && npm run dev"

echo.
echo  Listo. Abri el navegador en:
echo  http://localhost:5173/logistica-andreani
echo.
pause
