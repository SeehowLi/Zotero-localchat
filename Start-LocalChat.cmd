@echo off
cd /d "%~dp0"
node scripts\start.cjs
if errorlevel 1 pause
