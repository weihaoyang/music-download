"use strict";
/**
 * 网易云音乐（NetEase Cloud Music）来源适配器。
 * 使用免加密的 `/api/*` 端点：匿名可用 搜索 / 详情 / 歌单 / 歌词；
 * 播放直链（`/api/song/enhance/player/url`）需要登录 Cookie（MUSIC_U），否则返回 null。
 *
 * 见 docs/library-source-architecture.md（TrackSource 适配器之一）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setNeteaseCookie = setNeteaseCookie;
exports.hasNeteaseCookie = hasNeteaseCookie;
exports.normalizeNeSong = normalizeNeSong;
exports.searchSongs = searchSongs;
exports.searchPlaylists = searchPlaylists;
exports.songDetail = songDetail;
exports.songUrl = songUrl;
exports.lyric = lyric;
exports.playlistDetail = playlistDetail;
exports.extractNeId = extractNeId;
exports.qrStart = qrStart;
exports.qrCheck = qrCheck;
let neteaseCookie = '';
/** 设置网易云登录 Cookie（MUSIC_U=...）。空串=匿名。 */
function setNeteaseCookie(cookie) {
    neteaseCookie = String(cookie || '').trim();
}
function hasNeteaseCookie() {
    return /MUSIC_U=/.test(neteaseCookie);
}
const BASE = 'https://music.163.com';
function headers() {
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Referer: 'https://music.163.com',
        Origin: 'https://music.163.com',
        Cookie: neteaseCookie ? `os=pc; appver=2.9.7; ${neteaseCookie}` : 'os=pc; appver=2.9.7',
    };
}
async function getJson(path, signal) {
    const r = await fetch(BASE + path, { headers: headers(), signal });
    if (!r.ok)
        throw new Error(`netease HTTP ${r.status}`);
    return r.json();
}
async function postForm(path, data, signal) {
    const h = headers();
    h['Content-Type'] = 'application/x-www-form-urlencoded';
    const r = await fetch(BASE + path, { method: 'POST', headers: h, body: new URLSearchParams(data).toString(), signal });
    if (!r.ok)
        throw new Error(`netease HTTP ${r.status}`);
    return r.json();
}
function pickCover(al) {
    if (!al)
        return null;
    const p = al.picUrl || al.pic_str || al.pic || null;
    return p ? String(p) : null;
}
function normalizeNeSong(s) {
    const artists = (s.ar || s.artists || []).map((x) => (x && x.name) || '').filter(Boolean);
    const al = s.al || s.album || null;
    return {
        id: String(s.id),
        name: String(s.name ?? ''),
        artists,
        album: al ? String(al.name ?? '') : null,
        durationMs: Number(s.dt ?? s.duration ?? 0),
        coverUrl: pickCover(al),
        fee: s.fee == null ? null : Number(s.fee),
    };
}
/** 搜索歌曲 */
async function searchSongs(keyword, limit = 20, offset = 0, signal) {
    const j = await postForm('/api/cloudsearch/pc', { s: keyword, type: '1', offset: String(offset), limit: String(limit), total: 'true' }, signal);
    return (j?.result?.songs || []).map(normalizeNeSong);
}
/** 搜索歌单 */
async function searchPlaylists(keyword, limit = 20, offset = 0, signal) {
    const j = await postForm('/api/cloudsearch/pc', { s: keyword, type: '1000', offset: String(offset), limit: String(limit), total: 'true' }, signal);
    return (j?.result?.playlists || []).map((p) => ({
        id: String(p.id),
        name: String(p.name ?? ''),
        coverUrl: p.coverImgUrl ? String(p.coverImgUrl) : null,
        songCount: Number(p.trackCount ?? 0),
        creator: p.creator ? String(p.creator.nickname ?? '') : null,
    }));
}
/** 歌曲详情 */
async function songDetail(ids, signal) {
    const j = await getJson(`/api/song/detail/?ids=[${ids.map((x) => JSON.stringify(String(x))).join(',')}]`, signal);
    return (j?.songs || []).map(normalizeNeSong);
}
/** 播放直链（匿名通常为 null；需 MUSIC_U Cookie） */
async function songUrl(id, br = 320000, signal) {
    const j = await getJson(`/api/song/enhance/player/url?ids=[${JSON.stringify(String(id))}]&br=${br}`, signal);
    const d = j?.data?.[0];
    return d && d.url ? String(d.url) : null;
}
/** 歌词（LRC 文本） */
async function lyric(id, signal) {
    const j = await getJson(`/api/song/lyric?id=${encodeURIComponent(String(id))}&lv=-1&kv=-1&tv=-1`, signal);
    return { lyric: String(j?.lrc?.lyric ?? ''), trans: j?.tlyric?.lyric ? String(j.tlyric.lyric) : null };
}
/** 歌单详情（全部曲目） */
async function playlistDetail(id, limit = 1000, signal) {
    const j = await getJson(`/api/v6/playlist/detail?id=${encodeURIComponent(String(id))}&n=${limit}`, signal);
    const pl = j?.playlist || {};
    const all = (pl.tracks || []).map(normalizeNeSong);
    const songs = limit > 0 ? all.slice(0, limit) : all;
    return {
        id: String(id),
        name: String(pl.name ?? ''),
        coverUrl: pl.coverImgUrl ? String(pl.coverImgUrl) : null,
        songCount: Number(pl.trackCount ?? all.length),
        creator: pl.creator ? String(pl.creator.nickname ?? '') : null,
        songs,
    };
}
/** 从「链接 / 分享文本 / 纯 ID」解析出歌单或歌曲 ID */
function extractNeId(input) {
    const s = String(input || '').trim();
    if (!s)
        return null;
    if (/^\d{5,}$/.test(s))
        return { kind: 'playlist', id: s };
    const song = s.match(/[?&#/]song\/(\d+)/) || s.match(/song\?id=(\d+)/);
    if (song)
        return { kind: 'song', id: song[1] };
    const pl = s.match(/playlist\/(\d+)/) || s.match(/playlist\?id=(\d+)/) || s.match(/[?&]id=(\d+)/);
    if (pl)
        return { kind: 'playlist', id: pl[1] };
    return null;
}
/* ---------------------------- 网易云扫码登录 ---------------------------- */
/** 获取登录二维码：返回 unikey（token）与二维码里要编码的 URL */
async function qrStart(signal) {
    const j = await getJson('/api/login/qrcode/unikey?type=1', signal);
    if (!j?.unikey)
        throw new Error('获取网易云二维码失败');
    const token = String(j.unikey);
    return { token, url: 'https://music.163.com/login?codekey=' + encodeURIComponent(token) };
}
/** 轮询扫码状态；confirmed 时返回登录 Cookie（MUSIC_U） */
async function qrCheck(token, signal) {
    const r = await fetch(`${BASE}/api/login/qrcode/client/login?type=1&key=${encodeURIComponent(token)}`, { headers: headers(), signal });
    const j = (await r.json().catch(() => ({})));
    const code = Number(j?.code);
    if (code === 803) {
        const setc = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
        const cookie = setc.filter((c) => /MUSIC_U=|__csrf=/.test(c)).join('; ');
        return { state: 'confirmed', cookie };
    }
    if (code === 802)
        return { state: 'scanned' };
    if (code === 800)
        return { state: 'expired' };
    return { state: 'pending' };
}
//# sourceMappingURL=netease.js.map