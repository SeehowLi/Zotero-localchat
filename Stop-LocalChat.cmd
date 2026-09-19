@echo off
cd /d "%~dp0"
node scripts\start.cjs --stop
if errorlevel 1 pause
