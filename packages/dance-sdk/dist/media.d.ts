import type { Logger, QQMusicClient, Quality } from '@hdbc/qqmusic-sdk';
/** ffprobe 读音频时长（毫秒）；失败返回 0 */
export declare function probeDurationMs(file: string): Promise<number>;
/** 提取内嵌封面到 dest；成功且非空返回 true */
export declare function extractCover(src: string, dest: string): Promise<boolean>;
/** 用 ffmpeg loudnorm 读整体响度（LUFS，越大越响）；失败返回 null */
export declare function probeLoudness(file: string): Promise<number | null>;
/** 本地音频缓存：下载成文件（统一转成 mp3），彻底摆脱运行时对 QQ 的依赖 */
export declare class MediaCache {
    private readonly dir;
    private readonly quality;
    private readonly concurrency;
    private readonly logger;
    private active;
    private queue;
    private readonly inflight;
    constructor(dir: string, quality: Quality, concurrency: number, logger: Logger);
    /**
     * 缓存文件名。统一以 .mp3 结尾：下载后会用 ffmpeg 归一化为 mp3
     * （HQ/320 本身就是 mp3，避免后续播放器遇到 flac/ape/m4a/加密格式）。
     */
    fileFor(mid: string): string;
    absPath(file: string): string;
    exists(file: string): Promise<boolean>;
    sizeOf(file: string): Promise<number>;
    /** 目录内所有缓存文件的总大小（字节） */
    totalBytes(): Promise<number>;
    /** 缓存目录统计：总字节数 + 文件数 */
    stats(): Promise<{
        bytes: number;
        files: number;
    }>;
    /** 删除缓存文件（只允许删本缓存目录内的，绝不碰用户绝对路径文件） */
    remove(file: string): Promise<void>;
    /** 同一 mid 的并发下载合并为一个（避免同一临时文件互相覆盖） */
    private ensureFile;
    /** QQ 音乐：确保本地有该歌曲的音频（统一 mp3） */
    ensure(client: QQMusicClient, mid: string): Promise<string>;
    /** 任意直链（网易云 / HTTP 来源）：下载到本地并转 mp3；给 expectedDurationMs 时拒绝试听片段 */
    ensureFromUrl(url: string, mid: string, opts?: {
        expectedDurationMs?: number;
    }): Promise<string>;
    /** 把下载到的文件归一化为 mp3：已是 mp3 直接改名；否则 ffmpeg 转码。 */
    private normalizeToMp3;
    private probeCodec;
    private transcode;
    /** 后台队列下载（受限并发）；fetcher 返回本地文件名；失败时回传原因 */
    enqueue(mid: string, fetcher: () => Promise<string>, opts?: {
        onStart?: (mid: string) => void;
        onDone?: (mid: string, file: string | null, sizeBytes: number, error?: string) => void;
    }): void;
    private drain;
}
//# sourceMappingURL=media.d.ts.map