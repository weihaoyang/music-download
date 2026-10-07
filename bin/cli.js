'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { loadConfig, ROOT } = require('../src/config');
const log = require('../src/log');
const qq = require('../src/qqmusic');
const { JobStore } = require('../src/jobs');
const { Watcher } = require('../src/watcher');
const { convert } = require('../src/converter');
const { importFile } = require('../src/importer');
const { fetchSong } = require('../src/fetcher');

function usage() {
  console.log(`补歌服务 CLI

用法：
  node bin/cli.js search <关键词>             搜索 QQ 音乐
  node bin/cli.js fetch <关键词|mid> [--mid] [--engine web|client] [--type 320]
                                              发起补歌任务（非 --mid 时按关键词搜索取第一条）
  node bin/cli.js convert <加密文件>          手动把一个 .mflac/.mgg 解密并入库
  node bin/cli.js watch                       只启动目录监听（不启 HTTP 服务）
  node bin/cli.js jobs                        查看最近任务
  node bin/cli.js serve                       启动完整服务（等价 npm start）

环境变量：MF_MUSIC_API / MF_TUNEFREE / MF_DOWNLOAD_DIR / MF_LIBRARY_DIR / MF_MOCK=0
`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') return usage();

  if (cmd === 'search') {
    const kw = rest.join(' ');
    const data = await qq.search(kw, { limit: 10 });
    data.forEach((s, i) => {
      console.log(
        `${String(i).padStart(2)}. [${s.mid}] ${s.title} - ${s.artist}${s.pay ? ' (付费)' : ''} 专辑:${s.album}`,
      );
    });
    return;
  }

  if (cmd === 'fetch') {
    const midIdx = rest.indexOf('--mid');
    const forceMid = midIdx >= 0;
    if (forceMid) rest.splice(midIdx, 1);
    const engineIdx = rest.indexOf('--engine');
    let engine;
    if (engineIdx >= 0) {
      engine = rest[engineIdx + 1];
      rest.splice(engineIdx, 2);
    }
    const typeIdx = rest.indexOf('--type');
    let type;
    if (typeIdx >= 0) {
      type = rest[typeIdx + 1];
      rest.splice(typeIdx, 2);
    }
    const value = rest.join(' ').trim();
    if (!value) throw new Error('缺少关键词或 mid');

    await fsp.mkdir(cfg.paths.workDir, { recursive: true });
    const jobs = new JobStore(cfg);
    await jobs.load();
    const input = forceMid ? { mid: value, engine, type } : { keyword: value, engine, type };
    const job = await fetchSong(cfg, jobs, input);
    console.log(`已创建任务 ${job.id}（engine=${job.engine}）`);
    // 等待异步任务跑一段，方便命令行看结果（client 引擎只到 queued）
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const j = jobs.get(job.id);
      if (!j || ['imported', 'failed'].includes(j.status)) {
        console.log(JSON.stringify(j, null, 2));
        break;
      }
      if (j.status === 'queued') {
        console.log(JSON.stringify(j, null, 2));
        break;
      }
    }
    await jobs.save();
    return;
  }

  if (cmd === 'convert') {
    const file = path.resolve(rest[0] || '');
    if (!file) throw new Error('缺少加密文件路径');
    await fsp.mkdir(cfg.paths.workDir, { recursive: true });
    const mp3 = await convert(cfg, file, {});
    console.log(`解密输出：${mp3}`);
    const dest = await importFile(cfg, mp3, {});
    console.log(`已入库：${dest}`);
    return;
  }

  if (cmd === 'watch') {
    await fsp.mkdir(cfg.paths.workDir, { recursive: true });
    const jobs = new JobStore(cfg);
    await jobs.load();
    const watcher = new Watcher(cfg, jobs);
    watcher.start();
    console.log('监听中，Ctrl+C 退出');
    return;
  }

  if (cmd === 'jobs') {
    const jobs = new JobStore(cfg);
    await jobs.load();
    jobs.list(30).forEach((j) => console.log(`${j.id} [${j.status}] ${j.title || ''} ${j.path || j.error || ''}`));
    return;
  }

  if (cmd === 'serve') {
    process.argv = [process.argv[0], path.join(ROOT, 'src', 'index.js')];
    return require('../src/index.js');
  }

  usage();
}

main().catch((e) => {
  log.error(e.message || e);
  process.exit(1);
});
