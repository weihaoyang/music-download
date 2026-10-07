"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeProfile = normalizeProfile;
exports.userProfile = userProfile;
exports.normalizeUserPlaylist = normalizeUserPlaylist;
exports.userPlaylists = userPlaylists;
const errors_1 = require("../errors");
const helpers_1 = require("./helpers");
function normalizeProfile(raw, uin) {
    const root = (raw ?? {});
    const data = (root.data ?? root);
    const creator = (data.creator ?? data);
    const avatar = creator.headpic ?? creator.headurl ?? data.headpic;
    return {
        source: 'qqmusic',
        uin,
        nickname: (0, helpers_1.str)(creator.nick ?? creator.hostname ?? data.nick) || null,
        avatarUrl: avatar ? String(avatar) : null,
        vip: (0, helpers_1.num)(creator.isvip ?? data.isvip) === 1,
    };
}
/** 个人资料（需登录态） */
async function userProfile(cgi, uin, signal) {
    const url = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg';
    const j = await cgi.call(url, {
        query: { cid: 205360838, userid: uin, reqfrom: 1, g_tk: 5381, format: 'json' },
        auth: 'required',
        signal,
    });
    if (j && j.code !== undefined && (0, helpers_1.num)(j.code) !== 0) {
        throw new errors_1.QQMusicError('QQ_UPSTREAM', `获取资料失败：${JSON.stringify(j).slice(0, 150)}`, { upstreamCode: (0, helpers_1.num)(j.code) });
    }
    return normalizeProfile(j, uin);
}
function normalizeUserPlaylist(x) {
    const cover = x.diss_cover ?? x.logo;
    return {
        source: 'qqmusic',
        id: (0, helpers_1.str)(x.dirid ?? x.dissid ?? x.tid),
        name: (0, helpers_1.str)(x.diss_name ?? x.dissname),
        coverUrl: cover ? String(cover) : null,
        songCount: (0, helpers_1.num)(x.song_cnt ?? x.songnum),
    };
}
/** 我创建的歌单（需登录态） */
async function userPlaylists(cgi, uin, signal) {
    const url = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss';
    const j = await cgi.call(url, {
        query: {
            hostUin: 0,
            hostuin: uin,
            sin: 0,
            size: 200,
            g_tk: 5381,
            loginUin: 0,
            format: 'json',
            inCharset: 'utf8',
            outCharset: 'utf-8',
            notice: 0,
            platform: 'yqq.json',
            needNewCode: 0,
        },
        auth: 'required',
        headers: { Referer: 'https://y.qq.com/portal/profile.html' },
        signal,
    });
    if ((0, helpers_1.num)(j?.code) === 4000)
        return []; // 不公开歌单
    const list = j?.data?.disslist ?? [];
    return list.map(normalizeUserPlaylist);
}
//# sourceMappingURL=user.js.map