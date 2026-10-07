/**
 * 统一错误模型。
 * 约束：任何 message / detail 中不得出现 cookie 或 key 明文。
 */
export type QQErrorCode = 'QQ_CONFIG' | 'QQ_NETWORK' | 'QQ_TIMEOUT' | 'QQ_UPSTREAM' | 'QQ_PARSE' | 'QQ_AUTH_REQUIRED' | 'QQ_TOKEN_EXPIRED' | 'QQ_REFRESH_FAILED' | 'QQ_NOT_FOUND' | 'QQ_RATE_LIMITED' | 'QQ_UNSUPPORTED';
export interface QQMusicErrorOptions {
    retryable?: boolean;
    httpStatus?: number;
    upstreamCode?: number | string;
    cause?: unknown;
}
export declare class QQMusicError extends Error {
    readonly code: QQErrorCode;
    readonly retryable: boolean;
    readonly httpStatus?: number;
    readonly upstreamCode?: number | string;
    readonly cause?: unknown;
    constructor(code: QQErrorCode, message: string, opts?: QQMusicErrorOptions);
}
export declare function isQQMusicError(e: unknown): e is QQMusicError;
export declare function isAuthError(code: QQErrorCode): boolean;
/** 把 qq-music-api / axios / fetch 抛出的各种错误归一化成 QQMusicError */
export declare function normalizeUpstreamError(e: unknown): QQMusicError;
/** 判断一个上游响应体是否表示需要鉴权（QQ 的 104009 / invalidq） */
export declare function detectAuthFailure(payload: unknown): boolean;
/** 判断 CGI 响应是否表示「需要登录」（QQ 常见 code/subcode） */
export declare function isLoginRequired(payload: unknown): boolean;
//# sourceMappingURL=errors.d.ts.map