"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUALITY_FILE = void 0;
exports.buildVkeyFile = buildVkeyFile;
exports.normalizeTrackInfo = normalizeTrackInfo;
exports.fetchSongDetailRaw = fetchSongDetailRaw;
exports.fetchSongUrlRaw = fetchSongUrlRaw;
const errors_1 = require("../errors");
const helpers_1 = require("./helpers");
const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
/** 音质 -> vkey 文件名前缀/后缀 */
exports.QUALITY_FILE = {
    m4a: { s: 'C400', e: '.m4a' },
    '128': { s: 'M500', e: '.mp3' },
    '320': { s: 'M800', e: '.mp3' },
    ape: { s: 'A000', e: '.ape' },
    flac: { s: 'F000', e: '.flac' },
};
/** 拼 vkey 请求的文件名：前缀 + songmid + media_mid + 后缀 */
function buildVkeyFile(songmid, mediaId, quality) {
    const { s, e } = exports.QUALITY_FILE[quality];
    return `${s}${songmid}${mediaId || songmid}${e}`;
}
function normalizeTrackInfo(ti, includeRaw) {
    const file = ti.file ?? {};
    const size128 = (0, helpers_1.num)(file.size_128mp3) || (0, helpers_1.num)(file.size128);
    const size320 = (0, helpers_1.num)(file.size_320mp3) || (0, helpers_1.num)(file.size320);
    const sizeflac = (0, helpers_1.num)(file.size_flac) || (0, helpers_1.num)(file.sizeflac);
    const sizeape = (0, helpers_1.num)(file.size_ape) || (0, helpers_1.num)(file.sizeape);
    const size24aac = (0, helpers_1.num)(file.size_24aac);
    const albumMid = ti.album?.mid;
    const playable = size128 + size320 + sizeflac + sizeape > 0;
    return {
        source: 'qqmusic',
        id: (0, helpers_1.str)(ti.id),
        mid: (0, helpers_1.str)(ti.mid),
        mediaMid: (0, helpers_1.str)(file.media_mid),
        name: (0, helpers_1.str)(ti.title) || (0, helpers_1.str)(ti.name),
        artists: (ti.singer ?? []).map((x) => x.name).filter((x) => Boolean(x)),
        album: albumMid ? { id: (0, helpers_1.str)(ti.album?.id), mid: albumMid, name: (0, helpers_1.str)(ti.album?.name) } : null,
        durationMs: (0, helpers_1.num)(ti.interval) * 1000,
        coverUrl: (0, helpers_1.coverUrl)(albumMid),
        pay: { playable, downloadable: true, priceTrack: null },
        qualities: (0, helpers_1.inferQualities)({ m4a: size24aac, s128: size128, s320: size320, flac: sizeflac, ape: sizeape }),
        ...(includeRaw ? { raw: ti } : {}),
    };
}
/** 歌曲详情（匿名可用，cookie 按需带上） */
async function fetchSongDetailRaw(cgi, songmid, signal) {
    const data = { songinfo: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_mid: songmid } } };
    const j = await cgi.call(MUSICU, {
        query: { format: 'json', data: JSON.stringify(data) },
        auth: 'optional',
        signal,
    });
    const ti = j?.songinfo?.data?.track_info;
    if (!ti)
        throw new errors_1.QQMusicError('QQ_NOT_FOUND', `未找到歌曲 ${songmid}`, { upstreamCode: j?.songinfo?.code });
    return ti;
}
/** 取播放直链（需登录态；uin/authst 由调用方从该用户 cookie 传入） */
async function fetchSongUrlRaw(cgi, p, signal) {
    const data = {
        req_0: {
            module: 'vkey.GetVkeyServer',
            method: 'CgiGetVkey',
            param: {
                filename: [buildVkeyFile(p.songmid, p.mediaId, p.quality)],
                guid: String(Math.floor(Math.random() * 1e7)),
                songmid: [p.songmid],
                songtype: [0],
                uin: p.uin,
                loginflag: 1,
                platform: '20',
            },
        },
        comm: { uin: p.uin, format: 'json', ct: 19, cv: 0, authst: p.authst },
    };
    const j = await cgi.call(MUSICU, { query: { format: 'json', data: JSON.stringify(data) }, auth: 'required', signal });
    const r0 = j?.req_0;
    if (r0?.code === 104009 || r0?.data?.retcode === 104009) {
        throw new errors_1.QQMusicError('QQ_TOKEN_EXPIRED', '登录态已失效（104009）');
    }
    const purl = r0?.data?.midurlinfo?.[0]?.purl;
    if (!purl)
        throw new errors_1.QQMusicError('QQ_UNSUPPORTED', '该音质无直链（VIP/版权或音质不可用）', { upstreamCode: r0?.code });
    const sip = r0?.data?.sip ?? [];
    const domain = sip.find((x) => !x.startsWith('http://ws')) ?? sip[0] ?? 'http://ws.stream.qqmusic.qq.com/';
    return `${domain}${purl}`;
}
//# sourceMappingURL=song.js.map