import type { AuthStatus, Cookie, HealthResult, ResolvedConfig } from '../types';
import type { AuthContext } from '../transport';
/**
 * 登录态生命周期管理：存储 / 状态机 / 单飞续期 / 健康检查 / 种子兜底。
 * 实现 transport 的 AuthContext 接口（依赖倒置）。
 */
export declare class TokenManager implements AuthContext {
    private readonly cfg;
    private cookie;
    private state;
    private lastRefreshedAt;
    private nextRefreshAt;
    private inFlight;
    private timer;
    constructor(cfg: ResolvedConfig);
    init(): Promise<AuthStatus>;
    status(): AuthStatus;
    /** 手动设置登录态（cookie 字符串或对象） */
    setCookie(input: string | Cookie): Promise<AuthStatus>;
    /** 从 CookieProvider（如客户端镜像）拉一次登录态 */
    seedFromProvider(): Promise<AuthStatus>;
    getCookie(required: boolean): Promise<Cookie | null>;
    handleAuthError(): Promise<Cookie | null>;
    ensureValid(): Promise<Cookie>;
    refresh(): Promise<AuthStatus>;
    private refreshInternal;
    health(): Promise<HealthResult>;
    startAutoRefresh(): void;
    stopAutoRefresh(): void;
    private apply;
    private tryProvider;
    private recomputeState;
}
//# sourceMappingURL=token-manager.d.ts.map