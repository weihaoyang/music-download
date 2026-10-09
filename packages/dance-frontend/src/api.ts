export interface ApiEnvelope {
  ok?: boolean;
  error?: string;
  message?: string;
}

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.message || j.error || `HTTP ${r.status}`);
  return j as T;
}

export const post = <T = any,>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/* 管理端口令（localStorage），用于 /api/settings、/api/library/download 等 admin 接口 */
const ADMIN_KEY = 'dance.adminToken';
export function getAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_KEY) || '';
  } catch {
    return '';
  }
}
export function setAdminToken(t: string): void {
  try {
    localStorage.setItem(ADMIN_KEY, t);
  } catch {
    /* ignore */
  }
}
export function adminFetch<T = any>(path: string, method: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (getAdminToken()) headers['x-admin-token'] = getAdminToken();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return api<T>(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

/* 主题（明/暗），持久化到 localStorage；同时切换 Semi 的 theme-mode */
export type ThemeMode = 'light' | 'dark';
const THEME_KEY = 'dance.theme';
export function getTheme(): ThemeMode {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
export function applyTheme(t: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = t;
  if (t === 'dark') document.body.setAttribute('theme-mode', 'dark');
  else document.body.removeAttribute('theme-mode');
}
export function setTheme(t: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore */
  }
  applyTheme(t);
}

/* 播放队列（跨页面/标签共享），供独立全屏播放页 /play 读取 */
export interface QueueItem {
  mid: string;
  name: string;
  artists: string[];
  coverUrl?: string | null;
  /** 裁剪播放时长（毫秒）；空表示整首 */
  playMs?: number | null;
  /** 舞种 */
  type?: string;
  /** 原始时长（毫秒） */
  durationMs?: number;
  /** 整体响度 LUFS（用于播放增益/响度归一化） */
  loudness?: number | null;
}
const QUEUE_KEY = 'dance.queue';
export function setQueue(items: QueueItem[], index = 0): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify({ items, index, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}
export function getQueue(): { items: QueueItem[]; index: number } | null {
  try {
    const s = localStorage.getItem(QUEUE_KEY);
    return s ? (JSON.parse(s) as { items: QueueItem[]; index: number }) : null;
  } catch {
    return null;
  }
}

export interface LibrarySong {
  mid: string;
  name: string;
  artists: string[];
  album: string | null;
  durationMs: number;
  coverUrl: string | null;
  type: string;
  file?: string | null;
  bpm?: number | null;
  meter?: string | null;
  confidence?: number | null;
  energy?: number | null;
  mood?: string | null;
  stability?: number | null;
  suitable?: boolean | null;
  warning?: string | null;
  /** 来源：qqmusic / netease / local / http / pan */
  source?: string | null;
  /** schema v2：归属与溯源 */
  provenance?: { rights: 'external' | 'club'; edited: boolean; origin?: unknown; note?: string | null } | null;
}

export interface Song {
  mid: string;
  name: string;
  artists: string[];
  album: { name: string } | null;
  durationMs: number;
  coverUrl: string | null;
}

export interface TaskItem {
  id: string;
  kind: 'download' | 'classify' | 'cacheClassify';
  type: string | null;
  status: 'running' | 'done';
  total: number;
  done: number;
  failed: number;
}
