# ===== 云端部署用 Dockerfile =====
FROM node:22-alpine

WORKDIR /app

# 把整个项目目录（server.js + index.html + config.json）复制进去
COPY . .

# 暴露端口（云平台会把外部流量转到这个端口）
EXPOSE 3210

# 启动同步服务
CMD ["node", "server.js"]
