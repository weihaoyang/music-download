import path from 'path';
import crypto from 'crypto';
import type { Song } from '@hdbc/qqmusic-sdk';
import type { SourceDeps, TrackMeta, TrackSource } from './types';
import { scanDanceDir, parseDanceFileName, localMid } from '../localscan';
import * as netease from './netease';

function songToMeta(s: Song): TrackMeta {
  return {
    id: s.mid,
    name: s.name,
    artists: s.artists,
    album: s.album?.name ?? null,
    durationMs: s.durationMs,
    coverUrl: s.coverUrl,
  };
}

function baseNameOf(u: string): string {
  try {
    return decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
  } catch {
    return u.split('/').pop() || u;
  }
}

function metaFromAudioName(name: string): { name: string; artists: string[]; type: string | null; durationMs: number } {
  const parsed = parseDanceFileName(name);
  return {
    name: parsed?.name || name.replace(/\.[^.]+$/, ''),
    artists: parsed?.artists ?? [],
    type: parsed?.type ?? null,
    durationMs: parsed?.durationMs ?? 0,
  };
}

/** 自建服务器「整库清单」：接受 JSON 数组 / {files:[]} / {urls:[]}，相对路径按 base 解析 */
async function loadManifest(manifestUrl: string, signal?: AbortSignal): Promise<Array<{ name?: string; url: string; size?: number; durationMs?: number; type?: string }>> {
  const r = await fetch(manifestUrl, { signal });
  if (!r.ok) throw new Error(`清单 HTTP ${r.status}`);
  const j: any = await r.json();
  const base: string = j?.base || new URL('.', manifestUrl).toString();
  const list: any[] = Array.isArray(j) ? j : Array.isArray(j?.files) ? j.files : Array.isArray(j?.urls) ? j.urls : [];
  const resolve = (u: string): string => {
    try {
      return new URL(u, base).toString();
    } catch {
      return u;
    }
  };
  return list
    .map((it) => {
      if (typeof it === 'string') return { url: resolve(it) };
      const u = it.url || it.path || it.name || '';
      return { name: it.name, url: resolve(String(u)), size: it.size, durationMs: it.durationMs, type: it.type };
    })
    .filter((x) => x.url);
}

/** 构造来源注册表（QQ / 网易云 / 本地 / 直链） */
export function createSourceRegistry(deps: SourceDeps): Map<string, TrackSource> {
  const externals = (items: Array<{ id: string; name: string; artists?: string[]; album?: string | null; durationMs?: number; coverUrl?: string | null; url?: string | null; type?: string | null }>, fallbackType: string): TrackMeta[] =>
    items.map((it) => ({
      id: it.id,
      name: it.name,
      artists: it.artists ?? [],
      album: it.album ?? null,
      durationMs: it.durationMs ?? 0,
      coverUrl: it.coverUrl ?? null,
      url: it.url ?? null,
      type: it.type || fallbackType,
    }));

  const defs: TrackSource[] = [
    {
      id: 'qqmusic',
      label: 'QQ音乐',
      kind: 'online',
      authed: () => true,
      search: async (keywords, kind, limit) => {
        const client = await deps.qqAnonymous();
        if (kind === 'playlist') return (await client.search.playlists({ keyword: keywords, limit })).items;
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
        if (!parsed) throw new Error('无法解析网易云链接/ID');
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
        if (!dir) throw new Error('dir required');
        const scanned = await scanDanceDir(path.resolve(dir), !!body.recursive);
        const tracks: TrackMeta[] = scanned.files.map((f) => ({
          id: localMid(f.file),
          name: f.name,
          artists: f.artists,
          album: null,
          durationMs: f.durationMs ?? 0,
          coverUrl: null,
          file: f.file,
          local: true,
          type: f.type,
        }));
        return { name: path.resolve(dir), tracks, note: `扫描音频 ${scanned.audio}，文件名不合规 ${scanned.unparsed.length}` };
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
        const sources: Array<{ name?: string; url: string; durationMs?: number; type?: string }> = [];
        if (body.manifestUrl) {
          sources.push(...(await loadManifest(String(body.manifestUrl))));
        } else if (Array.isArray(body.urls)) {
          sources.push(...(body.urls as unknown[]).map(String).map((url) => ({ url })));
        } else if (body.url) {
          sources.push({ url: String(body.url) });
        }
        if (!sources.length) throw new Error('urls 或 manifestUrl required');
        const tracks: TrackMeta[] = sources.map((s) => {
          const info = metaFromAudioName(s.name || baseNameOf(s.url));
          return {
            id: 'http:' + crypto.createHash('md5').update(s.url).digest('hex').slice(0, 12),
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
