import type { Quality, Song } from '../types';
import { QQMusicError } from '../errors';
import type { Cgi } from '../transport';
import { coverUrl, inferQualities, num, str } from './helpers';

const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

/** 音质 -> vkey 文件名前缀/后缀 */
export const QUALITY_FILE: Record<Quality, { s: string; e: string }> = {
  m4a: { s: 'C400', e: '.m4a' },
  '128': { s: 'M500', e: '.mp3' },
  '320': { s: 'M800', e: '.mp3' },
  ape: { s: 'A000', e: '.ape' },
  flac: { s: 'F000', e: '.flac' },
};

/** 拼 vkey 请求的文件名：前缀 + songmid + media_mid + 后缀 */
export function buildVkeyFile(songmid: string, mediaId: string, quality: Quality): string {
  const { s, e } = QUALITY_FILE[quality];
  return `${s}${songmid}${mediaId || songmid}${e}`;
}

export interface RawTrackInfo {
  id?: number | string;
  mid?: string;
  title?: string;
  name?: string;
  singer?: Array<{ name?: string }>;
  album?: { id?: number | string; mid?: string; name?: string };
  interval?: number;
  file?: Record<string, unknown>;
}

export function normalizeTrackInfo(ti: RawTrackInfo, includeRaw: boolean): Song {
  const file = ti.file ?? {};
  const size128 = num(file.size_128mp3) || num(file.size128);
  const size320 = num(file.size_320mp3) || num(file.size320);
  const sizeflac = num(file.size_flac) || num(file.sizeflac);
  const sizeape = num(file.size_ape) || num(file.sizeape);
  const size24aac = num(file.size_24aac);
  const albumMid = ti.album?.mid;
  const playable = size128 + size320 + sizeflac + sizeape > 0;

  return {
    source: 'qqmusic',
    id: str(ti.id),
    mid: str(ti.mid),
    mediaMid: str(file.media_mid),
    name: str(ti.title) || str(ti.name),
    artists: (ti.singer ?? []).map((x) => x.name).filter((x): x is string => Boolean(x)),
    album: albumMid ? { id: str(ti.album?.id), mid: albumMid, name: str(ti.album?.name) } : null,
    durationMs: num(ti.interval) * 1000,
    coverUrl: coverUrl(albumMid),
    pay: { playable, downloadable: true, priceTrack: null },
    qualities: inferQualities({ m4a: size24aac, s128: size128, s320: size320, flac: sizeflac, ape: sizeape }),
    ...(includeRaw ? { raw: ti } : {}),
  };
}

/** 歌曲详情（匿名可用，cookie 按需带上） */
export async function fetchSongDetailRaw(cgi: Cgi, songmid: string, signal?: AbortSignal): Promise<RawTrackInfo> {
  const data = { songinfo: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_mid: songmid } } };
  const j = await cgi.call<{ songinfo?: { code?: number; data?: { track_info?: RawTrackInfo } } }>(MUSICU, {
    query: { format: 'json', data: JSON.stringify(data) },
    auth: 'optional',
    signal,
  });
  const ti = j?.songinfo?.data?.track_info;
  if (!ti) throw new QQMusicError('QQ_NOT_FOUND', `未找到歌曲 ${songmid}`, { upstreamCode: j?.songinfo?.code });
  return ti;
}

/** 取播放直链（需登录态；uin/authst 由调用方从该用户 cookie 传入） */
export async function fetchSongUrlRaw(
  cgi: Cgi,
  p: { songmid: string; mediaId: string; quality: Quality; uin: string; authst: string },
  signal?: AbortSignal,
): Promise<string> {
  const data = {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        filename: [buildVkeyFile(p.songmid, p.mediaId, p.quality)],
        guid: String(Math.floor(Math.random() * 1e7)),
        songmid: [p.songmid],
        songtype: [0],
        uin: p.uin,
        loginflag: 1,
        platform: '20',
      },
    },
    comm: { uin: p.uin, format: 'json', ct: 19, cv: 0, authst: p.authst },
  };
  const j = await cgi.call<{ req_0?: { code?: number; data?: { midurlinfo?: Array<{ purl?: string }>; sip?: string[]; retcode?: number } } }>(
    MUSICU,
    { query: { format: 'json', data: JSON.stringify(data) }, auth: 'required', signal },
  );
  const r0 = j?.req_0;
  if (r0?.code === 104009 || r0?.data?.retcode === 104009) {
    throw new QQMusicError('QQ_TOKEN_EXPIRED', '登录态已失效（104009）');
  }
  const purl = r0?.data?.midurlinfo?.[0]?.purl;
  if (!purl) throw new QQMusicError('QQ_UNSUPPORTED', '该音质无直链（VIP/版权或音质不可用）', { upstreamCode: r0?.code });
  const sip = r0?.data?.sip ?? [];
  const domain = sip.find((x) => !x.startsWith('http://ws')) ?? sip[0] ?? 'http://ws.stream.qqmusic.qq.com/';
  return `${domain}${purl}`;
}
