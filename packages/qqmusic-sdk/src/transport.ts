import { Readable } from 'stream';
import type { Cookie, ResolvedConfig } from './types';
import { QQMusicError, isLoginRequired, normalizeUpstreamError } from './errors';

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cookieHeader(cookie: Cookie | null | undefined): string {
  if (!cookie) return '';
  return Object.entries(cookie)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('; ');
}

/** 解析 JSON，兼容 JSONP 包装（callback(...) / MusicJsonCallback(...)） */
function parseBody(text: string): unknown {
  const t = text.trim();
  const m = t.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
  return JSON.parse(m ? m[1] : t);
}

/** 通用 HTTP 客户端：超时 / 重试 / cookie 注入 / JSONP 兼容。无任何全局状态。 */
export class HttpClient {
  constructor(private readonly cfg: ResolvedConfig) {}

  async send<T>(url: string, opts: SendOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    let finalUrl = url;
    if (opts.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) if (v !== undefined) qs.append(k, String(v));
      finalUrl += (url.includes('?') ? '&' : '?') + qs.toString();
    }

    const headers: Record<string, string> = { ...this.cfg.http.headers, ...(opts.headers ?? {}) };
    const ch = cookieHeader(opts.cookie);
    if (ch) headers.Cookie = ch;

    let body: string | undefined;
    if (method === 'POST') {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/x-www-form-urlencoded';
      body = new URLSearchParams(Object.entries(opts.form ?? {}).map(([k, v]) => [k, String(v)])).toString();
    }

    let lastErr: QQMusicError | undefined;
    for (let attempt = 0; attempt <= this.cfg.http.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.http.timeoutMs);
      const onAbort = (): void => controller.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await this.cfg.fetchImpl(finalUrl, { method, headers, body, signal: controller.signal });
        const text = await res.text();
        if (!res.ok) {
          throw new QQMusicError('QQ_UPSTREAM', `HTTP ${res.status}`, { httpStatus: res.status, retryable: res.status >= 500 });
        }
        return parseBody(text) as T;
      } catch (e) {
        const err = normalizeUpstreamError(e);
        lastErr = err;
        if (attempt < this.cfg.http.retries && err.retryable) {
          await sleep(200 * 2 ** attempt);
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }
    throw lastErr ?? new QQMusicError('QQ_UPSTREAM', '请求失败');
  }

  async getJson<T>(url: string, opts: { signal?: AbortSignal } = {}): Promise<T> {
    return this.send<T>(url, { method: 'GET', signal: opts.signal });
  }

  /** 跟随重定向取最终 URL 与页面文本（用于解析分享短链） */
  async probe(url: string, opts: { signal?: AbortSignal } = {}): Promise<{ finalUrl: string; text: string }> {
    const res = await this.cfg.fetchImpl(url, { headers: this.cfg.http.headers, redirect: 'follow', signal: opts.signal });
    let text = '';
    try {
      text = (await res.text()).slice(0, 20000);
    } catch {
      /* ignore */
    }
    return { finalUrl: res.url || url, text };
  }

  /** 下载为 Node Readable */
  async getStream(url: string, opts: { signal?: AbortSignal } = {}): Promise<Readable> {
    const res = await this.cfg.fetchImpl(url, { headers: this.cfg.http.headers, signal: opts.signal });
    if (!res.ok || !res.body) {
      throw new QQMusicError('QQ_UNSUPPORTED', `下载失败 HTTP ${res.status}`, { httpStatus: res.status });
    }
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  }
}

/** 鉴权感知的 CGI 调用：注入 cookie、登录失效自动刷新重试一次、显式登录错误归一化 */
export interface CgiCallOptions extends SendOptions {
  auth?: 'none' | 'required' | 'optional';
}

export class Cgi {
  constructor(
    private readonly cfg: ResolvedConfig,
    private readonly http: HttpClient,
    private readonly auth: AuthContext,
  ) {}

  async call<T>(url: string, opts: CgiCallOptions = {}): Promise<T> {
    const mode = opts.auth ?? 'none';
    const run = (cookie: Cookie | null): Promise<T> => this.http.send<T>(url, { ...opts, cookie });

    let cookie: Cookie | null = null;
    if (mode !== 'none') cookie = await this.auth.getCookie(mode === 'required');

    let payload = await run(cookie);
    if (mode !== 'none' && this.cfg.refresh.onAuthErrorRefresh && isLoginRequired(payload)) {
      const fresh = await this.auth.handleAuthError();
      if (fresh) payload = await run(fresh);
    }
    if (isLoginRequired(payload)) {
      const code = (payload as { code?: unknown } | null)?.code;
      throw new QQMusicError('QQ_AUTH_REQUIRED', '该接口需要 QQ 音乐登录态（或登录态已失效）', { upstreamCode: code as number | undefined });
    }
    return payload;
  }
}
