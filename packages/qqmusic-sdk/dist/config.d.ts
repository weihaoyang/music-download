import type { Cookie, Logger, QQMusicClientConfig, ResolvedConfig } from './types';
export declare const DEFAULT_REFRESH: {
    /** 30 天。QQLogin 换新的 key 默认有效期约 90 天，30 天续一次留足余量。 */
    intervalMs: number;
    expiringThresholdMs: number;
    onAuthErrorRefresh: boolean;
    maxAttempts: number;
};
export declare const DEFAULT_HTTP: {
    timeoutMs: number;
    retries: number;
    throttleMs: number;
    headers: {
        'User-Agent': string;
        Referer: string;
    };
};
export declare const DEFAULT_LOGGER: Logger;
/** 解析 cookie 字符串 / 对象为规范 Cookie；uin 必填（可从 wxuin 派生） */
export declare function parseCookie(input: string | Cookie): Cookie;
export declare function resolveConfig(config?: QQMusicClientConfig): ResolvedConfig;
/** 对 key 做脱敏展示 */
export declare function maskKey(key: string | undefined | null): string | null;
//# sourceMappingURL=config.d.ts.map