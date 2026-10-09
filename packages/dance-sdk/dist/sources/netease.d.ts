/**
 * 网易云音乐（NetEase Cloud Music）来源适配器。
 * 使用免加密的 `/api/*` 端点：匿名可用 搜索 / 详情 / 歌单 / 歌词；
 * 播放直链（`/api/song/enhance/player/url`）需要登录 Cookie（MUSIC_U），否则返回 null。
 *
 * 见 docs/library-source-architecture.md（TrackSource 适配器之一）。
 */
/** 设置网易云登录 Cookie（MUSIC_U=...）。空串=匿名。 */
export declare function setNeteaseCookie(cookie: string): void;
export declare function hasNeteaseCookie(): boolean;
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
export declare function normalizeNeSong(s: any): NeSong;
/** 搜索歌曲 */
export declare function searchSongs(keyword: string, limit?: number, offset?: number, signal?: AbortSignal): Promise<NeSong[]>;
/** 搜索歌单 */
export declare function searchPlaylists(keyword: string, limit?: number, offset?: number, signal?: AbortSignal): Promise<Array<{
    id: string;
    name: string;
    coverUrl: string | null;
    songCount: number;
    creator: string | null;
}>>;
/** 歌曲详情 */
export declare function songDetail(ids: Array<string | number>, signal?: AbortSignal): Promise<NeSong[]>;
/** 播放直链（匿名通常为 null；需 MUSIC_U Cookie） */
export declare function songUrl(id: string | number, br?: number, signal?: AbortSignal): Promise<string | null>;
/** 歌词（LRC 文本） */
export declare function lyric(id: string | number, signal?: AbortSignal): Promise<{
    lyric: string;
    trans: string | null;
}>;
/** 歌单详情（全部曲目） */
export declare function playlistDetail(id: string | number, limit?: number, signal?: AbortSignal): Promise<{
    id: string;
    name: string;
    coverUrl: string | null;
    songCount: number;
    creator: string | null;
    songs: NeSong[];
}>;
/** 从「链接 / 分享文本 / 纯 ID」解析出歌单或歌曲 ID */
export declare function extractNeId(input: string): {
    kind: 'playlist' | 'song';
    id: string;
} | null;
/** 获取登录二维码：返回 unikey（token）与二维码里要编码的 URL */
export declare function qrStart(signal?: AbortSignal): Promise<{
    token: string;
    url: string;
}>;
/** 轮询扫码状态；confirmed 时返回登录 Cookie（MUSIC_U） */
export declare function qrCheck(token: string, signal?: AbortSignal): Promise<{
    state: 'pending' | 'scanned' | 'confirmed' | 'expired';
    cookie?: string;
}>;
//# sourceMappingURL=netease.d.ts.map