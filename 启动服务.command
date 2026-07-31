#!/bin/zsh
# 双击启动学员进度管理同步服务
cd "$(dirname "$0")"
NODE="/Users/penghaoxuan/.workbuddy/binaries/node/versions/22.22.2/bin/node"
if [ ! -x "$NODE" ]; then NODE="node"; fi
echo "正在启动服务..."
( sleep 1 && open "http://localhost:3210" ) &
exec "$NODE" server.js
