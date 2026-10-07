import type { Cookie, ResolvedConfig } from '../types';
import { QQMusicError } from '../errors';
import { sign } from '../upstream';
import { HttpClient } from '../transport';

interface RefreshResponse {
  req1?: { code?: number; data?: { musickey?: string } };
  code?: number;
}

/**
 * 续期：拿当前 musicKey 调 QQLogin 换新 key。
 * 注意：实测「浏览器 cookie」与「扫码 cookie」都会返回 r1.code=10006（缺少可续期的 refresh token），
 * 因此该实现即使正确也常失败；「不过期」建议依赖常驻客户端镜像。
 * 该实现无全局状态，cookie 按调用传入，支持多用户。
 */
export async function refreshCookie(cfg: ResolvedConfig, cookie: Cookie): Promise<Cookie> {
  const seed = cookie.qm_keyst || cookie.qqmusic_key;
  if (!cookie.uin || !seed) {
    throw new QQMusicError('QQ_AUTH_REQUIRED', 'cookie 缺少 uin 或 musicKey，无法续期');
  }

  const data = {
    req1: {
      module: 'QQConnectLogin.LoginServer',
      method: 'QQLogin',
      param: { expired_in: 7776000, musicid: cookie.uin, musickey: seed },
    },
  };
  const url =
    `https://u6.y.qq.com/cgi-bin/musics.fcg?sign=${sign(data)}&format=json&inCharset=utf8&outCharset=utf-8` +
    `&data=${encodeURIComponent(JSON.stringify(data))}`;

  const http = new HttpClient(cfg);
  let j: RefreshResponse;
  try {
    j = await http.send<RefreshResponse>(url, { cookie });
  } catch (e) {
    throw new QQMusicError('QQ_REFRESH_FAILED', `续期请求失败：${(e as Error)?.message ?? String(e)}`, { cause: e });
  }

  const newKey = j?.req1?.data?.musickey;
  if (!newKey) {
    throw new QQMusicError('QQ_REFRESH_FAILED', `续期未返回新 musickey（code=${j?.req1?.code ?? j?.code}）`);
  }
  return { ...cookie, qqmusic_key: String(newKey), qm_keyst: String(newKey) };
}
