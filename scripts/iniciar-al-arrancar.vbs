' Inicia logística Andreani al arrancar Windows (sin ventanas).
' API Python + NOT-BRAIN (Vite). Rutas relativas a esta carpeta.

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

brainDir = fso.GetParentFolderName(WScript.ScriptFullName)
andreaniDir = fso.GetParentFolderName(brainDir) & "\NOT-ANDREANI"

' Esperar unos segundos a que Windows termine de cargar red
WScript.Sleep 8000

' API Andreani (puerto 8765)
apiCmd = "cmd /c cd /d """ & andreaniDir & """ && python -m uvicorn api.main:app --host 127.0.0.1 --port 8765"
shell.Run apiCmd, 0, False

WScript.Sleep 4000

' NOT-BRAIN (puerto 5173)
brainCmd = "cmd /c cd /d """ & brainDir & """ && npm run dev"
shell.Run brainCmd, 0, False
