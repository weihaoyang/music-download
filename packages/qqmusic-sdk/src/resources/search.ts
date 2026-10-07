import type { Page, PlaylistBrief, QuickResult, ResolvedConfig, SearchParams, Song } from '../types';
import type { Cgi, HttpClient } from '../transport';
import { searchSongs } from '../endpoints/search';
import { searchPlaylists } from '../endpoints/playlist';
import { quickSearch } from '../endpoints/quick';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

export class SearchResource {
  constructor(
    private readonly http: HttpClient,
    private readonly cgi: Cgi,
    private readonly cfg: ResolvedConfig,
  ) {}

  /** 搜索歌曲（匿名，不需要登录态） */
  async songs(params: SearchParams): Promise<Page<Song>> {
    const page = clamp(params.page ?? 1, 1, 1000);
    const limit = clamp(params.limit ?? 20, 1, 50);
    const { items, total } = await searchSongs(this.http, params.keyword, page, limit, this.cfg.includeRaw, params.signal);
    return { items, page, limit, total, hasMore: items.length === limit };
  }

  /** 搜索歌单（匿名） */
  async playlists(params: SearchParams): Promise<Page<PlaylistBrief>> {
    const page = clamp(params.page ?? 1, 1, 1000);
    const limit = clamp(params.limit ?? 20, 1, 50);
    const { items, total } = await searchPlaylists(this.cgi, params.keyword, page, limit, params.signal);
    return { items, page, limit, total, hasMore: items.length === limit };
  }

  /** 快速联想（匿名） */
  async quick(params: { keyword: string; signal?: AbortSignal }): Promise<QuickResult> {
    return quickSearch(this.cgi, params.keyword, params.signal);
  }
}
