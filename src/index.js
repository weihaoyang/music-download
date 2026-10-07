'use strict';

const fsp = require('fs/promises');
const { loadConfig } = require('./config');
const log = require('./log');
const { JobStore } = require('./jobs');
const { Watcher } = require('./watcher');
const { createServer } = require('./server');

async function main() {
  const args = process.argv.slice(2);
  const cfg = loadConfig();
  if (args.includes('--no-watch')) cfg.watcher.enabled = false;

  await fsp.mkdir(cfg.paths.workDir, { recursive: true });

  const jobs = new JobStore(cfg);
  await jobs.load();

  const watcher = new Watcher(cfg, jobs);
  watcher.start();

  const server = createServer(cfg, jobs);
  server.listen(cfg.server.port, cfg.server.host, () => {
    log.info(`补歌服务已启动：http://${cfg.server.host}:${cfg.server.port}`);
    log.info(
      `QQMusicApi=${cfg.paths.musicApiBase} | 引擎=${cfg.engine.default} | mock=${cfg.converter.mock} | 曲库=${cfg.paths.libraryDir}`,
    );
  });

  const shutdown = () => {
    log.info('正在退出...');
    watcher.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
