import { createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type {
  DownloadParams,
  LyricResult,
  Quality,
  ResolvedConfig,
  Song,
  SongDetailParams,
  SongUrl,
  SongUrlParams,
} from '../types';
import { QQMusicError } from '../errors';
import type { AuthContext, Cgi, HttpClient } from '../transport';
import { fetchSongDetailRaw, fetchSongUrlRaw, normalizeTrackInfo } from '../endpoints/song';
import { fetchLyric } from '../endpoints/lyric';

/** 目标音质取不到时的降级顺序 */
const FALLBACK: Record<Quality, Quality[]> = {
  flac: ['flac', '320', '128'],
  ape: ['ape', 'flac', '320', '128'],
  '320': ['320', '128'],
  '128': ['128'],
  m4a: ['m4a', '320', '128'],
};

/** 无全局状态：cookie 由注入的 AuthContext（每用户一个实例）提供 */
export class SongsResource {
  constructor(
    private readonly cgi: Cgi,
    private readonly auth: AuthContext,
    private readonly http: HttpClient,
    private readonly cfg: ResolvedConfig,
  ) {}

  /** 歌曲详情（匿名可用；含 media_mid / 可用音质） */
  async detail(params: SongDetailParams): Promise<Song> {
    const ti = await fetchSongDetailRaw(this.cgi, params.songmid, params.signal);
    return normalizeTrackInfo(ti, this.cfg.includeRaw);
  }

  async details(list: SongDetailParams[]): Promise<Song[]> {
    const out: Song[] = [];
    for (const p of list) out.push(await this.detail(p));
    return out;
  }

  /** 取播放 / 下载直链（需登录态；默认逐级降级） */
  async url(params: SongUrlParams): Promise<SongUrl> {
    const target: Quality = params.quality ?? '320';
    const cookie = await this.auth.getCookie(true); // 无有效登录态会抛 QQ_AUTH_REQUIRED
    if (!cookie) throw new QQMusicError('QQ_AUTH_REQUIRED', '需要 QQ 音乐登录态');
    const authst = cookie.qqmusic_key ?? cookie.qm_keyst ?? '';
    const uin = cookie.uin;

    let mediaId = params.mediaId;
    if (!mediaId) {
      try {
        mediaId = (await this.detail({ songmid: params.songmid, signal: params.signal })).mediaMid;
      } catch {
        /* 拿不到 media_mid 时退回 songmid */
      }
    }
    const order = params.preferFallback === false ? [target] : Array.from(new Set<Quality>([target, ...FALLBACK[target]]));

    let lastErr: unknown;
    for (const quality of order) {
      try {
        const url = await fetchSongUrlRaw(
          this.cgi,
          { songmid: params.songmid, mediaId: mediaId || params.songmid, quality, uin, authst },
          params.signal,
        );
        return { songmid: params.songmid, quality, url, expiresAt: null };
      } catch (e) {
        lastErr = e;
        if (e instanceof QQMusicError && (e.code === 'QQ_AUTH_REQUIRED' || e.code === 'QQ_TOKEN_EXPIRED')) throw e;
      }
    }
    throw new QQMusicError('QQ_UNSUPPORTED', `无法获取 ${params.songmid} 的播放直链（VIP/版权限制或音质不可用）`, {
      cause: lastErr,
    });
  }

  /** 原始音频流（Node Readable） */
  async stream(params: SongUrlParams): Promise<Readable> {
    const { url } = await this.url(params);
    return this.http.getStream(url, { signal: params.signal });
  }

  /** 歌词（匿名可用） */
  async lyric(params: { songmid: string; signal?: AbortSignal }): Promise<LyricResult> {
    return fetchLyric(this.cgi, params.songmid, params.signal);
  }

  /** 下载到文件 */
  async downloadToFile(params: DownloadParams): Promise<{ path: string; bytes: number; url: string }> {
    const { url } = await this.url(params);
    const readable = await this.http.getStream(url, { signal: params.signal });
    await pipeline(readable, createWriteStream(params.destPath));
    const st = await stat(params.destPath);
    if (st.size === 0) throw new QQMusicError('QQ_UNSUPPORTED', '下载得到空文件');
    return { path: params.destPath, bytes: st.size, url };
  }
}
