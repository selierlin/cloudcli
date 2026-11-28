@echo off
cd /d E:\Projects\cloudcli
set PATH=C:\Users\10780\AppData\Roaming\nvm\v26.9.0;C:\Program Files\Git\cmd;%PATH%
set CLAUDE_CLI_PATH=C:\Users\10780\AppData\Roaming\nvm\v26.9.0\claude.cmd
"C:\Users\10780\AppData\Roaming\nvm\v26.9.0\node.exe" dist-server\server\index.js >> "E:\Projects\cloudcli\service.log" 2>&1
