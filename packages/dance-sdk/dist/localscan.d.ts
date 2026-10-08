/**
 * 按《HBDC 舞曲及排曲规则 表1》的文件命名规则解析本地舞曲文件：
 *   舞蹈类型-歌曲名-歌手
 *   舞蹈类型-歌曲名-歌手-时长（如 吉特巴-火花-格格-4′20″）
 *   舞蹈类型-歌曲名-歌手(剪辑版)
 * 支持全角/半角连字符与下划线。
 */
/** 俱乐部常见舞蹈类型（用于从文件名前缀识别） */
export declare const KNOWN_TYPES: string[];
export declare const AUDIO_EXTS: string[];
export interface ParsedDanceFile {
    /** 绝对路径 */
    file: string;
    type: string;
    name: string;
    artists: string[];
    durationMs: number | null;
}
export declare function parseDanceFileName(absPath: string): ParsedDanceFile | null;
export declare function scanDanceDir(dir: string, recursive?: boolean): Promise<{
    files: ParsedDanceFile[];
    audio: number;
    unparsed: string[];
}>;
/** 归一化歌名：去括号内容、去标点与空白，便于与 QQ 曲库匹配 */
export declare function coreName(s: string): string;
export declare function localMid(absPath: string): string;
//# sourceMappingURL=localscan.d.ts.map