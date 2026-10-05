@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    py -m venv .venv
    call ".venv\Scripts\activate.bat"
    python -m pip install -r requirements.txt
) else (
    call ".venv\Scripts\activate.bat"
)
if not exist ".env" copy ".env.example" ".env" >nul
uvicorn main:app --reload --port 5506
