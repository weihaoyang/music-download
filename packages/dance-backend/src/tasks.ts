import { randomUUID } from 'crypto';

export type DownloadItemState = 'queued' | 'downloading' | 'done' | 'failed';

export interface DownloadTask {
  id: string;
  kind: 'download' | 'classify' | 'cacheClassify';
  type: string | null;
  status: 'running' | 'done';
  total: number;
  done: number;
  failed: number;
  items: Record<string, DownloadItemState>;
  results?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** 类 Celery 的下载任务进度：内存存储 + 计数 */
export class TaskStore {
  private tasks = new Map<string, DownloadTask>();

  create(type: string | null, mids: string[], kind: 'download' | 'classify' | 'cacheClassify' = 'download'): DownloadTask {
    const now = Date.now();
    const task: DownloadTask = {
      id: randomUUID(),
      kind,
      type,
      status: 'running',
      total: mids.length,
      done: 0,
      failed: 0,
      items: {},
      results: kind === 'download' ? undefined : {},
      createdAt: now,
      updatedAt: now,
    };
    for (const m of mids) task.items[m] = 'queued';
    if (mids.length === 0) task.status = 'done';
    this.tasks.set(task.id, task);
    return task;
  }

  setResult(id: string, mid: string, result: unknown): void {
    const t = this.tasks.get(id);
    if (!t) return;
    if (!t.results) t.results = {};
    t.results[mid] = result;
    t.updatedAt = Date.now();
  }

  get(id: string): DownloadTask | undefined {
    return this.tasks.get(id);
  }

  list(): DownloadTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  }

  start(id: string, mid: string): void {
    const t = this.tasks.get(id);
    if (!t) return;
    if (t.items[mid] === 'done' || t.items[mid] === 'failed') return;
    t.items[mid] = 'downloading';
    t.updatedAt = Date.now();
  }

  settle(id: string, mid: string, ok: boolean): void {
    const t = this.tasks.get(id);
    if (!t) return;
    if (t.items[mid] === 'done' || t.items[mid] === 'failed') return;
    t.items[mid] = ok ? 'done' : 'failed';
    if (ok) t.done += 1;
    else t.failed += 1;
    t.updatedAt = Date.now();
    if (t.done + t.failed >= t.total) t.status = 'done';
  }
}
