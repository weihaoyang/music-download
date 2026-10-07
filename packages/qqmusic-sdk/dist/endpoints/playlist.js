"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePlaylistBrief = normalizePlaylistBrief;
exports.searchPlaylists = searchPlaylists;
exports.normalizePlaylistSong = normalizePlaylistSong;
exports.playlistDetail = playlistDetail;
exports.likedSongs = likedSongs;
exports.extractDissId = extractDissId;
exports.resolvePlaylistInput = resolvePlaylistInput;
const errors_1 = require("../errors");
const helpers_1 = require("./helpers");
function normalizePlaylistBrief(x) {
    return {
        source: 'qqmusic',
        id: (0, helpers_1.str)(x.dissid),
        name: (0, helpers_1.str)(x.dissname),
        coverUrl: x.imgurl ? String(x.imgurl) : null,
        songCount: (0, helpers_1.num)(x.songnum ?? x.song_count),
        ...(x.creator?.name ? { creator: String(x.creator.name) } : {}),
    };
}
/** 歌单搜索：必须 remoteplace=txt.yqq.playlist 且 page_no 从 0 开始（实测） */
async function searchPlaylists(cgi, keyword, page, limit, signal) {
    if (!keyword)
        throw new errors_1.QQMusicError('QQ_CONFIG', 'keyword 不能为空');
    const url = 'https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist';
    const j = await cgi.call(url, {
        query: { remoteplace: 'txt.yqq.playlist', page_no: Math.max(0, page - 1), num_per_page: limit, query: keyword, format: 'json' },
        auth: 'none',
        signal,
    });
    if (!j || j.code !== 0 || !j.data) {
        throw new errors_1.QQMusicError('QQ_UPSTREAM', `歌单搜索失败：${JSON.stringify(j).slice(0, 150)}`, { upstreamCode: j?.code });
    }
    const list = j.data.list ?? [];
    return { items: list.map(normalizePlaylistBrief), total: typeof j.data.display_num === 'number' ? j.data.display_num : null };
}
/** 歌单里的歌曲，兼容新旧两种字段命名 */
function normalizePlaylistSong(s, includeRaw) {
    const file = (s.file ?? {});
    const album = (s.album ?? {});
    const albumMid = (0, helpers_1.str)(album.mid ?? s.albummid);
    const size128 = (0, helpers_1.num)(file.size_128mp3) || (0, helpers_1.num)(s.size128);
    const size320 = (0, helpers_1.num)(file.size_320mp3) || (0, helpers_1.num)(s.size320);
    const sizeflac = (0, helpers_1.num)(file.size_flac) || (0, helpers_1.num)(s.sizeflac);
    const sizeape = (0, helpers_1.num)(file.size_ape) || (0, helpers_1.num)(s.sizeape);
    return {
        source: 'qqmusic',
        id: (0, helpers_1.str)(s.id ?? s.songid),
        mid: (0, helpers_1.str)(s.mid ?? s.songmid),
        mediaMid: (0, helpers_1.str)(file.media_mid) || (0, helpers_1.str)(s.strMediaMid),
        name: (0, helpers_1.str)(s.title ?? s.songname ?? s.name),
        artists: (s.singer ?? []).map((x) => x.name).filter((x) => Boolean(x)),
        album: albumMid ? { id: (0, helpers_1.str)(album.id ?? s.albumid), mid: albumMid, name: (0, helpers_1.str)(album.name ?? s.albumname) } : null,
        durationMs: (0, helpers_1.num)(s.interval) * 1000,
        coverUrl: (0, helpers_1.coverUrl)(albumMid),
        pay: { playable: true, downloadable: true, priceTrack: null },
        qualities: (0, helpers_1.inferQualities)({ s128: size128, s320: size320, flac: sizeflac, ape: sizeape }),
        ...(includeRaw ? { raw: s } : {}),
    };
}
/**
 * 歌单详情。匿名会被 QQ 拒（privacy error），使用登录态走老的 CGI 端点（实测带 cookie 可返回全部歌曲）。
 */
