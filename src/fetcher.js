'use strict';

const path = require('path');
const log = require('./log');
const qq = require('./qqmusic');
const { importFile } = require('./importer');
const { sanitize, ensureDir, guessExt } = require('./util');

/**
 * 发起一次补歌任务。
 * input: { mid?, mediaId?, title?, artist?, keyword?, index?, type?, engine? }
 * 返回 job（异步执行，进度通过 /jobs/:id 查询）。
 */
async function fetchSong(cfg, jobs, input) {
  const engine = input.engine || cfg.engine.default;
  let song = { mid: input.mid, mediaId: input.mediaId, title: input.title, artist: input.artist };

  if (!song.mid) {
    if (!input.keyword) throw new Error('需要提供 mid 或 keyword');
    const list = await qq.search(input.keyword, { limit: 5 });
    if (!list.length) throw new Error(`搜索无结果：${input.keyword}`);
    const pick = typeof input.index === 'number' ? list[input.index] : list[0];
    song = pick || list[0];
  }

  const job = jobs.create({ source: 'api', engine, status: 'queued', ...song });
  runJob(cfg, jobs, job, { type: input.type }).catch((e) => {
    log.error(`任务 ${job.id} 失败：`, e.message);
    jobs.update(job.id, { status: 'failed', error: e.message });
  });
  return job;
}

async function runJob(cfg, jobs, job, { type } = {}) {
  // 引擎 A：加进「补歌队列」歌单，触发客户端自动下载；后续交给 watcher 解密入库
  if (job.engine === 'client') {
    if (!cfg.engine.playlistDirId) {
      throw new Error('engine=client 需要在 config 里配置 engine.playlistDirId（补歌队列歌单的 dirid）');
    }
    jobs.update(job.id, { status: 'queueing' });
    const r = await qq.addToPlaylist(cfg, [job.mid], cfg.engine.playlistDirId);
    const ret = r && (r.result !== undefined ? r.result : r.code);
    if (ret !== undefined && ret !== 100 && ret !== 0) {
      throw new Error(`加歌失败：${r.errMsg || JSON.stringify(r)}`);
    }
    jobs.update(job.id, { status: 'queued', note: '已加入补歌队列，等待客户端下载，随后由 watcher 接管' });
    return;
  }

  // 引擎 B：Web 直链下载（不依赖客户端 / TuneFree）
  jobs.update(job.id, { status: 'downloading' });
  const url = await qq.getSongUrl(cfg, { mid: job.mid, mediaId: job.mediaId, type: type || '320' });
  const ext = guessExt(url);
  const incoming = path.join(cfg.paths.workDir, 'incoming', `${sanitize(job.title || job.mid)}${ext}`);
  await ensureDir(path.dirname(incoming));
  await qq.download(url, incoming);
  jobs.update(job.id, { status: 'importing' });
  const dest = await importFile(cfg, incoming, { title: job.title, artist: job.artist });
  jobs.update(job.id, { status: 'imported', path: dest });
  log.info(`入库成功：${dest}`);
  return dest;
}

module.exports = { fetchSong, runJob };
