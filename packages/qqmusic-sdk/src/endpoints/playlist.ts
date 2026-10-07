import type { PlaylistBrief, PlaylistDetail, Song } from '../types';
import { QQMusicError } from '../errors';
import type { Cgi, HttpClient } from '../transport';
import { coverUrl, inferQualities, num, str } from './helpers';

export interface RawPlaylistSearchItem {
  dissid?: string | number;
  dissname?: string;
  imgurl?: string;
  songnum?: number;
  song_count?: number;
  creator?: { name?: string };
}

export function normalizePlaylistBrief(x: RawPlaylistSearchItem): PlaylistBrief {
  return {
    source: 'qqmusic',
    id: str(x.dissid),
    name: str(x.dissname),
    coverUrl: x.imgurl ? String(x.imgurl) : null,
    songCount: num(x.songnum ?? x.song_count),
    ...(x.creator?.name ? { creator: String(x.creator.name) } : {}),
  };
}

/** 歌单搜索：必须 remoteplace=txt.yqq.playlist 且 page_no 从 0 开始（实测） */
export async function searchPlaylists(
  cgi: Cgi,
  keyword: string,
  page: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ items: PlaylistBrief[]; total: number | null }> {
  if (!keyword) throw new QQMusicError('QQ_CONFIG', 'keyword 不能为空');
  const url = 'https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist';
  const j = await cgi.call<{ code?: number; data?: { list?: RawPlaylistSearchItem[]; display_num?: number } }>(url, {
    query: { remoteplace: 'txt.yqq.playlist', page_no: Math.max(0, page - 1), num_per_page: limit, query: keyword, format: 'json' },
    auth: 'none',
    signal,
  });
  if (!j || j.code !== 0 || !j.data) {
    throw new QQMusicError('QQ_UPSTREAM', `歌单搜索失败：${JSON.stringify(j).slice(0, 150)}`, { upstreamCode: j?.code });
  }
  const list = j.data.list ?? [];
  return { items: list.map(normalizePlaylistBrief), total: typeof j.data.display_num === 'number' ? j.data.display_num : null };
}

/** 歌单里的歌曲，兼容新旧两种字段命名 */
export function normalizePlaylistSong(s: Record<string, unknown>, includeRaw: boolean): Song {
  const file = (s.file ?? {}) as Record<string, unknown>;
  const album = (s.album ?? {}) as Record<string, unknown>;
  const albumMid = str(album.mid ?? s.albummid);
  const size128 = num(file.size_128mp3) || num(s.size128);
  const size320 = num(file.size_320mp3) || num(s.size320);
  const sizeflac = num(file.size_flac) || num(s.sizeflac);
  const sizeape = num(file.size_ape) || num(s.sizeape);
  return {
    source: 'qqmusic',
    id: str(s.id ?? s.songid),
    mid: str(s.mid ?? s.songmid),
    mediaMid: str(file.media_mid) || str(s.strMediaMid),
    name: str(s.title ?? s.songname ?? s.name),
    artists: ((s.singer as Array<{ name?: string }> | undefined) ?? []).map((x) => x.name).filter((x): x is string => Boolean(x)),
    album: albumMid ? { id: str(album.id ?? s.albumid), mid: albumMid, name: str(album.name ?? s.albumname) } : null,
    durationMs: num(s.interval) * 1000,
    coverUrl: coverUrl(albumMid),
    pay: { playable: true, downloadable: true, priceTrack: null },
    qualities: inferQualities({ s128: size128, s320: size320, flac: sizeflac, ape: sizeape }),
    ...(includeRaw ? { raw: s } : {}),
  };
}

/**
 * 歌单详情。匿名会被 QQ 拒（privacy error），使用登录态走老的 CGI 端点（实测带 cookie 可返回全部歌曲）。
 */
export async function playlistDetail(
  cgi: Cgi,
  disstid: string,
  page: number,
  limit: number,
  includeRaw: boolean,
  signal?: AbortSignal,
): Promise<PlaylistDetail> {
  const url = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';
  const j = await cgi.call<{ code?: number; subcode?: number; msg?: string; cdlist?: Array<Record<string, unknown>> }>(url, {
    query: {
      type: 1,
      json: 1,
      utf8: 1,
      onlysong: 0,
      disstid: String(disstid),
      format: 'json',
      g_tk: 5381,
      loginUin: 0,
      hostUin: 0,
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq',
      needNewCode: 0,
    },
    auth: 'optional',
    headers: { Referer: 'https://y.qq.com/n/yqq/playlist' },
    signal,
  });

  const first = Array.isArray(j?.cdlist) ? j?.cdlist?.[0] : undefined;
  if (!j || j.code !== 0 || !first) {
    if (j && (j.subcode === 4000 || /privacy/i.test(String(j.msg ?? '')))) {
      throw new QQMusicError('QQ_AUTH_REQUIRED', '歌单详情需要登录态或该歌单不可见');
    }
    throw new QQMusicError('QQ_UPSTREAM', `歌单详情失败：${JSON.stringify(j).slice(0, 150)}`, { upstreamCode: j?.code });
  }

  const all = ((first.songlist as Array<Record<string, unknown>> | undefined) ?? []).map((s) =>
    normalizePlaylistSong(s, includeRaw),
  );
  const total = num(first.total_song_num) || all.length;
  const start = (page - 1) * limit;
  const songs = all.slice(start, start + limit);
  return {
    source: 'qqmusic',
    id: str(disstid),
    name: str(first.dissname),
    coverUrl: first.logo ? String(first.logo) : null,
    songCount: total,
    ...(first.nickname ? { creator: String(first.nickname) } : {}),
    songs,
    songsTruncated: start + songs.length < total,
  };
}