async function playlistDetail(cgi, disstid, page, limit, includeRaw, signal) {
    const url = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';
    const j = await cgi.call(url, {
        query: {
            type: 1,
            json: 1,
            utf8: 1,
            onlysong: 0,
            disstid: String(disstid),
            format: 'json',
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
        headers: { Referer: 'https://y.qq.com/n/yqq/playlist' },
        signal,
    });
    const first = Array.isArray(j?.cdlist) ? j?.cdlist?.[0] : undefined;
    if (!j || j.code !== 0 || !first) {
        if (j && (j.subcode === 4000 || /privacy/i.test(String(j.msg ?? '')))) {
            throw new errors_1.QQMusicError('QQ_AUTH_REQUIRED', '歌单详情需要登录态或该歌单不可见');
        }
        throw new errors_1.QQMusicError('QQ_UPSTREAM', `歌单详情失败：${JSON.stringify(j).slice(0, 150)}`, { upstreamCode: j?.code });
    }
    const all = (first.songlist ?? []).map((s) => normalizePlaylistSong(s, includeRaw));
    const total = (0, helpers_1.num)(first.total_song_num) || all.length;
    const start = (page - 1) * limit;
    const songs = all.slice(start, start + limit);
    return {
        source: 'qqmusic',
        id: (0, helpers_1.str)(disstid),
        name: (0, helpers_1.str)(first.dissname),
        coverUrl: first.logo ? String(first.logo) : null,
        songCount: total,
        ...(first.nickname ? { creator: String(first.nickname) } : {}),
        songs,
        songsTruncated: start + songs.length < total,
    };
}
/* --------------------------- 我喜欢（dirid=201） --------------------------- */
/**
 * 「我喜欢」歌单（dirid=201）：与普通歌单不同，走 `music.srfDissInfo.DissInfo/CgiGetDiss`，
 * 需登录态；分页用 `song_begin/song_num`。
 */
async function likedSongs(cgi, cookie, page, limit, includeRaw, signal) {
    const pageSize = Math.max(1, Math.min(Math.floor(limit), 1000));
    const data = {
        comm: { uin: cookie.uin, authst: cookie.authst, format: 'json', ct: 24, cv: 0 },
        req_0: {
            module: 'music.srfDissInfo.DissInfo',
            method: 'CgiGetDiss',
            param: { disstid: '', dirid: 201, tag: 1, song_begin: (page - 1) * pageSize, song_num: pageSize, userinfo: 1, orderlist: 1, onlysonglist: 0 },
        },
    };
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const j = await cgi.call(url, {
        query: { format: 'json', data: JSON.stringify(data) },
        auth: 'required',
        signal,
    });
    const r0 = j?.req_0;
    const d = r0?.data;
    if (r0?.code !== 0 || !d) {
        throw new errors_1.QQMusicError('QQ_UPSTREAM', `获取「我喜欢」失败：${JSON.stringify(j).slice(0, 150)}`, { upstreamCode: r0?.code });
    }
    const all = (d.songlist ?? []).map((s) => normalizePlaylistSong(s, includeRaw));
    const dirinfo = d.dirinfo ?? {};
    const total = (0, helpers_1.num)(dirinfo.songnum) || all.length;
    return {
        source: 'qqmusic',
        id: '201',
        name: (0, helpers_1.str)(dirinfo.dissname) || '我喜欢',
        coverUrl: dirinfo.diss_cover ? String(dirinfo.diss_cover) : null,
        songCount: total,
        songs: all,
        songsTruncated: (page - 1) * pageSize + all.length < total,
    };
}
/* --------------------------- 外部歌单：分享链接解析 --------------------------- */
/**
 * 从「歌单 ID / 完整链接 / 分享短链」里解析出 disstid。
 * 短链（返回 null 的）需要再走 resolvePlaylistInput 跟随跳转。
 */
function extractDissId(input) {
    const s = String(input || '').trim();
    if (!s)
        return null;
    if (/^\d{5,}$/.test(s))
        return s;
    const patterns = [
        /[?&]disstid=(\d+)/,
        /[?&]id=(\d+)/,
        /\/playlist\/(\d+)/,
        /\/taoge\/[^/]*?_(\d+)/,
        /\/(\d{6,})(?:[?#]|$)/,
    ];
    for (const re of patterns) {
        const m = s.match(re);
        if (m)
            return m[1];
    }
    return null;
}
/** 解析任意输入（ID / 链接 / 短链）为 disstid */
async function resolvePlaylistInput(http, input, signal) {
    const s = String(input || '').trim();
    if (!s)
        throw new errors_1.QQMusicError('QQ_CONFIG', '歌单链接/ID 不能为空');
    const direct = extractDissId(s);
    if (direct)
        return direct;
    // 短链：跟随跳转，从最终 URL 或页面文本里找 id
    if (/^https?:/i.test(s)) {
        const { finalUrl, text } = await http.probe(s, { signal });
        const id = extractDissId(finalUrl) ||
            extractDissId(text) ||
            (text.match(/"disstid"\s*:\s*"?(\d+)/) || [])[1] ||
            (text.match(/["']?dissid["']?\s*[:=]\s*["']?(\d{5,})/) || [])[1];
        if (id)
            return id;
    }
    throw new errors_1.QQMusicError('QQ_NOT_FOUND', `无法从「${s}」解析出歌单 ID`);
}
//# sourceMappingURL=playlist.js.map