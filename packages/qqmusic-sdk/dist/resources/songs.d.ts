import type { Readable } from 'stream';
import type { DownloadParams, LyricResult, ResolvedConfig, Song, SongDetailParams, SongUrl, SongUrlParams } from '../types';
import type { AuthContext, Cgi, HttpClient } from '../transport';
/** 无全局状态：cookie 由注入的 AuthContext（每用户一个实例）提供 */
export declare class SongsResource {
    private readonly cgi;
    private readonly auth;
    private readonly http;
    private readonly cfg;
    constructor(cgi: Cgi, auth: AuthContext, http: HttpClient, cfg: ResolvedConfig);
    /** 歌曲详情（匿名可用；含 media_mid / 可用音质） */
    detail(params: SongDetailParams): Promise<Song>;
    details(list: SongDetailParams[]): Promise<Song[]>;
    /** 取播放 / 下载直链（需登录态；默认逐级降级） */
    url(params: SongUrlParams): Promise<SongUrl>;
    /** 原始音频流（Node Readable） */
    stream(params: SongUrlParams): Promise<Readable>;
    /** 歌词（匿名可用） */
    lyric(params: {
        songmid: string;
        signal?: AbortSignal;
    }): Promise<LyricResult>;
    /** 下载到文件 */
    downloadToFile(params: DownloadParams): Promise<{
        path: string;
        bytes: number;
        url: string;
    }>;
}
//# sourceMappingURL=songs.d.ts.map