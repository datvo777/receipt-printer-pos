@echo off
chcp 65001 >nul
title Tiem Bill - dung tat cua so nay khi dang ban hang
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js tren may nay.
  echo Vao https://nodejs.org tai ban LTS, cai xong roi chay lai file start.bat.
  pause
  exit /b 1
)
:loop
node server.js
if errorlevel 2 (
  echo.
  echo App dang chay san o cua so khac. Hay dong cua so cu roi chay lai.
  pause
  exit /b 2
)
echo.
echo App bi dung, tu khoi dong lai sau 3 giay...
timeout /t 3 >nul
goto loop
