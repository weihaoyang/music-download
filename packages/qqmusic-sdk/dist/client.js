"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQQMusicClient = createQQMusicClient;
const config_1 = require("./config");
const token_manager_1 = require("./auth/token-manager");
const qr_login_1 = require("./auth/qr-login");
const transport_1 = require("./transport");
const search_1 = require("./resources/search");
const songs_1 = require("./resources/songs");
const playlists_1 = require("./resources/playlists");
const user_1 = require("./resources/user");
/**
 * 创建 SDK 客户端。会读取/加载登录态（seedCookie / TokenStore / CookieProvider）并启动自动续期。
 */
async function createQQMusicClient(config = {}) {
    const cfg = (0, config_1.resolveConfig)(config);
    const tokenManager = new token_manager_1.TokenManager(cfg);
    await tokenManager.init();
    const http = new transport_1.HttpClient(cfg);
    const cgi = new transport_1.Cgi(cfg, http, tokenManager);
    const qrLogin = new qr_login_1.QrLogin(cfg);
    return {
        search: new search_1.SearchResource(http, cgi, cfg),
        songs: new songs_1.SongsResource(cgi, tokenManager, http, cfg),
        playlists: new playlists_1.PlaylistsResource(cgi, tokenManager, http, cfg),
        user: new user_1.UserResource(cgi, tokenManager, cfg),
        auth: {
            status: () => Promise.resolve(tokenManager.status()),
            setCookie: (input) => tokenManager.setCookie(input),
            refresh: () => tokenManager.refresh(),
            health: () => tokenManager.health(),
            seedFromProvider: () => tokenManager.seedFromProvider(),
            startAutoRefresh: () => tokenManager.startAutoRefresh(),
            stopAutoRefresh: () => tokenManager.stopAutoRefresh(),
            login: {
                start: (type) => qrLogin.start(type),
                check: (type, token, signal) => qrLogin.check(type, token, signal),
            },
        },
        tokenManager,
    };
}
//# sourceMappingURL=client.js.map