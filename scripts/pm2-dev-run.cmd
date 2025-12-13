@echo off
call npm run build:all:dev
if %errorlevel% neq 0 exit /b %errorlevel%
node server/dist/index.js --console --server-config ./server-config.dev.json --shared-config ./shared/shared-config.dev.json

