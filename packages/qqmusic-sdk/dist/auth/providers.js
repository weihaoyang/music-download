"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpCookieProvider = void 0;
/**
 * 从本地 QQ 客户端桥（tools/qqclient-bridge）拉取 live cookie。
 * 典型用法：服务器常开客户端 + bridge，SDK 通过它拿到「客户端自动续期后的」会员账号 cookie。
 */
class HttpCookieProvider {
    constructor(url, fetchImpl = globalThis.fetch) {
        this.url = url;
        this.fetchImpl = fetchImpl;
    }
    async getCookie() {
        try {
            const res = await this.fetchImpl(this.url, { headers: { Accept: 'application/json' } });
            if (!res.ok)
                return null;
            const j = (await res.json());
            if (!j || j.ok === false)
                return null;
            const uin = String(j.uin ?? '');
            const key = String(j.qqmusic_key ?? j.qm_keyst ?? '');
            if (!uin || !key)
                return null;
            const cookie = { ...j, uin, qqmusic_key: key, qm_keyst: String(j.qm_keyst ?? key) };
            return cookie;
        }
        catch {
            return null;
        }
    }
}
exports.HttpCookieProvider = HttpCookieProvider;
//# sourceMappingURL=providers.js.map