'use strict';

/*
 * 默认曲库批量离线构建：
 *   读取 library.config.json（舞种 -> 歌单链接列表），逐个导入 QQ 歌单到曲库，并下载音频到本地。
 *
 * 用法：
 *   node scripts/build-library.js                 # 按 library.config.json 构建并下载
 *   node scripts/build-library.js --no-download   # 只导入元数据
 *   node scripts/build-library.js --type=慢三      # 只构建某个舞种
 *   node scripts/build-library.js --plan=./x.json
 *
 * 前置：packages/qqmusic-sdk 已 build；tools/qqclient-bridge 在跑（会员账号）。
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../dist/config');
const { LibraryStore } = require('../dist/library');
const { MediaCache } = require('@hdbc/dance-sdk');
const { createQQMusicClient, HttpCookieProvider } = require('@hdbc/qqmusic-sdk');

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

(async () => {
  const cfg = loadConfig();
  const root = path.resolve(__dirname, '..');
  const planPath = arg('plan', path.join(root, 'library.config.json'));
  if (!fs.existsSync(planPath)) {
    console.error(`缺少歌单计划文件：${planPath}（可复制 library.config.example.json）`);
    process.exit(1);
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const download = !process.argv.includes('--no-download');
  const onlyType = arg('type', '');

  const lib = new LibraryStore(path.join(cfg.dataDir, 'tracks.json'), path.join(cfg.dataDir, 'library.json'));
  await lib.load();
  const media = new MediaCache(cfg.mediaDir, cfg.mediaQuality, cfg.downloadConcurrency, cfg.logger);
  const client = await createQQMusicClient({ cookieProvider: new HttpCookieProvider(cfg.bridgeUrl), logger: cfg.logger });

  const entries = Array.isArray(plan)
    ? plan
    : Object.entries(plan.types || {}).flatMap(([type, urls]) => urls.map((url) => ({ type, url })));

  for (const e of entries) {
    if (onlyType && e.type !== onlyType) continue;
    console.log(`\n[${e.type}] ${e.url}`);
    try {
      const detail = await client.playlists.importPlaylist({ url: e.url, limit: 5000 });
      const r = await lib.importDetail(e.type, detail);
      console.log(`  导入「${detail.name}」：新增 ${r.added}，跳过 ${r.skipped}`);
      if (download && r.newMids.length) {
        let ok = 0;
        let fail = 0;
        for (const mid of r.newMids) {
          try {
            const file = await media.ensure(client, mid);
            await lib.setFile(mid, file);
            ok += 1;
            process.stdout.write(`  缓存 ${ok + fail}/${r.newMids.length}\r`);
          } catch (err) {
            fail += 1;
            console.warn(`  下载失败 ${mid}: ${err.message}`);
          }
        }
        console.log(`  缓存完成：成功 ${ok}，失败 ${fail}`);
      }
    } catch (err) {
      console.error(`  失败：${err.message}`);
    }
  }

  client.auth.stopAutoRefresh();
  console.log('\n完成。曲库概览：', JSON.stringify(lib.types()));
})();
