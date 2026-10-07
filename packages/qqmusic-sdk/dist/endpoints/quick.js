"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quickSearch = quickSearch;
const errors_1 = require("../errors");
const helpers_1 = require("./helpers");
function toItem(x) {
    return {
        id: (0, helpers_1.str)(x.id),
        mid: (0, helpers_1.str)(x.mid),
        name: (0, helpers_1.str)(x.name),
        subtitle: x.singer ? String(x.singer) : null,
        coverUrl: x.pic ? String(x.pic) : null,
    };
}
/** 快速联想（smartbox，匿名可用） */
async function quickSearch(cgi, keyword, signal) {
    if (!keyword)
        throw new errors_1.QQMusicError('QQ_CONFIG', 'keyword 不能为空');
    const url = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
    const j = await cgi.call(url, {
        query: { key: keyword, g_tk: 5381, format: 'json' },
        auth: 'none',
        signal,
    });
    if (j?.code !== 0 || !j.data) {
        throw new errors_1.QQMusicError('QQ_UPSTREAM', `快速搜索失败：${JSON.stringify(j).slice(0, 150)}`, { upstreamCode: j?.code });
    }
    const pick = (key) => (j.data?.[key]?.itemlist ?? []).map(toItem);
    return { songs: pick('song'), albums: pick('album'), playlists: pick('playlist'), mvs: pick('mv') };
}
//# sourceMappingURL=quick.js.map