import type { Cookie, ResolvedConfig } from '../types';
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
/** QQ ptlogin 的 hash33：ptqrtoken = hash33(qrsig) */
export declare function hash33(t: string): number;
/** g_tk = hash(p_skey) */
export declare function getGtk(pSkey: string): number;
export declare function getGuid(): string;
export declare function parseSetCookie(header: string | null | undefined): string[];
/** token 里同时编码 qrsig 和 login_sig（扫码轮询需要） */
export declare function encodeToken(obj: Record<string, string>): string;
export declare function decodeToken(token: string): Record<string, string>;
/**
 * QQ 音乐扫码登录（QQ / 微信两套流程）。
 * - 每用户独立：start 拿二维码，前端展示，轮询 check，confirmed 后得到该用户的 Cookie。
 * - 参考 @sansenjian/qq-music-api 的 getUserQr/checkUserQr 实现。
 */
export declare class QrLogin {
    private readonly cfg;
    constructor(cfg: ResolvedConfig);
    start(type: QrLoginType): Promise<QrLoginStart>;
    check(type: QrLoginType, token: string, signal?: AbortSignal): Promise<QrLoginResult>;
    private startQq;
    /** 访问 xlogin 页拿 login_sig（ptqrlogin 反爬参数），失败则返回空串 */
    private fetchLoginSig;
    private checkQq;
    private startWx;
    private checkWx;
}
//# sourceMappingURL=qr-login.d.ts.map