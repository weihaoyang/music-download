'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const log = require('./log');

let counter = 0;
function newId() {
  counter += 1;
  return `job_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 极简任务存储：内存 + 落盘（.work/jobs.json），用于给排曲系统查询进度。
 * 状态机：queued -> queueing/downloading -> converting -> importing -> imported | failed
 */
class JobStore {
  constructor(cfg) {
    this.file = path.join(cfg.paths.workDir, 'jobs.json');
    this.jobs = new Map();
    this._saveTimer = null;
  }

  async load() {
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      for (const job of raw) this.jobs.set(job.id, job);
      log.debug(`已加载 ${this.jobs.size} 个历史任务`);
    } catch (e) {
      if (e.code !== 'ENOENT') log.warn('读取 jobs.json 失败：', e.message);
    }
  }

  create(data) {
    const now = Date.now();
    const job = { id: newId(), status: 'queued', createdAt: now, updatedAt: now, ...data };
    this.jobs.set(job.id, job);
    this.saveSoon();
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  list(limit = 50) {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  update(id, patch) {
    const job = this.jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: Date.now() });
    this.saveSoon();
    return job;
  }

  /** 找到一条「已入队、等待客户端下载」的任务，用于和下载到的加密文件做匹配 */
  findQueuedByTitle(title) {
    if (!title) return null;
    const q = String(title).toLowerCase().replace(/\s+/g, '');
    return (
      [...this.jobs.values()].find(
        (j) => j.engine === 'client' && j.status === 'queued' && j.title && String(j.title).toLowerCase().replace(/\s+/g, '') === q,
      ) || null
    );
  }

  saveSoon() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.save().catch((e) => log.warn('写入 jobs.json 失败：', e.message));
    }, 200);
  }

  async save() {
    const data = JSON.stringify(this.list(1000), null, 2);
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(this.file, data, 'utf8');
  }
}

module.exports = { JobStore };
