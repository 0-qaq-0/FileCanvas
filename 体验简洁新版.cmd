@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm.cmd run preview:simple
if errorlevel 1 pause
