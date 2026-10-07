'use strict';

const fsp = require('fs/promises');
const path = require('path');
const log = require('./log');
const { listFiles, ensureDir, move } = require('./util');
const { convert } = require('./converter');
const { importFile } = require('./importer');

/**
 * 轮询监听 QQ 音乐下载目录，发现「已经下载完成」的加密文件后：
 *   解密(TuneFree) -> 规范化入库 -> 清理源文件。
 *
 * 用轮询而不是 fs.watch：Windows 上更可靠，且能顺便用「文件大小连续多轮不变」判断下载完成。
 */
class Watcher {
  constructor(cfg, jobs) {
    this.cfg = cfg;
    this.jobs = jobs;
    this.states = new Map(); // file -> { size, rounds }
    this.busy = false;
    this.timer = null;
  }

  start() {
    const { enabled, pollIntervalMs } = this.cfg.watcher;
    if (!enabled) {
      log.info('watcher 已禁用');
      return;
    }
    log.info(`监听下载目录：${this.cfg.paths.downloadDir}（每 ${pollIntervalMs}ms）`);
    this.timer = setInterval(() => {
      this.tick().catch((e) => log.error('watcher tick 出错：', e.message));
    }, pollIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 单轮扫描，扫描/处理是串行的，避免 TuneFree（Frida 注入）并发 */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const files = await listFiles(this.cfg.paths.downloadDir, this.cfg.watcher.extensions);
      for (const file of files) {
        let stat;
        try {
          stat = await fsp.stat(file);
        } catch (_) {
          continue;
        }
        const prev = this.states.get(file) || { size: -1, rounds: 0 };
        if (stat.size > 0 && stat.size === prev.size) prev.rounds += 1;
        else prev.rounds = 0;
        prev.size = stat.size;
        this.states.set(file, prev);

        if (prev.rounds >= this.cfg.watcher.stableRounds) {
          this.states.delete(file);
          await this.handle(file);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  async handle(file) {
    const baseName = path.basename(file);
    // 尝试把下载到的文件和一条 client 引擎任务的标题对上
    const matched = this.jobs.findQueuedByTitle(guessTitle(baseName));
    const job =
      matched ||
      this.jobs.create({
        source: 'watch',
        status: 'converting',
        engine: 'client',
        file,
        title: guessTitle(baseName),
      });

    try {
      this.jobs.update(job.id, { status: 'converting', file });
      const mp3 = await convert(this.cfg, file, { jobId: job.id });
      this.jobs.update(job.id, { status: 'importing' });
      const dest = await importFile(this.cfg, mp3, { title: job.title, artist: job.artist });
      this.jobs.update(job.id, { status: 'imported', path: dest });
      log.info(`入库成功：${dest}`);

      if (this.cfg.converter.keepSource) {
        const doneDir = path.join(this.cfg.paths.workDir, 'done');
        await ensureDir(doneDir);
        await move(file, path.join(doneDir, path.basename(file)));
      } else {
        await fsp.rm(file, { force: true });
      }
    } catch (e) {
      log.error(`处理 ${baseName} 失败：`, e.message);
      this.jobs.update(job.id, { status: 'failed', error: e.message });
    }
  }
}

/** 从「歌手 - 歌名.mflac」里尽量还原歌名，用于和任务匹配 */
function guessTitle(baseName) {
  const name = baseName.replace(/\.[^.]+$/, '');
  const parts = name.split(' - ');
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

module.exports = { Watcher };
