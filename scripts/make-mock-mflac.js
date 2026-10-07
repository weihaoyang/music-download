'use strict';

// 在下载目录里放几个假的加密文件，用来在没有 QQ 音乐环境时测试 watcher + TuneFree(mock) 流水线。
const fsp = require('fs/promises');
const path = require('path');
const { loadConfig } = require('../src/config');
const { ensureDir } = require('../src/util');

async function main() {
  const cfg = loadConfig();
  const names = process.argv.slice(2);
  const targets = names.length
    ? names
    : ['测试歌手 - 测试歌曲', '另一个歌手 - 雨中的舞步'];

  await ensureDir(cfg.paths.downloadDir);
  for (const name of targets) {
    const file = path.join(cfg.paths.downloadDir, `${name}.mflac`);
    const bytes = Buffer.alloc(2048 + Math.floor(Math.random() * 4096));
    bytes.fill(Math.floor(Math.random() * 256));
    await fsp.writeFile(file, bytes);
    console.log(`已创建模拟加密文件：${file}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
