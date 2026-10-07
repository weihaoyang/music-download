import type { Cookie, ResolvedConfig } from '../types';
/**
 * 续期：拿当前 musicKey 调 QQLogin 换新 key。
 * 注意：实测「浏览器 cookie」与「扫码 cookie」都会返回 r1.code=10006（缺少可续期的 refresh token），
 * 因此该实现即使正确也常失败；「不过期」建议依赖常驻客户端镜像。
 * 该实现无全局状态，cookie 按调用传入，支持多用户。
 */
export declare function refreshCookie(cfg: ResolvedConfig, cookie: Cookie): Promise<Cookie>;
//# sourceMappingURL=refresh.d.ts.map