import type { AuthStatus, Cookie, HealthResult, QQMusicClientConfig } from './types';
import { TokenManager } from './auth/token-manager';
import { type QrLoginStart, type QrLoginResult, type QrLoginType } from './auth/qr-login';
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
export declare function createQQMusicClient(config?: QQMusicClientConfig): Promise<QQMusicClient>;
//# sourceMappingURL=client.d.ts.map