import { Readable } from 'stream';
import type { Cookie, ResolvedConfig } from './types';
/** 鉴权上下文：由 TokenManager 实现；transport 只依赖这个接口（依赖倒置） */
export interface AuthContext {
    getCookie(required: boolean): Promise<Cookie | null>;
    handleAuthError(): Promise<Cookie | null>;
}
export interface SendOptions {
    method?: 'GET' | 'POST';
    query?: Record<string, string | number | boolean | undefined>;
    form?: Record<string, string | number>;
    headers?: Record<string, string>;
    cookie?: Cookie | null;
    signal?: AbortSignal;
}
/** 通用 HTTP 客户端：超时 / 重试 / cookie 注入 / JSONP 兼容。无任何全局状态。 */
export declare class HttpClient {
    private readonly cfg;
    constructor(cfg: ResolvedConfig);
    send<T>(url: string, opts?: SendOptions): Promise<T>;
    getJson<T>(url: string, opts?: {
        signal?: AbortSignal;
    }): Promise<T>;
    /** 跟随重定向取最终 URL 与页面文本（用于解析分享短链） */
    probe(url: string, opts?: {
        signal?: AbortSignal;
    }): Promise<{
        finalUrl: string;
        text: string;
    }>;
    /** 下载为 Node Readable */
    getStream(url: string, opts?: {
        signal?: AbortSignal;
    }): Promise<Readable>;
}
/** 鉴权感知的 CGI 调用：注入 cookie、登录失效自动刷新重试一次、显式登录错误归一化 */
export interface CgiCallOptions extends SendOptions {
    auth?: 'none' | 'required' | 'optional';
}
export declare class Cgi {
    private readonly cfg;
    private readonly http;
    private readonly auth;
    constructor(cfg: ResolvedConfig, http: HttpClient, auth: AuthContext);
    call<T>(url: string, opts?: CgiCallOptions): Promise<T>;
}
//# sourceMappingURL=transport.d.ts.map