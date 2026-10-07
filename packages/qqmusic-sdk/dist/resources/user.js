"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserResource = void 0;
const user_1 = require("../endpoints/user");
const playlist_1 = require("../endpoints/playlist");
class UserResource {
    constructor(cgi, auth, cfg) {
        this.cgi = cgi;
        this.auth = auth;
        this.cfg = cfg;
    }
    /** 个人资料（需登录态） */
    async profile(signal) {
        const cookie = await this.auth.getCookie(true);
        return (0, user_1.userProfile)(this.cgi, cookie?.uin ?? '', signal);
    }
    /** 我创建的歌单（需登录态） */
    async playlists(signal) {
        const cookie = await this.auth.getCookie(true);
        return (0, user_1.userPlaylists)(this.cgi, cookie?.uin ?? '', signal);
    }
    /** 「我喜欢」歌单（dirid=201，需登录态）；分页 page 从 1 起 */
    async liked(params = {}) {
        const cookie = await this.auth.getCookie(true);
        return (0, playlist_1.likedSongs)(this.cgi, { uin: cookie?.uin ?? '', authst: cookie?.qqmusic_key ?? cookie?.qm_keyst ?? '' }, params.page ?? 1, params.limit ?? 100, this.cfg.includeRaw, params.signal);
    }
}
exports.UserResource = UserResource;
//# sourceMappingURL=user.js.map