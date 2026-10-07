"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenManager = void 0;
const errors_1 = require("../errors");
const config_1 = require("../config");
const transport_1 = require("../transport");
const refresh_1 = require("./refresh");
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * 登录态生命周期管理：存储 / 状态机 / 单飞续期 / 健康检查 / 种子兜底。
 * 实现 transport 的 AuthContext 接口（依赖倒置）。
 */
class TokenManager {
    constructor(cfg) {
        this.cfg = cfg;
        this.cookie = null;
        this.state = 'unauthenticated';
        this.lastRefreshedAt = null;
        this.nextRefreshAt = null;
        this.inFlight = null;
        this.timer = null;
    }
    async init() {
        if (this.cfg.seedCookie) {
            await this.apply(this.cfg.seedCookie, { refreshed: false, persist: true });
        }
        else if (this.cfg.tokenStore) {
            const stored = await this.cfg.tokenStore.load();
            if (stored) {
                this.cookie = stored;
                this.lastRefreshedAt = null;
            }
        }
        this.recomputeState();
        this.startAutoRefresh();
        return this.status();
    }
    status() {
        this.recomputeState();
        return {
            state: this.state,
            uin: this.cookie?.uin ?? null,
            keyMasked: (0, config_1.maskKey)(this.cookie?.qqmusic_key ?? this.cookie?.qm_keyst),
            lastRefreshedAt: this.lastRefreshedAt,
            nextRefreshAt: this.nextRefreshAt,
        };
    }
    /** 手动设置登录态（cookie 字符串或对象） */
    async setCookie(input) {
        const parsed = (0, config_1.parseCookie)(input);
        await this.apply(parsed, { refreshed: false, persist: true });
        return this.status();
    }
    /** 从 CookieProvider（如客户端镜像）拉一次登录态 */
    async seedFromProvider() {
        const seeded = await this.tryProvider();
        if (!seeded)
            throw new errors_1.QQMusicError('QQ_AUTH_REQUIRED', 'cookieProvider 未提供有效登录态');
        await this.apply(seeded, { refreshed: false, persist: true });
        return this.status();
    }
    /* ------------------------- AuthContext 实现 ------------------------- */
    async getCookie(required) {
        this.recomputeState();
        if (this.cookie && (this.state === 'valid' || this.state === 'expiring')) {
            if (this.state === 'expiring')
                void this.refresh().catch(() => undefined);
            return this.cookie;
        }
        // expired / unauthenticated：先尝试 provider（如客户端镜像），有新鲜的就直接用
        const seeded = await this.tryProvider();
        if (seeded) {
            await this.apply(seeded, { refreshed: false, persist: true });
            this.recomputeState();
            if (this.cookie && (this.state === 'valid' || this.state === 'expiring'))
                return this.cookie;
        }
        // 再尝试续期
        if (this.cookie) {
            try {
                return await this.refreshInternal();
            }
            catch {
                /* fallthrough */
            }
        }
        if (required) {
            throw new errors_1.QQMusicError('QQ_AUTH_REQUIRED', '需要 QQ 音乐登录态，请先 setCookie 或提供 cookieProvider');
        }
        return null;
    }
    async handleAuthError() {
        const seeded = await this.tryProvider();
        if (seeded)
            await this.apply(seeded, { refreshed: false, persist: true });
        if (!this.cookie)
            return null;
        this.state = 'expired';
        try {
            return await this.refreshInternal();
        }
        catch {
            return null;
        }
    }
    async ensureValid() {
        const cookie = await this.getCookie(true);
        if (!cookie)
            throw new errors_1.QQMusicError('QQ_AUTH_REQUIRED', '需要 QQ 音乐登录态');
        return cookie;
    }
    /* ------------------------------ 续期 ------------------------------ */
    async refresh() {
        await this.refreshInternal();
        return this.status();
    }
    async refreshInternal() {
        if (this.inFlight)
            return this.inFlight;
        if (!this.cookie)
            throw new errors_1.QQMusicError('QQ_AUTH_REQUIRED', '没有可用于续期的登录态');
        const task = (async () => {
            let lastErr;
            for (let i = 0; i < this.cfg.refresh.maxAttempts; i++) {
                try {
                    const next = await (0, refresh_1.refreshCookie)(this.cfg, this.cookie);
                    await this.apply(next, { refreshed: true, persist: true });
                    this.cfg.logger.info('[qqmusic-sdk] 续期成功，uin=' + next.uin);
                    this.cfg.onTokenRefreshed?.(this.status());
                    return next;
                }
                catch (e) {
                    lastErr = e;
                    this.cfg.logger.warn(`[qqmusic-sdk] 续期第 ${i + 1}/${this.cfg.refresh.maxAttempts} 次失败`, e?.message);
                    if (i < this.cfg.refresh.maxAttempts - 1)
                        await sleep(500 * 2 ** i);
                }
            }
            this.state = 'expired';
            this.recomputeState();
            this.cfg.onTokenExpired?.(lastErr);
            throw lastErr instanceof errors_1.QQMusicError
                ? lastErr
                : new errors_1.QQMusicError('QQ_REFRESH_FAILED', String(lastErr?.message ?? lastErr));
        })();
        this.inFlight = task;
        try {
            return await task;
        }
        finally {
            this.inFlight = null;
        }
    }
    /* ------------------------------ 健康 ------------------------------ */
    async health() {
        const checkedAt = this.cfg.now();
        const t0 = Date.now();
        try {
            const cookie = await this.ensureValid();
            const http = new transport_1.HttpClient(this.cfg);
            const j = await http.send('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg', {
                query: { cid: 205360838, userid: cookie.uin, reqfrom: 1, g_tk: 5381, format: 'json' },
                cookie,
            });
            if (Number(j?.code) === 1000)
                throw new Error('登录态已失效');
            return { ok: true, state: this.state, checkedAt, latencyMs: Date.now() - t0 };
        }
        catch (e) {
            return { ok: false, state: this.state, checkedAt, latencyMs: Date.now() - t0, detail: e?.message };
        }
    }
    /* ---------------------------- 自动续期 ---------------------------- */
    startAutoRefresh() {
        if (this.timer)
            return;
        // 定时器周期取 min(intervalMs, 1 天)，但不超过 intervalMs；实际是否刷新由 recomputeState/refresh 决定
        const every = Math.max(60_000, Math.min(this.cfg.refresh.intervalMs, 24 * 60 * 60 * 1000));
        this.timer = setInterval(() => {
            if (this.state === 'expired' || this.state === 'expiring') {
                void this.refresh().catch((e) => this.cfg.logger.warn('[qqmusic-sdk] 自动续期失败', e?.message));
            }
        }, every);
        if (typeof this.timer.unref === 'function')
            this.timer.unref();
    }
    stopAutoRefresh() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    /* ------------------------------ 内部 ------------------------------ */
    async apply(cookie, opts) {
        this.cookie = cookie;
        this.lastRefreshedAt = opts.refreshed ? this.cfg.now() : this.lastRefreshedAt ?? this.cfg.now();
        this.recomputeState();
        if (opts.persist && this.cfg.tokenStore) {
            try {
                await this.cfg.tokenStore.save(cookie);
            }
            catch (e) {
                this.cfg.logger.warn('[qqmusic-sdk] 保存 cookie 失败', e?.message);
            }
        }
    }
    async tryProvider() {
        if (!this.cfg.cookieProvider)
            return null;
        try {
            const cookie = await this.cfg.cookieProvider.getCookie();
            return cookie && cookie.uin ? cookie : null;
        }
        catch (e) {
            this.cfg.logger.warn('[qqmusic-sdk] cookieProvider 获取失败', e?.message);
            return null;
        }
    }
    recomputeState() {
        if (!this.cookie) {
            this.state = 'unauthenticated';
            this.nextRefreshAt = null;
            return;
        }
        const base = this.lastRefreshedAt ?? this.cfg.now();
        const due = base + this.cfg.refresh.intervalMs;
        this.nextRefreshAt = due;
        const now = this.cfg.now();
        if (now >= due)
            this.state = 'expired';
        else if (now >= due - this.cfg.refresh.expiringThresholdMs)
            this.state = 'expiring';
        else
            this.state = 'valid';
    }
}
exports.TokenManager = TokenManager;
//# sourceMappingURL=token-manager.js.map