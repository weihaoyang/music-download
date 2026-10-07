"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchResource = void 0;
const search_1 = require("../endpoints/search");
const playlist_1 = require("../endpoints/playlist");
const quick_1 = require("../endpoints/quick");
function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, Math.floor(n)));
}
class SearchResource {
    constructor(http, cgi, cfg) {
        this.http = http;
        this.cgi = cgi;
        this.cfg = cfg;
    }
    /** 搜索歌曲（匿名，不需要登录态） */
    async songs(params) {
        const page = clamp(params.page ?? 1, 1, 1000);
        const limit = clamp(params.limit ?? 20, 1, 50);
        const { items, total } = await (0, search_1.searchSongs)(this.http, params.keyword, page, limit, this.cfg.includeRaw, params.signal);
        return { items, page, limit, total, hasMore: items.length === limit };
    }
    /** 搜索歌单（匿名） */
    async playlists(params) {
        const page = clamp(params.page ?? 1, 1, 1000);
        const limit = clamp(params.limit ?? 20, 1, 50);
        const { items, total } = await (0, playlist_1.searchPlaylists)(this.cgi, params.keyword, page, limit, params.signal);
        return { items, page, limit, total, hasMore: items.length === limit };
    }
    /** 快速联想（匿名） */
    async quick(params) {
        return (0, quick_1.quickSearch)(this.cgi, params.keyword, params.signal);
    }
}
exports.SearchResource = SearchResource;
//# sourceMappingURL=search.js.map