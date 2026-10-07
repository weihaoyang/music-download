import { randomUUID } from 'crypto';
import type { LibrarySong, LibraryStore } from './library';
import { readJson, writeJson } from './store';

export interface SetlistSong {
  mid: string;
  name: string;
  artists: string[];
  type: string;
  durationMs: number;
  file?: string | null;
  /** 裁剪后的播放时长（毫秒）；为空表示播完整首 */
  playMs?: number | null;
}

/** 舞会信息（用于长图与传递文件） */
export interface EventMeta {
  name?: string;
  time?: string;
  location?: string;
  host?: string;
  note?: string;
}

export interface Setlist {
  id: string;
  name: string;
  createdAt: number;
  targetMin?: number;
  totalMs: number;
  event?: EventMeta;
  songs: SetlistSong[];
}

export type GenerateMode = 'weighted' | 'sequential';

/** 默认排曲类型顺序（集体舞开场，快慢交替，避免同速扎堆） */
export const DEFAULT_DANCE_ORDER = ['集体舞', '慢四', '吉特巴', '慢三', '平四', '并四', '伦巴', '快三'];

export interface GenerateParams {
  durationMin: number;
  weights: Record<string, number>;
  mode?: GenerateMode;
  fill?: boolean;
  /** 自定义排曲类型顺序（优先满足）；缺省用 DEFAULT_DANCE_ORDER */
  order?: string[];
}

function toSetlistSong(s: LibrarySong): SetlistSong {
  return { mid: s.mid, name: s.name, artists: s.artists, type: s.type, durationMs: s.durationMs || 0, file: s.file ?? null, playMs: null };
}

/** 一首在排曲里的有效时长（考虑裁剪） */
export function effectiveMs(s: SetlistSong): number {
  return s.playMs && s.playMs > 0 ? s.playMs : s.durationMs || 0;
}

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 排曲：按各舞种权重分配时长，从曲库取歌并在舞种间轮转交错。
 * - weighted：先打乱再取；sequential：按曲库顺序取。
 * - fill：总时长不足时继续从各舞种补充。
 */
export function generateSetlist(library: LibraryStore, params: GenerateParams): SetlistSong[] {
  const targetMs = Math.max(1, Number(params.durationMin) || 0) * 60000;
  const mode: GenerateMode = params.mode === 'sequential' ? 'sequential' : 'weighted';
  const weights = params.weights || {};
  const types = Object.keys(weights).filter((t) => (weights[t] ?? 0) > 0 && library.list(t).length > 0);
  if (!types.length) return [];

  const totalW = types.reduce((s, t) => s + (weights[t] ?? 0), 0);
  const queues = new Map<string, LibrarySong[]>();
  const quotas = new Map<string, number>();
  for (const t of types) {
    const all = library.list(t);
    queues.set(t, mode === 'weighted' ? shuffled(all) : all.slice());
    quotas.set(t, (targetMs * (weights[t] ?? 0)) / totalW);
  }

  const picked = new Map<string, LibrarySong[]>();
  for (const t of types) picked.set(t, []);
  const usedMs = new Map<string, number>();
  for (const t of types) usedMs.set(t, 0);

  // 第一轮：每舞种取到配额
  for (const t of types) {
    const q = queues.get(t) as LibrarySong[];
    const arr = picked.get(t) as LibrarySong[];
    const quota = quotas.get(t) as number;
    while (q.length && usedMs.get(t)! < quota) {
      const s = q.shift() as LibrarySong;
      arr.push(s);
      usedMs.set(t, usedMs.get(t)! + (s.durationMs || 0));
    }
  }
  // fill：不足目标总时长则继续补充
  if (params.fill !== false) {
    let total = [...usedMs.values()].reduce((a, b) => a + b, 0);
    const order = types.slice().sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
    let progressed = true;
    while (total < targetMs && progressed) {
      progressed = false;
      for (const t of order) {
        const q = queues.get(t) as LibrarySong[];
        if (!q.length) continue;
        const s = q.shift() as LibrarySong;
        (picked.get(t) as LibrarySong[]).push(s);
        usedMs.set(t, usedMs.get(t)! + (s.durationMs || 0));
        total += s.durationMs || 0;
        progressed = true;
        if (total >= targetMs) break;
      }
    }
  }

  // 排列：严格按「类型顺序」循环出队（优先满足规则；未知类型排在最后）
  const orderList = params.order && params.order.length ? params.order : DEFAULT_DANCE_ORDER;
  const seq = [...orderList.filter((t) => picked.has(t)), ...types.filter((t) => !orderList.includes(t))];
  const cursors = new Map<string, number>();
  for (const t of seq) cursors.set(t, 0);
  const out: SetlistSong[] = [];
  let any = true;
  while (any) {
    any = false;
    for (const t of seq) {
      const arr = picked.get(t) as LibrarySong[] | undefined;
      if (!arr) continue;
      const i = cursors.get(t) as number;
      if (i < arr.length) {
        out.push(toSetlistSong(arr[i]));
        cursors.set(t, i + 1);
        any = true;
      }
    }
  }
  return out;
}

/** 排曲结果存储（可保存/读取） */
export class SetlistStore {
  private data: Record<string, Setlist> = {};

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    this.data = await readJson<Record<string, Setlist>>(this.file, {});
  }

  private save(): Promise<void> {
    return writeJson(this.file, this.data);
  }

  list(): Array<Omit<Setlist, 'songs'> & { count: number }> {
    return Object.values(this.data)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt, targetMin: s.targetMin, totalMs: s.totalMs, count: s.songs.length }));
  }

  get(id: string): Setlist | undefined {
    return this.data[id];
  }

  async save_list(name: string, songs: SetlistSong[], targetMin?: number, event?: EventMeta): Promise<Setlist> {
    const setlist: Setlist = {
      id: randomUUID(),
      name: name || '未命名排曲',
      createdAt: Date.now(),
      targetMin,
      totalMs: songs.reduce((s, x) => s + effectiveMs(x), 0),
      event,
      songs,
    };
    this.data[setlist.id] = setlist;
    await this.save();
    return setlist;
  }

  async remove(id: string): Promise<void> {
    delete this.data[id];
    await this.save();
  }
}
