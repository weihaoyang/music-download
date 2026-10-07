"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cgi = exports.HttpClient = void 0;
const stream_1 = require("stream");
const errors_1 = require("./errors");
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function cookieHeader(cookie) {
    if (!cookie)
        return '';
    return Object.entries(cookie)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('; ');
}
/** 解析 JSON，兼容 JSONP 包装（callback(...) / MusicJsonCallback(...)） */
function parseBody(text) {
    const t = text.trim();
    const m = t.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
    return JSON.parse(m ? m[1] : t);
}
/** 通用 HTTP 客户端：超时 / 重试 / cookie 注入 / JSONP 兼容。无任何全局状态。 */
class HttpClient {
    constructor(cfg) {
        this.cfg = cfg;
    }
    async send(url, opts = {}) {
        const method = opts.method ?? 'GET';
        let finalUrl = url;
        if (opts.query) {
            const qs = new URLSearchParams();
            for (const [k, v] of Object.entries(opts.query))
                if (v !== undefined)
                    qs.append(k, String(v));
            finalUrl += (url.includes('?') ? '&' : '?') + qs.toString();
        }
        const headers = { ...this.cfg.http.headers, ...(opts.headers ?? {}) };
        const ch = cookieHeader(opts.cookie);
        if (ch)
            headers.Cookie = ch;
        let body;
        if (method === 'POST') {
            headers['Content-Type'] = headers['Content-Type'] ?? 'application/x-www-form-urlencoded';
            body = new URLSearchParams(Object.entries(opts.form ?? {}).map(([k, v]) => [k, String(v)])).toString();
        }
        let lastErr;
        for (let attempt = 0; attempt <= this.cfg.http.retries; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.cfg.http.timeoutMs);
            const onAbort = () => controller.abort();
            opts.signal?.addEventListener('abort', onAbort, { once: true });
            try {
                const res = await this.cfg.fetchImpl(finalUrl, { method, headers, body, signal: controller.signal });
                const text = await res.text();
                if (!res.ok) {
                    throw new errors_1.QQMusicError('QQ_UPSTREAM', `HTTP ${res.status}`, { httpStatus: res.status, retryable: res.status >= 500 });
                }
                return parseBody(text);
            }
            catch (e) {
                const err = (0, errors_1.normalizeUpstreamError)(e);
                lastErr = err;
                if (attempt < this.cfg.http.retries && err.retryable) {
                    await sleep(200 * 2 ** attempt);
                    continue;
                }
                throw err;
            }
            finally {
                clearTimeout(timer);
                opts.signal?.removeEventListener('abort', onAbort);
            }
        }
        throw lastErr ?? new errors_1.QQMusicError('QQ_UPSTREAM', '请求失败');
    }
    async getJson(url, opts = {}) {
        return this.send(url, { method: 'GET', signal: opts.signal });
    }
    /** 跟随重定向取最终 URL 与页面文本（用于解析分享短链） */
    async probe(url, opts = {}) {
        const res = await this.cfg.fetchImpl(url, { headers: this.cfg.http.headers, redirect: 'follow', signal: opts.signal });
        let text = '';
        try {
            text = (await res.text()).slice(0, 20000);
        }
        catch {
            /* ignore */
        }
        return { finalUrl: res.url || url, text };
    }
    /** 下载为 Node Readable */
    async getStream(url, opts = {}) {
        const res = await this.cfg.fetchImpl(url, { headers: this.cfg.http.headers, signal: opts.signal });
        if (!res.ok || !res.body) {
            throw new errors_1.QQMusicError('QQ_UNSUPPORTED', `下载失败 HTTP ${res.status}`, { httpStatus: res.status });
        }
        return stream_1.Readable.fromWeb(res.body);
    }
}
exports.HttpClient = HttpClient;
class Cgi {
    constructor(cfg, http, auth) {
        this.cfg = cfg;
        this.http = http;
        this.auth = auth;
    }
    async call(url, opts = {}) {
        const mode = opts.auth ?? 'none';
        const run = (cookie) => this.http.send(url, { ...opts, cookie });
        let cookie = null;
        if (mode !== 'none')
            cookie = await this.auth.getCookie(mode === 'required');
        let payload = await run(cookie);
        if (mode !== 'none' && this.cfg.refresh.onAuthErrorRefresh && (0, errors_1.isLoginRequired)(payload)) {
            const fresh = await this.auth.handleAuthError();
            if (fresh)
                payload = await run(fresh);
        }
        if ((0, errors_1.isLoginRequired)(payload)) {
            const code = payload?.code;
            throw new errors_1.QQMusicError('QQ_AUTH_REQUIRED', '该接口需要 QQ 音乐登录态（或登录态已失效）', { upstreamCode: code });
        }
        return payload;
    }
}
exports.Cgi = Cgi;
//# sourceMappingURL=transport.js.map