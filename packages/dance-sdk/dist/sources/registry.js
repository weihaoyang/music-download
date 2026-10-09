"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSourceRegistry = createSourceRegistry;
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const localscan_1 = require("../localscan");
const media_1 = require("../media");
const netease = __importStar(require("./netease"));
function songToMeta(s) {
    return {
        id: s.mid,
        name: s.name,
        artists: s.artists,
        album: s.album?.name ?? null,
        durationMs: s.durationMs,
        coverUrl: s.coverUrl,
    };
}
function baseNameOf(u) {
    try {
        return decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
    }
    catch {
        return u.split('/').pop() || u;
    }
}
function metaFromAudioName(name) {
    const parsed = (0, localscan_1.parseDanceFileName)(name);
    return {
        name: parsed?.name || name.replace(/\.[^.]+$/, ''),
        artists: parsed?.artists ?? [],
        type: parsed?.type ?? null,
        durationMs: parsed?.durationMs ?? 0,
    };
}
/** 自建服务器「整库清单」：接受 JSON 数组 / {files:[]} / {urls:[]}，相对路径按 base 解析 */
async function loadManifest(manifestUrl, signal) {
    const r = await fetch(manifestUrl, { signal });
    if (!r.ok)
        throw new Error(`清单 HTTP ${r.status}`);
    const j = await r.json();
    const base = j?.base || new URL('.', manifestUrl).toString();
    const list = Array.isArray(j) ? j : Array.isArray(j?.files) ? j.files : Array.isArray(j?.urls) ? j.urls : [];
    const resolve = (u) => {
        try {
            return new URL(u, base).toString();
        }
        catch {
            return u;
        }
    };
    return list
        .map((it) => {
        if (typeof it === 'string')
            return { url: resolve(it) };
        const u = it.url || it.path || it.name || '';
        return { name: it.name, url: resolve(String(u)), size: it.size, durationMs: it.durationMs, type: it.type };
    })
        .filter((x) => x.url);
}
/** 构造来源注册表（QQ / 网易云 / 本地 / 直链） */
function createSourceRegistry(deps) {
    const externals = (items, fallbackType) => items.map((it) => ({
        id: it.id,
        name: it.name,
        artists: it.artists ?? [],
        album: it.album ?? null,
        durationMs: it.durationMs ?? 0,
        coverUrl: it.coverUrl ?? null,
        url: it.url ?? null,
        type: it.type || fallbackType,
    }));
    const defs = [
        {
            id: 'qqmusic',
            label: 'QQ音乐',
            kind: 'online',
            authed: () => true,
            search: async (keywords, kind, limit) => {
                const client = await deps.qqAnonymous();
                if (kind === 'playlist')
                    return (await client.search.playlists({ keyword: keywords, limit })).items;
                return (await client.search.songs({ keyword: keywords, limit })).items;
            },
            build: async (body) => {
                const single = body.songMid || (!body.url && !body.disstid && body.mid);
                if (single) {
                    const mid = String(body.songMid || body.mid);
                    const client = await deps.qqAnonymous();
                    const song = await client.songs.detail({ songmid: mid });
                    return { name: song.name, tracks: [songToMeta(song)] };
                }
                const client = await deps.qqLibrary();
                const detail = await client.playlists.importPlaylist({
                    url: body.url ? String(body.url) : undefined,
                    disstid: body.disstid ? String(body.disstid) : undefined,
                    limit: Number(body.limit ?? 1000),
                });
                return { name: detail.name, tracks: detail.songs.map(songToMeta) };
            },
        },
        {
            id: 'netease',
            label: '网易云音乐',
            kind: 'online',
            authed: () => netease.hasNeteaseCookie(),
            search: async (keywords, kind, limit) => (kind === 'playlist' ? netease.searchPlaylists(keywords, limit) : netease.searchSongs(keywords, limit)),
            build: async (body) => {
                const parsed = netease.extractNeId(String(body.input || ''));
                if (!parsed)
                    throw new Error('无法解析网易云链接/ID');
                if (parsed.kind === 'playlist') {
                    const d = await netease.playlistDetail(parsed.id, Number(body.limit ?? 1000));
                    return { name: d.name, tracks: externals(d.songs.map((s) => ({ id: s.id, name: s.name, artists: s.artists, album: s.album, durationMs: s.durationMs, coverUrl: s.coverUrl })), String(body.type || '未分类')) };
                }
                const d = await netease.songDetail([parsed.id]);
                return { name: d[0]?.name, tracks: externals(d.map((s) => ({ id: s.id, name: s.name, artists: s.artists, album: s.album, durationMs: s.durationMs, coverUrl: s.coverUrl })), String(body.type || '未分类')) };
            },
            streamUrl: (ref) => netease.songUrl(ref.mid),
        },
        {
            id: 'local',
            label: '本地/社团文件夹',
            kind: 'local',
            authed: () => true,
            build: async (body) => {
                const dir = String(body.dir || '');
                if (!dir)
                    throw new Error('dir required');
                const scanned = await (0, localscan_1.scanDanceDir)(path_1.default.resolve(dir), !!body.recursive);
                const tracks = await Promise.all(scanned.files.map(async (f) => ({
                    id: (0, localscan_1.localMid)(f.file),
                    name: f.name,
                    artists: f.artists,
                    album: null,
                    // 文件名没带时长就用 ffprobe 读真实时长
                    durationMs: f.durationMs ?? (await (0, media_1.probeDurationMs)(f.file)),
                    coverUrl: null,
                    file: f.file,
                    local: true,
                    type: f.type,
                })));
                return { name: path_1.default.resolve(dir), tracks, note: `扫描音频 ${scanned.audio}，文件名不合规 ${scanned.unparsed.length}` };
            },
        },
        {
            id: 'http',
            label: '自建服务器直链',
            kind: 'online',
            authed: () => true,
            build: async (body) => {
                const type = String(body.type || '未分类');
                // 整库清单模式：{ manifestUrl } → 一次收编服务器上的所有音频
                const sources = [];
                if (body.manifestUrl) {
                    sources.push(...(await loadManifest(String(body.manifestUrl))));
                }
                else if (Array.isArray(body.urls)) {
                    sources.push(...body.urls.map(String).map((url) => ({ url })));
                }
                else if (body.url) {
                    sources.push({ url: String(body.url) });
                }
                if (!sources.length)
                    throw new Error('urls 或 manifestUrl required');
                const tracks = sources.map((s) => {
                    const info = metaFromAudioName(s.name || baseNameOf(s.url));
                    return {
                        id: 'http:' + crypto_1.default.createHash('md5').update(s.url).digest('hex').slice(0, 12),
                        name: info.name,
                        artists: info.artists,
                        album: null,
                        durationMs: s.durationMs ?? info.durationMs,
                        coverUrl: null,
                        url: s.url,
                        type: s.type || info.type || type,
                    };
                });
                return { name: body.manifestUrl ? `清单 ${sources.length} 项` : '直链', tracks };
            },
            streamUrl: async (ref) => ref.url || null,
        },
    ];
    return new Map(defs.map((d) => [d.id, d]));
}
//# sourceMappingURL=registry.js.map