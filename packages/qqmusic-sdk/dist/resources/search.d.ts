import type { Page, PlaylistBrief, QuickResult, ResolvedConfig, SearchParams, Song } from '../types';
import type { Cgi, HttpClient } from '../transport';
export declare class SearchResource {
    private readonly http;
    private readonly cgi;
    private readonly cfg;
    constructor(http: HttpClient, cgi: Cgi, cfg: ResolvedConfig);
    /** 搜索歌曲（匿名，不需要登录态） */
    songs(params: SearchParams): Promise<Page<Song>>;
    /** 搜索歌单（匿名） */
    playlists(params: SearchParams): Promise<Page<PlaylistBrief>>;
    /** 快速联想（匿名） */
    quick(params: {
        keyword: string;
        signal?: AbortSignal;
    }): Promise<QuickResult>;
}
//# sourceMappingURL=search.d.ts.map