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
  /** 自动把超过 4 分钟的单曲裁剪到 4 分钟（写入 playMs） */
  autoTrim?: boolean;
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
  const res = out;
  // 自动裁剪：超过 4 分钟的单曲裁到 4 分钟（写入 playMs，播到点自动切歌）
  if (params.autoTrim) for (const s of res) if (effectiveMs(s) > 240000) s.playMs = 240000;
  return res;
}

/* ------------------------- 排曲规则检查（HBDC 排曲原则） ------------------------- */

export interface SetlistIssue {
  level: 'warn' | 'info';
  code: string;
  message: string;
  index?: number;
}

const FAST_TYPES = new Set(['平四', '吉特巴', '并四', '快三']);
const SLOW_TYPES = new Set(['慢三', '慢四', '中三', '中四', '伦巴']);

/** 依据《HBDC 排曲原则》检查：快慢相间 / 每 3~4 首集体舞 / 单曲 ≤4 分钟；并给出重复曲目、同类/同歌手过近、开场、目标时长等更细提示 */
export function checkSetlist(songs: SetlistSong[], targetMin?: number): SetlistIssue[] {
  const issues: SetlistIssue[] = [];
  const speed = (t: string): 'fast' | 'slow' | null => (FAST_TYPES.has(t) ? 'fast' : SLOW_TYPES.has(t) ? 'slow' : null);
  const label = (i: number): string => `第 ${i + 1} 首《${songs[i]?.name ?? ''}》`;

  // 快慢相间：连续 3 首同速
  let run = 1;
  for (let i = 1; i < songs.length; i++) {
    const a = speed(songs[i - 1].type);
    const b = speed(songs[i].type);
    if (a && b && a === b) run++;
    else run = 1;
    if (run >= 3) issues.push({ level: 'warn', code: 'SPEED_RUN', message: `第 ${i - 1}~${i + 1} 首连续 ${run} 首同速（快慢未相间）`, index: i });
  }

  // 集体舞间隔：一般每 3~4 首一首
  const groups = songs.map((s, i) => (s.type === '集体舞' ? i : -1)).filter((i) => i >= 0);
  if (!groups.length && songs.length >= 6) {
    issues.push({ level: 'warn', code: 'NO_GROUP', message: '整场没有集体舞（建议每 3~4 首安排一首集体舞）' });
  } else {
    let prev = -1;
    for (const i of groups) {
      if (prev >= 0 && i - prev > 5) issues.push({ level: 'warn', code: 'GROUP_GAP', message: `第 ${prev + 1} 首到第 ${i + 1} 首之间隔了 ${i - prev - 1} 首无集体舞`, index: i });
      prev = i;
    }
  }

  // 单曲时长：尽量 ≤4 分钟
  songs.forEach((s, i) => {
    const ms = effectiveMs(s);
    if (ms > 240000) issues.push({ level: 'info', code: 'LONG', message: `${label(i)}时长 ${Math.round(ms / 1000)}s（建议 ≤4 分钟）`, index: i });
  });

  // 重复曲目（同一首出现多次）
  const seen = new Map<string, number>();
  songs.forEach((s, i) => {
    const prev = seen.get(s.mid);
    if (prev != null) issues.push({ level: 'warn', code: 'DUPLICATE', message: `${label(i)}与第 ${prev + 1} 首重复`, index: i });
    else seen.set(s.mid, i);
  });

  // 连续同类型（两首相邻）
  for (let i = 1; i < songs.length; i++) {
    if (songs[i].type && songs[i].type === songs[i - 1].type && songs[i].type !== '集体舞') {
      issues.push({ level: 'info', code: 'CONSEC_SAME', message: `${label(i)}与上一首同为「${songs[i].type}」`, index: i });
    }
  }

  // 同类型过于接近（3 首内重复、非相邻）
  for (let i = 1; i < songs.length; i++) {
    if (!songs[i].type || songs[i].type === '集体舞') continue;
    for (let j = Math.max(0, i - 3); j < i - 1; j++) {
      if (songs[j].type === songs[i].type) {
        issues.push({ level: 'info', code: 'TYPE_REPEAT', message: `${label(i)}与第 ${j + 1} 首同为「${songs[i].type}」（间隔较近）`, index: i });
        break;
      }
    }
  }

  // 同歌手过于接近（3 首内）
  for (let i = 1; i < songs.length; i++) {
    const mine = new Set(songs[i].artists || []);
    if (!mine.size) continue;
    for (let j = Math.max(0, i - 3); j < i; j++) {
      const shared = (songs[j].artists || []).find((a) => mine.has(a));
      if (shared) {
        issues.push({ level: 'info', code: 'ARTIST_REPEAT', message: `${label(i)}与第 ${j + 1} 首同为「${shared}」`, index: i });
        break;
      }
    }
  }

  // 开场：建议集体舞
  if (songs.length >= 4 && songs[0].type && songs[0].type !== '集体舞') {
    issues.push({ level: 'info', code: 'NO_OPEN', message: '未以集体舞开场（规则建议集体舞开场）', index: 0 });
  }

  // 目标时长（可选）：偏差较大时提示
  if (targetMin && targetMin > 0) {
    const totalMin = songs.reduce((a, s) => a + effectiveMs(s), 0) / 60000;
    const diff = Math.abs(totalMin - targetMin);
    if (diff > Math.max(2, targetMin * 0.1)) {
      issues.push({ level: 'info', code: 'DURATION', message: `总时长 ${totalMin.toFixed(0)} 分，与目标 ${targetMin} 分相差 ${diff.toFixed(0)} 分` });
    }
  }

  return issues;
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
