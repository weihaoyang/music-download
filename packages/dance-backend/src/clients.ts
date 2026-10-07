import { createQQMusicClient, HttpCookieProvider, QrLogin, resolveConfig } from '@hdbc/qqmusic-sdk';
import type { Cookie, Logger, QQMusicClient } from '@hdbc/qqmusic-sdk';
import type { Session } from './session';

/**
 * 客户端实例池：
 * - anonymous：匿名（搜索/详情，零 token）
 * - library：默认曲库/播放用的「会员账号」——cookie 来自客户端镜像 bridge
 * - user：每用户一个实例（各自扫码 cookie）
 * - qr：扫码登录（无状态，单例即可）
 */
export class ClientPool {
  private anon?: Promise<QQMusicClient>;
  private library?: Promise<QQMusicClient>;
  private readonly users = new Map<string, Promise<QQMusicClient>>();
  private readonly qr: QrLogin;

  constructor(
    private readonly bridgeUrl: string,
    private readonly logger: Logger,
  ) {
    this.qr = new QrLogin(resolveConfig({ logger }));
  }

  anonymous(): Promise<QQMusicClient> {
    if (!this.anon) this.anon = createQQMusicClient({ logger: this.logger });
    return this.anon;
  }

  libraryClient(): Promise<QQMusicClient> {
    if (!this.library) {
      this.library = createQQMusicClient({
        cookieProvider: new HttpCookieProvider(this.bridgeUrl),
        logger: this.logger,
      });
    }
    return this.library;
  }

  userClient(session: Session): Promise<QQMusicClient> {
    const key = `${session.sid}:${(session.cookie.qqmusic_key ?? '').slice(0, 10)}`;
    let p = this.users.get(key);
    if (!p) {
      p = createQQMusicClient({ seedCookie: session.cookie, logger: this.logger });
      this.users.set(key, p);
    }
    return p;
  }

  evictUser(sid: string): void {
    for (const k of [...this.users.keys()]) if (k.startsWith(`${sid}:`)) this.users.delete(k);
  }

  qrLogin(): QrLogin {
    return this.qr;
  }
}
