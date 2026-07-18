@echo off
cd /d "%~dp0"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v PUBLIC_DATA_API_KEY 2^>nul') do set "PUBLIC_DATA_API_KEY=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v WASTE_API_KEY 2^>nul') do set "WASTE_API_KEY=%%B"
npm run db:sync
pause
