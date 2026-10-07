import type { AuthStatus, Cookie, HealthResult, QQMusicClientConfig } from './types';
import { resolveConfig } from './config';
import { TokenManager } from './auth/token-manager';
import { QrLogin, type QrLoginStart, type QrLoginResult, type QrLoginType } from './auth/qr-login';
import { Cgi, HttpClient } from './transport';
import { SearchResource } from './resources/search';
import { SongsResource } from './resources/songs';
import { PlaylistsResource } from './resources/playlists';
import { UserResource } from './resources/user';

export interface AuthApi {
  status(): Promise<AuthStatus>;
  setCookie(input: string | Cookie): Promise<AuthStatus>;
  refresh(): Promise<AuthStatus>;
  health(): Promise<HealthResult>;
  seedFromProvider(): Promise<AuthStatus>;
  startAutoRefresh(): void;
  stopAutoRefresh(): void;
  /** 扫码登录：start 拿二维码，轮询 check，confirmed 后把 cookie 交给 setCookie */
  login: {
    start(type: QrLoginType): Promise<QrLoginStart>;
    check(type: QrLoginType, token: string, signal?: AbortSignal): Promise<QrLoginResult>;
  };
}

export interface QQMusicClient {
  search: SearchResource;
  songs: SongsResource;
  playlists: PlaylistsResource;
  user: UserResource;
  auth: AuthApi;
  /** 逃生舱：高级用法可直接拿到 token 管理器 */
  readonly tokenManager: TokenManager;
}

/**
 * 创建 SDK 客户端。会读取/加载登录态（seedCookie / TokenStore / CookieProvider）并启动自动续期。
 */
export async function createQQMusicClient(config: QQMusicClientConfig = {}): Promise<QQMusicClient> {
  const cfg = resolveConfig(config);
  const tokenManager = new TokenManager(cfg);
  await tokenManager.init();

  const http = new HttpClient(cfg);
  const cgi = new Cgi(cfg, http, tokenManager);
  const qrLogin = new QrLogin(cfg);

  return {
    search: new SearchResource(http, cgi, cfg),
    songs: new SongsResource(cgi, tokenManager, http, cfg),
    playlists: new PlaylistsResource(cgi, tokenManager, http, cfg),
    user: new UserResource(cgi, tokenManager, cfg),
    auth: {
      status: () => Promise.resolve(tokenManager.status()),
      setCookie: (input) => tokenManager.setCookie(input),
      refresh: () => tokenManager.refresh(),
      health: () => tokenManager.health(),
      seedFromProvider: () => tokenManager.seedFromProvider(),
      startAutoRefresh: () => tokenManager.startAutoRefresh(),
      stopAutoRefresh: () => tokenManager.stopAutoRefresh(),
      login: {
        start: (type) => qrLogin.start(type),
        check: (type, token, signal) => qrLogin.check(type, token, signal),
      },
    },
    tokenManager,
  };
}
