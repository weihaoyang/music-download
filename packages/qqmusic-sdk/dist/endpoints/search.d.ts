import type { Song } from '../types';
import type { HttpClient } from '../transport';
export interface RawSearchItem {
    songid?: number | string;
    songmid?: string;
    songname?: string;
    singer?: Array<{
        name?: string;
    }>;
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
export declare function normalizeSearchItem(s: RawSearchItem, includeRaw: boolean): Song;
/**
 * 自研搜索：走 search_for_qq_cp（qq-music-api 的 client_search_cp 已失效且会抛未捕获异常）。
 * 匿名可用，不需要登录态。
 */
export declare function searchSongs(http: HttpClient, keyword: string, page: number, limit: number, includeRaw: boolean, signal?: AbortSignal): Promise<{
    items: Song[];
    total: number | null;
}>;
//# sourceMappingURL=search.d.ts.map