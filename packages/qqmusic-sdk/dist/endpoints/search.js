"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSearchItem = normalizeSearchItem;
exports.searchSongs = searchSongs;
const errors_1 = require("../errors");
const helpers_1 = require("./helpers");
function normalizeSearchItem(s, includeRaw) {
    const albumMid = s.albummid;
    const pay = s.pay ?? {};
    const playable = !((0, helpers_1.num)(pay.payplay) === 1);
    return {
        source: 'qqmusic',
        id: (0, helpers_1.str)(s.songid),
        mid: (0, helpers_1.str)(s.songmid),
        mediaMid: '',
        name: (0, helpers_1.str)(s.songname),
        artists: (s.singer ?? []).map((x) => x.name).filter((x) => Boolean(x)),
        album: albumMid ? { id: (0, helpers_1.str)(s.albumid), mid: albumMid, name: (0, helpers_1.str)(s.albumname) } : null,
        durationMs: (0, helpers_1.num)(s.interval) * 1000,
        coverUrl: (0, helpers_1.coverUrl)(albumMid),
        pay: { playable, downloadable: !((0, helpers_1.num)(pay.paydownload) === 1), priceTrack: pay.paytrackprice ?? null },
        qualities: (0, helpers_1.inferQualities)({ s128: s.size128, s320: s.size320, flac: s.sizeflac, ape: s.sizeape }),
        ...(includeRaw ? { raw: s } : {}),
    };
}
/**
 * 自研搜索：走 search_for_qq_cp（qq-music-api 的 client_search_cp 已失效且会抛未捕获异常）。
 * 匿名可用，不需要登录态。
 */
async function searchSongs(http, keyword, page, limit, includeRaw, signal) {
    if (!keyword)
        throw new errors_1.QQMusicError('QQ_CONFIG', 'keyword 不能为空');
    const params = new URLSearchParams({
        format: 'json',
        n: String(limit),
        p: String(page),
        w: keyword,
        cr: '1',
        g_tk: '5381',
        t: '0',
    });
    const url = `http://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?${params.toString()}`;
    const json = await http.getJson(url, {
        signal,
    });
    const song = json?.data?.song;
    if (!song) {
        throw new errors_1.QQMusicError('QQ_UPSTREAM', `搜索返回异常：${JSON.stringify(json).slice(0, 200)}`, {
            upstreamCode: json?.code,
        });
    }
    const list = song.list ?? [];
    return {
        items: list.map((x) => normalizeSearchItem(x, includeRaw)),
        total: typeof song.totalnum === 'number' ? song.totalnum : null,
    };
}
//# sourceMappingURL=search.js.map