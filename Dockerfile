# 舞曲排曲台 后端（含前端静态产物）镜像
# 注意：QQ 音乐客户端镜像（bridge，端口 8899）需要真机上的 QQ 音乐客户端，无法放进容器；
# 容器里请把 config.json 的 bridgeUrl 指向宿主机，例如 http://host.docker.internal:8899/cookie
FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY packages/qqmusic-sdk   packages/qqmusic-sdk
COPY packages/dance-sdk     packages/dance-sdk
COPY packages/dance-backend packages/dance-backend
COPY packages/dance-frontend packages/dance-frontend

RUN cd packages/qqmusic-sdk && npm install && npm run build \
 && cd ../dance-sdk         && npm install && npm run build \
 && cd ../dance-backend     && npm install && npm run build \
 && cd ../dance-frontend    && npm install && npm run build

WORKDIR /app/packages/dance-backend
EXPOSE 8790
CMD ["node", "dist/index.js"]
