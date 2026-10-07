import type { Cookie, CookieProvider } from '../types';

/**
 * 从本地 QQ 客户端桥（tools/qqclient-bridge）拉取 live cookie。
 * 典型用法：服务器常开客户端 + bridge，SDK 通过它拿到「客户端自动续期后的」会员账号 cookie。
 */
export class HttpCookieProvider implements CookieProvider {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = (globalThis as unknown as { fetch: typeof fetch }).fetch,
  ) {}

  async getCookie(): Promise<Cookie | null> {
    try {
      const res = await this.fetchImpl(this.url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const j = (await res.json()) as Record<string, unknown> | null;
      if (!j || j.ok === false) return null;
      const uin = String(j.uin ?? '');
      const key = String(j.qqmusic_key ?? j.qm_keyst ?? '');
      if (!uin || !key) return null;
      const cookie: Cookie = { ...j, uin, qqmusic_key: key, qm_keyst: String(j.qm_keyst ?? key) } as Cookie;
      return cookie;
    } catch {
      return null;
    }
  }
}
