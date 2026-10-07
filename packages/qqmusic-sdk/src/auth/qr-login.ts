import type { Cookie, ResolvedConfig } from '../types';
import { QQMusicError } from '../errors';

export type QrLoginType = 'qq' | 'wx';
export type QrLoginState = 'pending' | 'scanned' | 'confirmed' | 'expired';

export interface QrLoginStart {
  type: QrLoginType;
  /** 供后续 check 使用的不透明 token（QQ 为 qrsig，微信为 uuid） */
  token: string;
  /** data:image/...;base64,... 可直接 <img src> */
  image: string;
}

export interface QrLoginResult {
  state: QrLoginState;
  cookie?: Cookie;
  message?: string;
}

/* --------------------------- 纯函数（可单测） --------------------------- */

/** QQ ptlogin 的 hash33：ptqrtoken = hash33(qrsig) */
export function hash33(t: string): number {
  let e = 0;
  for (let n = 0, o = t.length; n < o; ++n) e += (e << 5) + t.charCodeAt(n);
  return 2147483647 & e;
}

/** g_tk = hash(p_skey) */
export function getGtk(pSkey: string): number {
  let hash = 5381;
  for (let i = 0; i < pSkey.length; i++) hash += (hash << 5) + pSkey.charCodeAt(i);
  return hash & 2147483647;
}

export function getGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    })
    .toUpperCase();
}

export function parseSetCookie(header: string | null | undefined): string[] {
  if (!header) return [];
  const out: string[] = [];
  for (const part of header.split(/,(?=\s*[a-zA-Z_]+=)/)) {
    const pair = part.split(';')[0].trim();
    if (pair.includes('=') && pair.split('=')[1]) out.push(pair);
  }
  return out;
}

/** token 里同时编码 qrsig 和 login_sig（扫码轮询需要） */
export function encodeToken(obj: Record<string, string>): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
export function decodeToken(token: string): Record<string, string> {
  try {
    const obj = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (obj && typeof obj === 'object') return obj as Record<string, string>;
  } catch {
    /* 兼容纯 qrsig */
  }
  return { q: token, s: '' };
}

/* ------------------------------- 内部工具 ------------------------------- */

const QQ_APPID = '716027609';
const QQ_3RD_AID = '100497308';
const QQ_U1 = 'https://graph.qq.com/oauth2.0/login_jump';
const WX_APPID = 'wx48db31d50e334801';

