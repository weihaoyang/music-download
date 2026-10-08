/**
 * 网易云音乐（NetEase Cloud Music）来源适配器。
 * 使用免加密的 `/api/*` 端点：匿名可用 搜索 / 详情 / 歌单 / 歌词；
 * 播放直链（`/api/song/enhance/player/url`）需要登录 Cookie（MUSIC_U），否则返回 null。
 *
 * 见 docs/library-source-architecture.md（TrackSource 适配器之一）。
 */

let neteaseCookie = '';

/** 设置网易云登录 Cookie（MUSIC_U=...）。空串=匿名。 */
export function setNeteaseCookie(cookie: string): void {
  neteaseCookie = String(cookie || '').trim();
}
export function hasNeteaseCookie(): boolean {
  return /MUSIC_U=/.test(neteaseCookie);
}

const BASE = 'https://music.163.com';
function headers(): Record<string, string> {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Referer: 'https://music.163.com',
    Origin: 'https://music.163.com',
    Cookie: neteaseCookie ? `os=pc; appver=2.9.7; ${neteaseCookie}` : 'os=pc; appver=2.9.7',
  };
}

async function getJson(path: string, signal?: AbortSignal): Promise<any> {
  const r = await fetch(BASE + path, { headers: headers(), signal });
  if (!r.ok) throw new Error(`netease HTTP ${r.status}`);
  return r.json();
}
async function postForm(path: string, data: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const h = headers();
  h['Content-Type'] = 'application/x-www-form-urlencoded';
  const r = await fetch(BASE + path, { method: 'POST', headers: h, body: new URLSearchParams(data).toString(), signal });
  if (!r.ok) throw new Error(`netease HTTP ${r.status}`);
  return r.json();
}

export interface NeSong {
  id: string;
  name: string;
  artists: string[];
  album: string | null;
  durationMs: number;
  coverUrl: string | null;
  /** 付费标记：0 免费 / 1 VIP / 4 购买专辑 / 8 低音质免费 */
  fee: number | null;
}

function pickCover(al: any): string | null {
  if (!al) return null;
  const p = al.picUrl || al.pic_str || al.pic || null;
  return p ? String(p) : null;
}

export function normalizeNeSong(s: any): NeSong {
  const artists = (s.ar || s.artists || []).map((x: any) => (x && x.name) || '').filter(Boolean);
  const al = s.al || s.album || null;
  return {
    id: String(s.id),
    name: String(s.name ?? ''),
    artists,
    album: al ? String(al.name ?? '') : null,
    durationMs: Number(s.dt ?? s.duration ?? 0),
    coverUrl: pickCover(al),
    fee: s.fee == null ? null : Number(s.fee),
  };
}

/** 搜索歌曲 */
export async function searchSongs(keyword: string, limit = 20, offset = 0, signal?: AbortSignal): Promise<NeSong[]> {
  const j = await postForm('/api/cloudsearch/pc', { s: keyword, type: '1', offset: String(offset), limit: String(limit), total: 'true' }, signal);
  return (j?.result?.songs || []).map(normalizeNeSong);
}

/** 搜索歌单 */
export async function searchPlaylists(
  keyword: string,
  limit = 20,
  offset = 0,
  signal?: AbortSignal,
): Promise<Array<{ id: string; name: string; coverUrl: string | null; songCount: number; creator: string | null }>> {
  const j = await postForm('/api/cloudsearch/pc', { s: keyword, type: '1000', offset: String(offset), limit: String(limit), total: 'true' }, signal);
  return (j?.result?.playlists || []).map((p: any) => ({
    id: String(p.id),
    name: String(p.name ?? ''),
    coverUrl: p.coverImgUrl ? String(p.coverImgUrl) : null,
    songCount: Number(p.trackCount ?? 0),
    creator: p.creator ? String(p.creator.nickname ?? '') : null,
  }));
}

/** 歌曲详情 */
export async function songDetail(ids: Array<string | number>, signal?: AbortSignal): Promise<NeSong[]> {
  const j = await getJson(`/api/song/detail/?ids=[${ids.map((x) => JSON.stringify(String(x))).join(',')}]`, signal);
  return (j?.songs || []).map(normalizeNeSong);
}

/** 播放直链（匿名通常为 null；需 MUSIC_U Cookie） */
export async function songUrl(id: string | number, br = 320000, signal?: AbortSignal): Promise<string | null> {
  const j = await getJson(`/api/song/enhance/player/url?ids=[${JSON.stringify(String(id))}]&br=${br}`, signal);
  const d = j?.data?.[0];
  return d && d.url ? String(d.url) : null;
}

/** 歌词（LRC 文本） */
export async function lyric(id: string | number, signal?: AbortSignal): Promise<{ lyric: string; trans: string | null }> {
  const j = await getJson(`/api/song/lyric?id=${encodeURIComponent(String(id))}&lv=-1&kv=-1&tv=-1`, signal);
  return { lyric: String(j?.lrc?.lyric ?? ''), trans: j?.tlyric?.lyric ? String(j.tlyric.lyric) : null };
}

/** 歌单详情（全部曲目） */
export async function playlistDetail(
  id: string | number,
  limit = 1000,
  signal?: AbortSignal,
): Promise<{ id: string; name: string; coverUrl: string | null; songCount: number; creator: string | null; songs: NeSong[] }> {
  const j = await getJson(`/api/v6/playlist/detail?id=${encodeURIComponent(String(id))}&n=${limit}`, signal);
  const pl = j?.playlist || {};
  const all: NeSong[] = (pl.tracks || []).map(normalizeNeSong);
  const songs = limit > 0 ? all.slice(0, limit) : all;
  return {
    id: String(id),
    name: String(pl.name ?? ''),
    coverUrl: pl.coverImgUrl ? String(pl.coverImgUrl) : null,
    songCount: Number(pl.trackCount ?? all.length),
    creator: pl.creator ? String(pl.creator.nickname ?? '') : null,
    songs,
  };
}

/** 从「链接 / 分享文本 / 纯 ID」解析出歌单或歌曲 ID */
export function extractNeId(input: string): { kind: 'playlist' | 'song'; id: string } | null {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^\d{5,}$/.test(s)) return { kind: 'playlist', id: s };
  const song = s.match(/[?&#/]song\/(\d+)/) || s.match(/song\?id=(\d+)/);
  if (song) return { kind: 'song', id: song[1] };
  const pl = s.match(/playlist\/(\d+)/) || s.match(/playlist\?id=(\d+)/) || s.match(/[?&]id=(\d+)/);
  if (pl) return { kind: 'playlist', id: pl[1] };
  return null;
}
