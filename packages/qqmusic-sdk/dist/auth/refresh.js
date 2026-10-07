"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshCookie = refreshCookie;
const errors_1 = require("../errors");
const upstream_1 = require("../upstream");
const transport_1 = require("../transport");
/**
 * 续期：拿当前 musicKey 调 QQLogin 换新 key。
 * 注意：实测「浏览器 cookie」与「扫码 cookie」都会返回 r1.code=10006（缺少可续期的 refresh token），
 * 因此该实现即使正确也常失败；「不过期」建议依赖常驻客户端镜像。
 * 该实现无全局状态，cookie 按调用传入，支持多用户。
 */
async function refreshCookie(cfg, cookie) {
    const seed = cookie.qm_keyst || cookie.qqmusic_key;
    if (!cookie.uin || !seed) {
        throw new errors_1.QQMusicError('QQ_AUTH_REQUIRED', 'cookie 缺少 uin 或 musicKey，无法续期');
    }
    const data = {
        req1: {
            module: 'QQConnectLogin.LoginServer',
            method: 'QQLogin',
            param: { expired_in: 7776000, musicid: cookie.uin, musickey: seed },
        },
    };
    const url = `https://u6.y.qq.com/cgi-bin/musics.fcg?sign=${(0, upstream_1.sign)(data)}&format=json&inCharset=utf8&outCharset=utf-8` +
        `&data=${encodeURIComponent(JSON.stringify(data))}`;
    const http = new transport_1.HttpClient(cfg);
    let j;
    try {
        j = await http.send(url, { cookie });
    }
    catch (e) {
        throw new errors_1.QQMusicError('QQ_REFRESH_FAILED', `续期请求失败：${e?.message ?? String(e)}`, { cause: e });
    }
    const newKey = j?.req1?.data?.musickey;
    if (!newKey) {
        throw new errors_1.QQMusicError('QQ_REFRESH_FAILED', `续期未返回新 musickey（code=${j?.req1?.code ?? j?.code}）`);
    }
    return { ...cookie, qqmusic_key: String(newKey), qm_keyst: String(newKey) };
}
//# sourceMappingURL=refresh.js.map