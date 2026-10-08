/** 归一化后的「待入库曲目」草稿（各来源产出的统一形态） */
export interface TrackMeta {
    id: string;
    name: string;
    artists?: string[];
    album?: string | null;
    durationMs?: number;
    coverUrl?: string | null;
    /** 外部直链引用（http 原链；由调用方决定如何持久化） */
    url?: string | null;
    /** 本地文件绝对路径（local 来源） */
    file?: string | null;
    /** true=本地文件，false/未设=外部来源 */
    local?: boolean;
    /** 来源自带舞种（如本地文件名解析出的舞种） */
    type?: string | null;
}
/** 一个「下载/导入来源」的能力定义 */
export interface TrackSource {
    id: string;
    label: string;
    kind: 'online' | 'local';
    /** 是否已具备访问凭证（用于展示） */
    authed: () => boolean;
    /** 可选：按关键词搜索（kind: song|playlist） */
    search?: (keywords: string, kind: string, limit: number) => Promise<unknown[]>;
    /** 构建待入库曲目 */
    build: (input: Record<string, unknown>) => Promise<{
        name?: string;
        tracks: TrackMeta[];
        note?: string;
    }>;
    /** 可选：解析可播放直链（网易云/直链）；无则由调用方其它逻辑处理（QQ/本地） */
    streamUrl?: (ref: {
        mid: string;
        url?: string | null;
    }) => Promise<string | null>;
}
/** 注册表依赖注入（QQ 客户端由宿主提供） */
export interface SourceDeps {
    qqAnonymous: () => Promise<import('@hdbc/qqmusic-sdk').QQMusicClient>;
    qqLibrary: () => Promise<import('@hdbc/qqmusic-sdk').QQMusicClient>;
}
//# sourceMappingURL=types.d.ts.map