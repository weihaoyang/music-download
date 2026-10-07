import type { Cookie, CookieProvider } from '../types';
/**
 * 从本地 QQ 客户端桥（tools/qqclient-bridge）拉取 live cookie。
 * 典型用法：服务器常开客户端 + bridge，SDK 通过它拿到「客户端自动续期后的」会员账号 cookie。
 */
export declare class HttpCookieProvider implements CookieProvider {
    private readonly url;
    private readonly fetchImpl;
    constructor(url: string, fetchImpl?: typeof fetch);
    getCookie(): Promise<Cookie | null>;
}
//# sourceMappingURL=providers.d.ts.map