class CookieJar {
  readonly map = new Map<string, string>();
  absorb(header: string | null | undefined): void {
    for (const pair of parseSetCookie(header)) {
      const i = pair.indexOf('=');
      this.map.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }
  header(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function readSetCookie(res: Response): string {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie().join(', ');
  return res.headers.get('set-cookie') ?? '';
}

function toCookie(jar: CookieJar, data: Record<string, unknown>): Cookie {
  const obj = Object.fromEntries(jar.map.entries());
  const musickey = String(data.musickey ?? obj.qqmusic_key ?? obj.qm_keyst ?? '');
  const rawUin = String(data.uin ?? data.musicid ?? obj.uin ?? obj.qqmusic_uin ?? '');
  const uin = rawUin.replace(/\D/g, '') || rawUin;
  if (!uin || !musickey) throw new QQMusicError('QQ_UPSTREAM', '登录响应缺少 uin 或 musickey');
  return {
    ...obj,
    uin,
    qqmusic_key: musickey,
    qm_keyst: musickey,
    ...(data.loginType !== undefined ? { tmeLoginType: String(data.loginType) } : {}),
    ...(data.encryptUin ? { euin: String(data.encryptUin) } : {}),
  };
}

/**
 * QQ 音乐扫码登录（QQ / 微信两套流程）。
 * - 每用户独立：start 拿二维码，前端展示，轮询 check，confirmed 后得到该用户的 Cookie。
 * - 参考 @sansenjian/qq-music-api 的 getUserQr/checkUserQr 实现。
 */
export class QrLogin {
  constructor(private readonly cfg: ResolvedConfig) {}

  async start(type: QrLoginType): Promise<QrLoginStart> {
    return type === 'wx' ? this.startWx() : this.startQq();
  }

  async check(type: QrLoginType, token: string, signal?: AbortSignal): Promise<QrLoginResult> {
    return type === 'wx' ? this.checkWx(token, signal) : this.checkQq(token, signal);
  }

  /* ------------------------------- QQ ------------------------------- */

  private async startQq(): Promise<QrLoginStart> {
    const loginSig = await this.fetchLoginSig();
    const url =
      `https://ssl.ptlogin2.qq.com/ptqrshow?appid=${QQ_APPID}&e=2&l=M&s=3&d=72&v=4&t=${Math.random()}` +
      `&daid=383&pt_3rd_aid=${QQ_3RD_AID}&u1=${encodeURIComponent(QQ_U1)}` +
      (loginSig ? `&login_sig=${encodeURIComponent(loginSig)}` : '');
    const res = await this.cfg.fetchImpl(url, { headers: { ...this.cfg.http.headers, Referer: 'https://xui.ptlogin2.qq.com/' } });
    const buf = Buffer.from(await res.arrayBuffer());
    const jar = new CookieJar();
    jar.absorb(readSetCookie(res));
    const qrsig = jar.map.get('qrsig');
    if (!qrsig) throw new QQMusicError('QQ_UPSTREAM', '获取 QQ 登录二维码失败（无 qrsig）');
    return { type: 'qq', token: encodeToken({ q: qrsig, s: loginSig }), image: `data:image/png;base64,${buf.toString('base64')}` };
  }

  /** 访问 xlogin 页拿 login_sig（ptqrlogin 反爬参数），失败则返回空串 */
  private async fetchLoginSig(): Promise<string> {
    try {
      const url =
        `https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=${QQ_APPID}&daid=383&style=33&hide_title_bar=1&low_login=0` +
        `&qlogin_auto_login=1&no_verifyimg=1&link_target=blank&appcustomin=1` +
        `&proxy_url=${encodeURIComponent('https://y.qq.com/proxy.html')}&s_url=${encodeURIComponent(QQ_U1)}&target=self`;
      const res = await this.cfg.fetchImpl(url, { headers: { ...this.cfg.http.headers, Referer: 'https://y.qq.com/' } });
      const jar = new CookieJar();
      jar.absorb(readSetCookie(res));
      const body = await res.text();
      const m = body.match(/login_sig\s*[:=]\s*"?([^";\s]+)"?/);
      return jar.map.get('pt_login_sig') ?? jar.map.get('login_sig') ?? (m ? m[1] : '');
    } catch {
      return '';
    }
  }

  private async checkQq(token: string, signal?: AbortSignal): Promise<QrLoginResult> {
    const { q: qrsig, s: loginSig } = decodeToken(token);
    const jar = new CookieJar();
    jar.map.set('qrsig', qrsig);
    const ptqrtoken = hash33(qrsig);
    const pollUrl =
      `https://ssl.ptlogin2.qq.com/ptqrlogin?u1=${encodeURIComponent(QQ_U1)}&ptqrtoken=${ptqrtoken}` +
      `&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-${Date.now()}&js_ver=23111510&js_type=1` +
      `&login_sig=${encodeURIComponent(loginSig ?? '')}&pt_uistyle=40&aid=${QQ_APPID}&daid=383&pt_3rd_aid=${QQ_3RD_AID}&pt_js_version=v1.48.1`;

    const res = await this.cfg.fetchImpl(pollUrl, { headers: { ...this.cfg.http.headers, Cookie: jar.header() }, signal });
    jar.absorb(readSetCookie(res));
    const text = await res.text();
    if (text.includes('已失效')) return { state: 'expired' };
    if (!text.includes('登录成功')) return { state: 'pending' };

    const urlMatch = text.match(/'((?:https?|ftp):\/\/[^\s']+)'/);
    if (!urlMatch) throw new QQMusicError('QQ_UPSTREAM', 'QQ 登录：无法解析跳转地址');

    const step2 = await this.cfg.fetchImpl(urlMatch[1], {
      redirect: 'manual',
      headers: { ...this.cfg.http.headers, Cookie: jar.header() },
      signal,
    });
    jar.absorb(readSetCookie(step2));
    const pSkey = jar.map.get('p_skey');
    if (!pSkey) throw new QQMusicError('QQ_UPSTREAM', 'QQ 登录：未拿到 p_skey');
    const gtk = getGtk(pSkey);

    // 换取 code
    const form = new URLSearchParams({
      response_type: 'code',
      client_id: QQ_3RD_AID,
      redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/',
      scope: 'get_user_info,get_app_friends',
      state: 'state',
      switch: '',
      from_ptlogin: '1',
      src: '1',
      update_auth: '1',
      openapi: '1010_1030',
      g_tk: String(gtk),
      auth_time: new Date().toString(),
      ui: getGuid(),
    });
    const authRes = await this.cfg.fetchImpl('https://graph.qq.com/oauth2.0/authorize', {
      method: 'POST',
      redirect: 'manual',
      body: form,
      headers: { ...this.cfg.http.headers, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.header() },
      signal,
    });
    jar.absorb(readSetCookie(authRes));
    const location = authRes.headers.get('location') ?? '';
    const codeMatch = location.match(/[?&]code=([^&]+)/);
    if (!codeMatch) throw new QQMusicError('QQ_UPSTREAM', 'QQ 登录：未拿到 code');

    // code -> musickey
    const body = JSON.stringify({
      comm: { g_tk: gtk, platform: 'yqq', ct: 24, cv: 0 },
      req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code: codeMatch[1] } },
    });
    const loginRes = await this.cfg.fetchImpl('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      body,
      headers: { ...this.cfg.http.headers, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.header() },
      signal,
    });
    jar.absorb(readSetCookie(loginRes));
    const json = (await loginRes.json().catch(() => null)) as { req?: { data?: Record<string, unknown> } } | null;
    return { state: 'confirmed', cookie: toCookie(jar, json?.req?.data ?? {}) };
  }

  /* ------------------------------- 微信 ------------------------------- */

  private async startWx(): Promise<QrLoginStart> {
    const redirect = 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/';
    const page = await this.cfg.fetchImpl(
      `https://open.weixin.qq.com/connect/qrconnect?appid=${WX_APPID}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=snsapi_login&state=qqmusic`,
      { headers: { ...this.cfg.http.headers, Referer: 'https://y.qq.com/' } },
    );
    const html = await page.text();
    const m = html.match(/connect\/qrcode\/([\w=-]{8,})/) ?? html.match(/"uuid"\s*:\s*"([\w=-]{8,})"/);
    if (!m) throw new QQMusicError('QQ_UPSTREAM', '获取微信登录二维码失败（无 uuid）');
    const uuid = m[1];
    const img = await this.cfg.fetchImpl(`https://open.weixin.qq.com/connect/qrcode/${uuid}`, {
      headers: { ...this.cfg.http.headers, Referer: 'https://open.weixin.qq.com/connect/qrconnect' },
    });
    const buf = Buffer.from(await img.arrayBuffer());
    return { type: 'wx', token: uuid, image: `data:image/jpeg;base64,${buf.toString('base64')}` };
  }

  private async checkWx(uuid: string, signal?: AbortSignal): Promise<QrLoginResult> {
    const res = await this.cfg.fetchImpl(`https://lp.open.weixin.qq.com/connect/l/qrconnect?uuid=${encodeURIComponent(uuid)}&_=${Date.now()}`, {
      headers: { ...this.cfg.http.headers, Referer: 'https://open.weixin.qq.com/' },
      signal,
    });
    const text = await res.text();
    const m = text.match(/window\.wx_errcode=(\d+);window\.wx_code='([^']*)'/);
    if (!m) return { state: 'pending' };
    const errcode = m[1];
    const code = m[2];
    if (errcode === '405' && code) {
      const loginRes = await this.cfg.fetchImpl('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        body: JSON.stringify({
          comm: { tmeLoginType: 1, ct: 24, cv: 0, platform: 'yqq' },
          req: { module: 'music.login.LoginServer', method: 'Login', param: { code, strAppid: WX_APPID } },
        }),
        headers: { ...this.cfg.http.headers, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://y.qq.com/' },
        signal,
      });
      const jar = new CookieJar();
      jar.absorb(readSetCookie(loginRes));
      const json = (await loginRes.json().catch(() => null)) as { req?: { data?: Record<string, unknown> } } | null;
      return { state: 'confirmed', cookie: toCookie(jar, json?.req?.data ?? {}) };
    }
    if (errcode === '402') return { state: 'scanned' };
    if (errcode === '408') return { state: 'pending' };
    if (errcode === '404' || errcode === '403') return { state: 'expired' };
    return { state: 'pending' };
  }
}
