@echo off
setlocal
cd /d "%~dp0"
echo === Memecoin Radar: X buzz reader setup ===
echo.
set PY=python
py -3 --version >nul 2>&1 && set "PY=py -3"

echo [1/4] Installing the browser automation library...
%PY% -m pip install -q -U playwright || (echo pip failed & pause & exit /b 1)

echo [2/4] Settings file...
if not exist .env (
  copy /y .env.example .env >nul
  echo   Created laptop\.env  -  open it in Notepad and fill in GITHUB_REPO and GITHUB_TOKEN.
  start notepad .env
  echo   Save it, close Notepad, then press a key here.
  pause >nul
)

echo [3/4] Log in to X once in the window that opens. Close the window when you are logged in.
%PY% x_buzz.py --login

echo [4/4] Scheduling it every 30 minutes...
set "PYW=pyw"
where pyw >nul 2>&1 || set "PYW=pythonw"
schtasks /create /f /sc minute /mo 30 /tn "Memecoin Radar X buzz" /tr "\"%PYW%\" \"%~dp0x_buzz.py\"" >nul && echo   Scheduled. || echo   Could not schedule - run this file again as your normal user.

echo.
echo Test run now (results print below, nothing uploaded)...
%PY% x_buzz.py --dry
echo.
echo Done. It now runs every 30 minutes while you are logged in to Windows.
echo To stop it: schtasks /delete /tn "Memecoin Radar X buzz" /f
pause
