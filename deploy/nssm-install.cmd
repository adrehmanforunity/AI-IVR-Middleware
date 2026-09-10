@echo off
REM Install IIM as a Windows service with NSSM (https://nssm.cc/)
REM Run from an elevated prompt after: npm install && npm run build
REM
REM   nssm install IIM "C:\Program Files\nodejs\node.exe" "C:\opt\iim\dist\index.js"
REM   nssm set IIM AppDirectory C:\opt\iim
REM   nssm set IIM AppEnvironmentExtra NODE_ENV=production
REM   nssm set IIM AppStdout C:\opt\iim\logs\stdout.log
REM   nssm set IIM AppStderr C:\opt\iim\logs\stderr.log
REM   nssm set IIM AppRotateFiles 1
REM   nssm set IIM Start SERVICE_AUTO_START
REM   nssm start IIM

echo See comments in this file for NSSM install steps.
