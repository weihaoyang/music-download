import type { Quality, Song } from '../types';
import type { Cgi } from '../transport';
/** 音质 -> vkey 文件名前缀/后缀 */
export declare const QUALITY_FILE: Record<Quality, {
    s: string;
    e: string;
}>;
/** 拼 vkey 请求的文件名：前缀 + songmid + media_mid + 后缀 */
export declare function buildVkeyFile(songmid: string, mediaId: string, quality: Quality): string;
export interface RawTrackInfo {
    id?: number | string;
    mid?: string;
    title?: string;
    name?: string;
    singer?: Array<{
        name?: string;
    }>;
    album?: {
        id?: number | string;
        mid?: string;
        name?: string;
    };
    interval?: number;
    file?: Record<string, unknown>;
}
export declare function normalizeTrackInfo(ti: RawTrackInfo, includeRaw: boolean): Song;
/** 歌曲详情（匿名可用，cookie 按需带上） */
export declare function fetchSongDetailRaw(cgi: Cgi, songmid: string, signal?: AbortSignal): Promise<RawTrackInfo>;
/** 取播放直链（需登录态；uin/authst 由调用方从该用户 cookie 传入） */
export declare function fetchSongUrlRaw(cgi: Cgi, p: {
    songmid: string;
    mediaId: string;
    quality: Quality;
    uin: string;
    authst: string;
}, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=song.d.ts.map