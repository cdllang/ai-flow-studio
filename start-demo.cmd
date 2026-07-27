@echo off
cd /d "%~dp0"
set NODE_ENV=production
echo AIFlow Studio starting at http://127.0.0.1:14590
echo Press Ctrl+C to stop.
node server.mjs
pause
