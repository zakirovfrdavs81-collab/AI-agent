$env:DEV_SHOW_OTP = 'true'
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }
Write-Output "Using python: $python"
& "$python" -m uvicorn main:app --host 127.0.0.1 --port 5507
