import type { Song } from '../types';
import { QQMusicError } from '../errors';
import type { HttpClient } from '../transport';
import { coverUrl, inferQualities, num, str } from './helpers';

export interface RawSearchItem {
  songid?: number | string;
  songmid?: string;
  songname?: string;
  singer?: Array<{ name?: string }>;
  albumid?: number | string;
  albummid?: string;
  albumname?: string;
  interval?: number;
  size128?: number;
  size320?: number;
  sizeape?: number;
  sizeflac?: number;
  pay?: Record<string, number>;
}

export function normalizeSearchItem(s: RawSearchItem, includeRaw: boolean): Song {
  const albumMid = s.albummid;
  const pay = s.pay ?? {};
  const playable = !(num(pay.payplay) === 1);
  return {
    source: 'qqmusic',
    id: str(s.songid),
    mid: str(s.songmid),
    mediaMid: '',
    name: str(s.songname),
    artists: (s.singer ?? []).map((x) => x.name).filter((x): x is string => Boolean(x)),
    album: albumMid ? { id: str(s.albumid), mid: albumMid, name: str(s.albumname) } : null,
    durationMs: num(s.interval) * 1000,
    coverUrl: coverUrl(albumMid),
    pay: { playable, downloadable: !(num(pay.paydownload) === 1), priceTrack: pay.paytrackprice ?? null },
    qualities: inferQualities({ s128: s.size128, s320: s.size320, flac: s.sizeflac, ape: s.sizeape }),
    ...(includeRaw ? { raw: s } : {}),
  };
}

/**
 * 自研搜索：走 search_for_qq_cp（qq-music-api 的 client_search_cp 已失效且会抛未捕获异常）。
 * 匿名可用，不需要登录态。
 */
export async function searchSongs(
  http: HttpClient,
  keyword: string,
  page: number,
  limit: number,
  includeRaw: boolean,
  signal?: AbortSignal,
): Promise<{ items: Song[]; total: number | null }> {
  if (!keyword) throw new QQMusicError('QQ_CONFIG', 'keyword 不能为空');
  const params = new URLSearchParams({
    format: 'json',
    n: String(limit),
    p: String(page),
    w: keyword,
    cr: '1',
    g_tk: '5381',
    t: '0',
  });
  const url = `http://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?${params.toString()}`;
  const json = await http.getJson<{ code?: number; data?: { song?: { list?: RawSearchItem[]; totalnum?: number } } }>(url, {
    signal,
  });
  const song = json?.data?.song;
  if (!song) {
    throw new QQMusicError('QQ_UPSTREAM', `搜索返回异常：${JSON.stringify(json).slice(0, 200)}`, {
      upstreamCode: json?.code,
    });
  }
  const list = song.list ?? [];
  return {
    items: list.map((x) => normalizeSearchItem(x, includeRaw)),
    total: typeof song.totalnum === 'number' ? song.totalnum : null,
  };
}
