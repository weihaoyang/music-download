'use strict';

// 离线自测：不依赖 QQ 音乐 / 排曲系统，验证「加密文件 -> 解密(mock) -> 规范化入库」整条流水线。
const fsp = require('fs/promises');
const path = require('path');
const { loadConfig, ROOT } = require('../src/config');
const { JobStore } = require('../src/jobs');
const { Watcher } = require('../src/watcher');
const assert = require('assert');

async function main() {
  const cfg = loadConfig();
  cfg.converter.mock = true;
  cfg.watcher.stableRounds = 1;
  cfg.paths.workDir = path.join(ROOT, '.selftest', 'work');
  cfg.paths.downloadDir = path.join(ROOT, '.selftest', 'download');
  cfg.paths.libraryDir = path.join(ROOT, '.selftest', 'library');

  await fsp.rm(path.join(ROOT, '.selftest'), { recursive: true, force: true });
  await fsp.mkdir(cfg.paths.downloadDir, { recursive: true });
  await fsp.mkdir(cfg.paths.libraryDir, { recursive: true });

  const src = path.join(cfg.paths.downloadDir, '周杰伦 - 晴天.mflac');
  await fsp.writeFile(src, Buffer.from('fake-encrypted-audio-bytes'));

  const jobs = new JobStore(cfg);
  await jobs.load();
  const watcher = new Watcher(cfg, jobs);

  // 第一轮：记录文件大小；第二轮：大小不变 -> 触发处理
  await watcher.tick();
  await watcher.tick();

  const imported = path.join(cfg.paths.libraryDir, '周杰伦 - 晴天.mp3');
  await fsp.access(imported);
  const job = jobs.list(1)[0];
  assert.strictEqual(job.status, 'imported', `任务状态应为 imported，实际 ${job.status}`);

  console.log('✅ 自测通过');
  console.log(`   入库文件：${imported}`);
  console.log(`   任务状态：${job.status}`);
}

main().catch((e) => {
  console.error('❌ 自测失败：', e.message);
  process.exit(1);
});
