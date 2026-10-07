import type { PlaylistBrief, PlaylistDetail, Song } from '../types';
import type { Cgi, HttpClient } from '../transport';
export interface RawPlaylistSearchItem {
    dissid?: string | number;
    dissname?: string;
    imgurl?: string;
    songnum?: number;
    song_count?: number;
    creator?: {
        name?: string;
    };
}
export declare function normalizePlaylistBrief(x: RawPlaylistSearchItem): PlaylistBrief;
/** 歌单搜索：必须 remoteplace=txt.yqq.playlist 且 page_no 从 0 开始（实测） */
export declare function searchPlaylists(cgi: Cgi, keyword: string, page: number, limit: number, signal?: AbortSignal): Promise<{
    items: PlaylistBrief[];
    total: number | null;
}>;
/** 歌单里的歌曲，兼容新旧两种字段命名 */
export declare function normalizePlaylistSong(s: Record<string, unknown>, includeRaw: boolean): Song;
/**
 * 歌单详情。匿名会被 QQ 拒（privacy error），使用登录态走老的 CGI 端点（实测带 cookie 可返回全部歌曲）。
 */
export declare function playlistDetail(cgi: Cgi, disstid: string, page: number, limit: number, includeRaw: boolean, signal?: AbortSignal): Promise<PlaylistDetail>;
/**
 * 「我喜欢」歌单（dirid=201）：与普通歌单不同，走 `music.srfDissInfo.DissInfo/CgiGetDiss`，
 * 需登录态；分页用 `song_begin/song_num`。
 */
export declare function likedSongs(cgi: Cgi, cookie: {
    uin: string;
    authst: string;
}, page: number, limit: number, includeRaw: boolean, signal?: AbortSignal): Promise<PlaylistDetail>;
/**
 * 从「歌单 ID / 完整链接 / 分享短链」里解析出 disstid。
 * 短链（返回 null 的）需要再走 resolvePlaylistInput 跟随跳转。
 */
export declare function extractDissId(input: string): string | null;
/** 解析任意输入（ID / 链接 / 短链）为 disstid */
export declare function resolvePlaylistInput(http: HttpClient, input: string, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=playlist.d.ts.map