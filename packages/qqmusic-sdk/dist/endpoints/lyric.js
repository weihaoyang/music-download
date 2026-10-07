"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchLyric = fetchLyric;
const errors_1 = require("../errors");
/** 有些返回仍是 base64（即使带了 nobase64=1），检测后解码 */
function maybeBase64(s) {
    const v = s ?? '';
    if (!v)
        return '';
    if (!v.includes('[') && /^[A-Za-z0-9+/=\s]+$/.test(v) && v.replace(/\s/g, '').length % 4 === 0) {
        try {
            return Buffer.from(v, 'base64').toString('utf8');
        }
        catch {
            return v;
        }
    }
    return v;
}
/** 取歌词（QQ 音乐，匿名可用） */
async function fetchLyric(cgi, songmid, signal) {
    if (!songmid)
        throw new errors_1.QQMusicError('QQ_CONFIG', 'songmid 不能为空');
    const url = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
    const j = await cgi.call(url, {
        query: {
            songmid,
            format: 'json',
            nobase64: 1,
            g_tk: 5381,
            loginUin: 0,
            hostUin: 0,
            inCharset: 'utf8',
            outCharset: 'utf-8',
            notice: 0,
            platform: 'yqq',
            needNewCode: 0,
        },
        auth: 'optional',
        headers: { Referer: 'https://y.qq.com/' },
        signal,
    });
    if (!j || (j.retcode !== 0 && j.code !== 0)) {
        throw new errors_1.QQMusicError('QQ_UPSTREAM', `获取歌词失败：${JSON.stringify(j).slice(0, 120)}`);
    }
    return { lyric: maybeBase64(j.lyric), trans: j.trans ? maybeBase64(j.trans) : null };
}
//# sourceMappingURL=lyric.js.map