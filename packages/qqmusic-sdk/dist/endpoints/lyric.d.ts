import type { LyricResult } from '../types';
import type { Cgi } from '../transport';
/** 取歌词（QQ 音乐，匿名可用） */
export declare function fetchLyric(cgi: Cgi, songmid: string, signal?: AbortSignal): Promise<LyricResult>;
//# sourceMappingURL=lyric.d.ts.map