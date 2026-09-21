@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" http://localhost:5173
node server.mjs 5173
