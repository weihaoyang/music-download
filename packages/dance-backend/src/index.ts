import { loadConfig } from './config';
import { createServer } from './server';

const cfg = loadConfig();
const { server } = createServer(cfg);

server.listen(cfg.port, cfg.host, () => {
  console.log(`dance-backend 已启动：http://${cfg.host}:${cfg.port}`);
  console.log(`曲库目录：${cfg.dataDir} | 客户端镜像：${cfg.bridgeUrl}`);
});
