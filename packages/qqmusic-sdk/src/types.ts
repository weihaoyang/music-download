/**
 * 公开数据模型与契约类型。
 * 这些类型是 SDK 的「对外契约」：上游 QQ 的原始字段一律不暴露（除非 includeRaw）。
 */

/** 音质枚举（映射到 QQ 文件前缀 M500/M800/F000/A000/C400） */
export type Quality = 'm4a' | '128' | '320' | 'flac' | 'ape';

/** 归一化后的歌曲 */
export interface Song {
  source: 'qqmusic';
  /** songid */
  id: string;
  /** songmid */
  mid: string;
  /** 付费歌曲用于拼直链文件名的 media_mid（搜索阶段可能为空，取直链时自动补齐） */
  mediaMid: string;
  name: string;
  artists: string[];
  album: { id: string; mid: string; name: string } | null;
  durationMs: number;
  coverUrl: string | null;
  pay: { playable: boolean; downloadable: boolean; priceTrack: number | null };
  /** 可用音质（由各 size_* 字段推断） */
  qualities: Quality[];
  /** 仅当 config.includeRaw=true 时附带 */
  raw?: unknown;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number | null;
  hasMore: boolean;
}

export interface PlaylistBrief {
  source: 'qqmusic';
  id: string;
  name: string;
  coverUrl: string | null;
  songCount: number;
  creator?: string;
}

export interface PlaylistDetail extends PlaylistBrief {
  songs: Song[];
  songsTruncated: boolean;
}

export interface SongUrl {
  songmid: string;
  quality: Quality;
  url: string;
  expiresAt: number | null;
}

export interface LyricResult {
  /** LRC 原文 */
  lyric: string;
  /** LRC 翻译（若有） */
  trans: string | null;
}

export interface Profile {
  source: 'qqmusic';
  uin: string;
  nickname: string | null;
  avatarUrl: string | null;
  vip: boolean;
}

/* ----------------------------- 鉴权 / Token ----------------------------- */

export type AuthState = 'unauthenticated' | 'valid' | 'expiring' | 'expired';

export interface AuthStatus {
  state: AuthState;
  uin: string | null;
  /** 脱敏后的 key，仅用于展示，绝不返回完整 key */
  keyMasked: string | null;
  lastRefreshedAt: number | null;
  nextRefreshAt: number | null;
}

export interface HealthResult {
  ok: boolean;
  state: AuthState;
  checkedAt: number;
  latencyMs: number;
  detail?: string;
}

export interface Cookie {
  uin: string;
  qqmusic_key?: string;
  qm_keyst?: string;
  [k: string]: string | undefined;
}

/** 由调用方实现（文件 / 数据库） */
export interface TokenStore {
  load(): Promise<Cookie | null>;
  save(cookie: Cookie): Promise<void>;
  clear(): Promise<void>;
}

/** 可选：种子来源（如常驻 PC 客户端的 Frida 镜像） */
export interface CookieProvider {
  getCookie(): Promise<Cookie | null>;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/* ------------------------------- 入参类型 ------------------------------- */

export interface SearchParams {
  keyword: string;
  page?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface SongDetailParams {
  songmid: string;
  signal?: AbortSignal;
}

export interface SongUrlParams {
  songmid: string;
  mediaId?: string;
  quality?: Quality;
  /** 取不到目标音质时逐级降级（320→128），默认 true */
  preferFallback?: boolean;
  signal?: AbortSignal;
}

export interface DownloadParams extends SongUrlParams {
  destPath: string;
}

export interface PlaylistDetailParams {
  disstid: string;
  page?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface PlaylistResolveParams {
  /** 歌单 ID / 完整链接 / 分享短链 */
  input: string;
  signal?: AbortSignal;
}

export interface PlaylistImportParams {
  url?: string;
  disstid?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface PlaylistCloneParams {
  url?: string;
  disstid?: string;
  /** 目标歌单名（未给 dirid 时用于新建） */
  name: string;
  /** 给定则加入该歌单，否则新建 */
  dirid?: string | number;
  limit?: number;
  signal?: AbortSignal;
}

/** 快速联想 / smartbox 的条目 */
export interface QuickItem {
  id: string;
  mid: string;
  name: string;
  subtitle: string | null;
  coverUrl: string | null;
}

export interface QuickResult {
  songs: QuickItem[];
  albums: QuickItem[];
  playlists: QuickItem[];
  mvs: QuickItem[];
}

export interface AddSongsResult {
  dirid: string;
  added: number;
  failed: number;
}

export interface AddSongsParams {
  dirid: string | number;
  songmids: string[];
  /** 已知数字 songId 时可直接传，省去 mid->id 解析 */
  songIds?: Array<string | number>;
  signal?: AbortSignal;
}

export interface CreatePlaylistParams {
  name: string;
  songmids?: string[];
  signal?: AbortSignal;
}

export interface DeletePlaylistParams {
  dirid: string | number;
  signal?: AbortSignal;
}

/* ------------------------------- 配置类型 ------------------------------- */

export interface RefreshConfig {
  /** 自动续期间隔，默认 30 天 */
  intervalMs: number;
  /** 进入 expiring 的提前量，默认 7 天 */
  expiringThresholdMs: number;
  /** 收到鉴权错误时自动刷新并重试一次，默认 true */
  onAuthErrorRefresh: boolean;
  /** 刷新失败最大尝试次数，默认 3 */
  maxAttempts: number;
}

export interface HttpConfig {
  timeoutMs: number;
  retries: number;
  throttleMs: number;
  headers: Record<string, string>;
}

export interface QQMusicClientConfig {
  tokenStore?: TokenStore;
  seedCookie?: string | Cookie;
  cookieProvider?: CookieProvider;
  refresh?: Partial<RefreshConfig>;
  http?: Partial<HttpConfig>;
  includeRaw?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: Logger;
  onTokenRefreshed?: (status: AuthStatus) => void;
  onTokenExpired?: (error: unknown) => void;
}

export interface ResolvedConfig {
  tokenStore?: TokenStore;
  seedCookie?: Cookie;
  cookieProvider?: CookieProvider;
  refresh: RefreshConfig;
  http: HttpConfig;
  includeRaw: boolean;
  fetchImpl: typeof fetch;
  now: () => number;
  logger: Logger;
  onTokenRefreshed?: (status: AuthStatus) => void;
  onTokenExpired?: (error: unknown) => void;
}
