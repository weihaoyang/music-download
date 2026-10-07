import type { Cookie, Logger, QQMusicClientConfig, ResolvedConfig } from './types';

export const DEFAULT_REFRESH = {
  /** 30 天。QQLogin 换新的 key 默认有效期约 90 天，30 天续一次留足余量。 */
  intervalMs: 30 * 24 * 60 * 60 * 1000,
  expiringThresholdMs: 7 * 24 * 60 * 60 * 1000,
  onAuthErrorRefresh: true,
  maxAttempts: 3,
};

export const DEFAULT_HTTP = {
  timeoutMs: 10_000,
  retries: 2,
  throttleMs: 0,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Referer: 'https://y.qq.com/',
  },
};

const noop = (): void => undefined;
export const DEFAULT_LOGGER: Logger = { debug: noop, info: noop, warn: noop, error: noop };

/** 解析 cookie 字符串 / 对象为规范 Cookie；uin 必填（可从 wxuin 派生） */
export function parseCookie(input: string | Cookie): Cookie {
  if (typeof input === 'string') {
    const obj: Record<string, string> = {};
    input
      .split(/;\s*/)
      .filter(Boolean)
      .forEach((pair) => {
        const eq = pair.indexOf('=');
        if (eq <= 0) return;
        obj[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      });
    return finalizeCookie(obj);
  }
  return finalizeCookie({ ...input } as Record<string, string>);
}

function finalizeCookie(obj: Record<string, string>): Cookie {
  if (Number(obj.login_type) === 2 && obj.wxuin) obj.uin = obj.wxuin;
  obj.uin = String(obj.uin ?? '').replace(/\D/g, '');
  if (!obj.uin) throw new Error('cookie 缺少 uin（也无法从 wxuin 派生）');
  return obj as Cookie;
}

export function resolveConfig(config: QQMusicClientConfig = {}): ResolvedConfig {
  const refresh = { ...DEFAULT_REFRESH, ...(config.refresh ?? {}) };
  const http = { ...DEFAULT_HTTP, ...(config.http ?? {}), headers: { ...DEFAULT_HTTP.headers, ...(config.http?.headers ?? {}) } };
  const fetchImpl = config.fetchImpl ?? (globalThis as unknown as { fetch: typeof fetch }).fetch;
  if (!fetchImpl) throw new Error('运行环境缺少 fetch，请通过 config.fetchImpl 注入');
  return {
    tokenStore: config.tokenStore,
    seedCookie: config.seedCookie !== undefined ? parseCookie(config.seedCookie) : undefined,
    cookieProvider: config.cookieProvider,
    refresh,
    http,
    includeRaw: config.includeRaw ?? false,
    fetchImpl,
    now: config.now ?? (() => Date.now()),
    logger: config.logger ?? DEFAULT_LOGGER,
    onTokenRefreshed: config.onTokenRefreshed,
    onTokenExpired: config.onTokenExpired,
  };
}

/** 对 key 做脱敏展示 */
export function maskKey(key: string | undefined | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}