/* --------------------------- 我喜欢（dirid=201） --------------------------- */

/**
 * 「我喜欢」歌单（dirid=201）：与普通歌单不同，走 `music.srfDissInfo.DissInfo/CgiGetDiss`，
 * 需登录态；分页用 `song_begin/song_num`。
 */
export async function likedSongs(
  cgi: Cgi,
  cookie: { uin: string; authst: string },
  page: number,
  limit: number,
  includeRaw: boolean,
  signal?: AbortSignal,
): Promise<PlaylistDetail> {
  const pageSize = Math.max(1, Math.min(Math.floor(limit), 1000));
  const data = {
    comm: { uin: cookie.uin, authst: cookie.authst, format: 'json', ct: 24, cv: 0 },
    req_0: {
      module: 'music.srfDissInfo.DissInfo',
      method: 'CgiGetDiss',
      param: { disstid: '', dirid: 201, tag: 1, song_begin: (page - 1) * pageSize, song_num: pageSize, userinfo: 1, orderlist: 1, onlysonglist: 0 },
    },
  };
  const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  const j = await cgi.call<{ req_0?: { code?: number; data?: { dirinfo?: Record<string, unknown>; songlist?: Array<Record<string, unknown>> } } }>(url, {
    query: { format: 'json', data: JSON.stringify(data) },
    auth: 'required',
    signal,
  });
  const r0 = j?.req_0;
  const d = r0?.data;
  if (r0?.code !== 0 || !d) {
    throw new QQMusicError('QQ_UPSTREAM', `获取「我喜欢」失败：${JSON.stringify(j).slice(0, 150)}`, { upstreamCode: r0?.code });
  }
  const all = (d.songlist ?? []).map((s) => normalizePlaylistSong(s, includeRaw));
  const dirinfo = d.dirinfo ?? {};
  const total = num(dirinfo.songnum) || all.length;
  return {
    source: 'qqmusic',
    id: '201',
    name: str(dirinfo.dissname) || '我喜欢',
    coverUrl: dirinfo.diss_cover ? String(dirinfo.diss_cover) : null,
    songCount: total,
    songs: all,
    songsTruncated: (page - 1) * pageSize + all.length < total,
  };
}

/* --------------------------- 外部歌单：分享链接解析 --------------------------- */

/**
 * 从「歌单 ID / 完整链接 / 分享短链」里解析出 disstid。
 * 短链（返回 null 的）需要再走 resolvePlaylistInput 跟随跳转。
 */
export function extractDissId(input: string): string | null {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^\d{5,}$/.test(s)) return s;
  const patterns = [
    /[?&]disstid=(\d+)/,
    /[?&]id=(\d+)/,
    /\/playlist\/(\d+)/,
    /\/taoge\/[^/]*?_(\d+)/,
    /\/(\d{6,})(?:[?#]|$)/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

/** 解析任意输入（ID / 链接 / 短链）为 disstid */
export async function resolvePlaylistInput(http: HttpClient, input: string, signal?: AbortSignal): Promise<string> {
  const s = String(input || '').trim();
  if (!s) throw new QQMusicError('QQ_CONFIG', '歌单链接/ID 不能为空');

  const direct = extractDissId(s);
  if (direct) return direct;

  // 短链：跟随跳转，从最终 URL 或页面文本里找 id
  if (/^https?:/i.test(s)) {
    const { finalUrl, text } = await http.probe(s, { signal });
    const id =
      extractDissId(finalUrl) ||
      extractDissId(text) ||
      (text.match(/"disstid"\s*:\s*"?(\d+)/) || [])[1] ||
      (text.match(/["']?dissid["']?\s*[:=]\s*["']?(\d{5,})/) || [])[1];
    if (id) return id;
  }

  throw new QQMusicError('QQ_NOT_FOUND', `无法从「${s}」解析出歌单 ID`);
}
