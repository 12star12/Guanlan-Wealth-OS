@echo off
rem Guanlan launcher
rem 1) clear ELECTRON_RUN_AS_NODE - some dev tools set it globally and it
rem    makes electron.exe behave like plain node (app.whenReady is undefined)
rem 2) start from this folder so "." resolves to the app
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
start "" "node_modules\electron\dist\electron.exe" .
exit
