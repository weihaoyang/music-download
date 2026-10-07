"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaylistsResource = void 0;
const errors_1 = require("../errors");
const playlist_1 = require("../endpoints/playlist");
const mutation_1 = require("../endpoints/mutation");
class PlaylistsResource {
    constructor(cgi, auth, http, cfg) {
        this.cgi = cgi;
        this.auth = auth;
        this.http = http;
        this.cfg = cfg;
    }
    /** 解析歌单（需登录态；匿名会被 QQ 拒绝） */
    async detail(params) {
        const page = Math.max(1, Math.floor(params.page ?? 1));
        const limit = Math.max(1, Math.min(Math.floor(params.limit ?? 100), 1000));
        return (0, playlist_1.playlistDetail)(this.cgi, params.disstid, page, limit, this.cfg.includeRaw, params.signal);
    }
    /** 把「歌单 ID / 完整链接 / 分享短链」解析为 disstid */
    async resolve(params) {
        const disstid = await (0, playlist_1.resolvePlaylistInput)(this.http, params.input, params.signal);
        return { disstid };
    }
    /**
     * 导入外部歌单：解析链接 -> 拉取并归一化歌曲。
     * 返回的 `songs[].mid` 可直接用于 create/addSongs。
     */
    async importPlaylist(params) {
        const disstid = params.disstid || (params.url ? await (0, playlist_1.resolvePlaylistInput)(this.http, params.url, params.signal) : '');
        if (!disstid)
            throw new errors_1.QQMusicError('QQ_CONFIG', '需要提供 url 或 disstid');
        const limit = Math.max(1, Math.min(Math.floor(params.limit ?? 1000), 5000));
        return (0, playlist_1.playlistDetail)(this.cgi, disstid, 1, limit, this.cfg.includeRaw, params.signal);
    }
    /**
     * 克隆外部歌单到「我的歌单」：
     * - 给了 dirid -> 直接加入该歌单；
     * - 否则用 name 新建歌单并加入。
     * 需要登录态。
     */
    async clone(params) {
        const detail = await this.importPlaylist({
            url: params.url,
            disstid: params.disstid,
            limit: params.limit,
            signal: params.signal,
        });
        const songmids = detail.songs.map((s) => s.mid).filter((x) => Boolean(x));
        if (params.dirid !== undefined) {
            await this.addSongs({ dirid: params.dirid, songmids, signal: params.signal });
            return {
                source: 'qqmusic',
                id: String(params.dirid),
                name: detail.name,
                coverUrl: detail.coverUrl,
                songCount: songmids.length,
            };
        }
        return this.create({ name: params.name, songmids, signal: params.signal });
    }
    /** 把歌曲加入歌单（写操作，需登录态） */
    async addSongs(params) {
        const r = await (0, mutation_1.addSongsToPlaylist)(this.cgi, this.auth, params.dirid, params.songmids, params.songIds, params.signal);
        return { dirid: String(params.dirid), ...r };
    }
    /** 创建歌单（写操作，需登录态）；如带 songmids 则创建后一并加入 */
    async create(params) {
        const { dirid } = await (0, mutation_1.createPlaylist)(this.cgi, this.auth, params.name, params.signal);
        if (params.songmids?.length) {
            await (0, mutation_1.addSongsToPlaylist)(this.cgi, this.auth, dirid, params.songmids, undefined, params.signal);
        }
        return {
            source: 'qqmusic',
            id: dirid,
            name: params.name,
            coverUrl: null,
            songCount: params.songmids?.length ?? 0,
        };
    }
    /** 删除歌单（写操作，需登录态） */
    async delete(params) {
        await (0, mutation_1.deletePlaylist)(this.cgi, this.auth, params.dirid, params.signal);
    }
}
exports.PlaylistsResource = PlaylistsResource;
//# sourceMappingURL=playlists.js.map