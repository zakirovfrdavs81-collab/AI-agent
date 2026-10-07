@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    py -m venv .venv
    if errorlevel 1 goto :setup_failed
    call ".venv\Scripts\activate.bat"
    python -m pip install -r requirements.txt
    if errorlevel 1 goto :setup_failed
) else (
    call ".venv\Scripts\activate.bat"
)
if not exist ".env" copy ".env.example" ".env" >nul
rem 5507-port FastAPI uchun: dist frontend va API shu serverdan uzatiladi.
where npm >nul 2>nul
if errorlevel 1 goto :npm_missing
if not exist "node_modules" (
    echo Frontend paketlari ornatilmoqda...
    call npm install
    if errorlevel 1 goto :build_failed
)
echo Frontend yig'ilmoqda...
call npm run build
if errorlevel 1 goto :build_failed
if not exist "dist\index.html" goto :dist_missing
if not exist "dist\assets" goto :dist_missing
echo.
echo Sayt manzili:       http://127.0.0.1:5507
echo Taqdimot sahifasi:  http://127.0.0.1:5507/showcase/
echo Google JavaScript origin: http://127.0.0.1:5507
echo Google JavaScript origin: http://localhost:5507
echo Vite JavaScript origin:   http://127.0.0.1:5173
echo Google redirect URI:      http://127.0.0.1:5507/api/auth/google/callback
echo Serverni to'xtatish uchun Ctrl+C bosing.
python -m uvicorn main:app --host 127.0.0.1 --port 5507
echo.
echo Server to'xtadi. 5507-port band bo'lsa, boshqa ilova uni ishlatayotgan bo'lishi mumkin.
pause
exit /b 1

:npm_missing
echo XATO: Node.js va npm topilmadi. Node.js o'rnatib, run.bat ni qayta ishga tushiring.
pause
exit /b 1

:build_failed
echo XATO: Frontend build muvaffaqiyatsiz tugadi. Yuqoridagi xatolarni tuzating.
pause
exit /b 1

:dist_missing
echo XATO: dist\index.html yoki dist\assets topilmadi. Build natijasi to'liq emas.
pause
exit /b 1

:setup_failed
echo XATO: Python muhiti yoki backend paketlarini sozlab bo'lmadi.
pause
exit /b 1
