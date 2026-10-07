"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SongsResource = void 0;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const promises_2 = require("stream/promises");
const errors_1 = require("../errors");
const song_1 = require("../endpoints/song");
const lyric_1 = require("../endpoints/lyric");
/** 目标音质取不到时的降级顺序 */
const FALLBACK = {
    flac: ['flac', '320', '128'],
    ape: ['ape', 'flac', '320', '128'],
    '320': ['320', '128'],
    '128': ['128'],
    m4a: ['m4a', '320', '128'],
};
/** 无全局状态：cookie 由注入的 AuthContext（每用户一个实例）提供 */
class SongsResource {
    constructor(cgi, auth, http, cfg) {
        this.cgi = cgi;
        this.auth = auth;
        this.http = http;
        this.cfg = cfg;
    }
    /** 歌曲详情（匿名可用；含 media_mid / 可用音质） */
    async detail(params) {
        const ti = await (0, song_1.fetchSongDetailRaw)(this.cgi, params.songmid, params.signal);
        return (0, song_1.normalizeTrackInfo)(ti, this.cfg.includeRaw);
    }
    async details(list) {
        const out = [];
        for (const p of list)
            out.push(await this.detail(p));
        return out;
    }
    /** 取播放 / 下载直链（需登录态；默认逐级降级） */
    async url(params) {
        const target = params.quality ?? '320';
        const cookie = await this.auth.getCookie(true); // 无有效登录态会抛 QQ_AUTH_REQUIRED
        if (!cookie)
            throw new errors_1.QQMusicError('QQ_AUTH_REQUIRED', '需要 QQ 音乐登录态');
        const authst = cookie.qqmusic_key ?? cookie.qm_keyst ?? '';
        const uin = cookie.uin;
        let mediaId = params.mediaId;
        if (!mediaId) {
            try {
                mediaId = (await this.detail({ songmid: params.songmid, signal: params.signal })).mediaMid;
            }
            catch {
                /* 拿不到 media_mid 时退回 songmid */
            }
        }
        const order = params.preferFallback === false ? [target] : Array.from(new Set([target, ...FALLBACK[target]]));
        let lastErr;
        for (const quality of order) {
            try {
                const url = await (0, song_1.fetchSongUrlRaw)(this.cgi, { songmid: params.songmid, mediaId: mediaId || params.songmid, quality, uin, authst }, params.signal);
                return { songmid: params.songmid, quality, url, expiresAt: null };
            }
            catch (e) {
                lastErr = e;
                if (e instanceof errors_1.QQMusicError && (e.code === 'QQ_AUTH_REQUIRED' || e.code === 'QQ_TOKEN_EXPIRED'))
                    throw e;
            }
        }
        throw new errors_1.QQMusicError('QQ_UNSUPPORTED', `无法获取 ${params.songmid} 的播放直链（VIP/版权限制或音质不可用）`, {
            cause: lastErr,
        });
    }
    /** 原始音频流（Node Readable） */
    async stream(params) {
        const { url } = await this.url(params);
        return this.http.getStream(url, { signal: params.signal });
    }
    /** 歌词（匿名可用） */
    async lyric(params) {
        return (0, lyric_1.fetchLyric)(this.cgi, params.songmid, params.signal);
    }
    /** 下载到文件 */
    async downloadToFile(params) {
        const { url } = await this.url(params);
        const readable = await this.http.getStream(url, { signal: params.signal });
        await (0, promises_2.pipeline)(readable, (0, fs_1.createWriteStream)(params.destPath));
        const st = await (0, promises_1.stat)(params.destPath);
        if (st.size === 0)
            throw new errors_1.QQMusicError('QQ_UNSUPPORTED', '下载得到空文件');
        return { path: params.destPath, bytes: st.size, url };
    }
}
exports.SongsResource = SongsResource;
//# sourceMappingURL=songs.js.map