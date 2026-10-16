@echo off
chcp 65001 >nul
set ELECTRON_RUN_AS_NODE=
if not exist "%~dp0..\07_发布成品\FileCanvas-0.3.0-Windows-x64.exe" (
  echo 未找到发布程序。请在项目根目录运行 npm.cmd run package:win。
  pause
  exit /b 1
)
start "" "%~dp0..\07_发布成品\FileCanvas-0.3.0-Windows-x64.exe"
