import path from 'path';
import crypto from 'crypto';
import type { Song } from '@hdbc/qqmusic-sdk';
import type { ClientPool } from '../clients';
import { scanDanceDir, parseDanceFileName, localMid } from '../localscan';
import * as netease from './netease';

/** 归一化后的「待入库曲目」草稿（各来源产出的统一形态） */
export interface Draft {
  id: string;
  name: string;
  artists?: string[];
  album?: string | null;
  durationMs?: number;
  coverUrl?: string | null;
  /** 外部直链引用（http 原链 / pan 编码引用） */
  url?: string | null;
  /** 本地文件绝对路径（local 来源） */
  file?: string | null;
  /** true=本地文件（用 addLocalSong），否则用 addExternalSongs */
  local?: boolean;
  /** 来源自带舞种（如本地文件名解析出的舞种） */
  type?: string | null;
}

export interface SourceDef {
  id: string;
  label: string;
  kind: 'online' | 'local';
  /** 是否已具备访问凭证（用于前端展示） */
  authed: () => boolean;
  /** 可选：按关键词搜索（kind: song|playlist） */
  search?: (keywords: string, kind: string, limit: number) => Promise<unknown[]>;
  /** 构建待入库草稿 */
  build: (body: Record<string, unknown>) => Promise<{ name?: string; drafts: Draft[]; note?: string }>;
  /** 可选：解析可播放直链（网易云/http/网盘）；无则表示由后端其它逻辑处理（QQ/本地） */
  streamUrl?: (song: { mid: string; url?: string | null }) => Promise<string | null>;
}

function songToDraft(s: Song): Draft {
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

function draftFromAudioName(name: string): { name: string; artists: string[]; type: string | null; durationMs: number } {
  const parsed = parseDanceFileName(name);
  return {
    name: parsed?.name || name.replace(/\.[^.]+$/, ''),
    artists: parsed?.artists ?? [],
    type: parsed?.type ?? null,
    durationMs: parsed?.durationMs ?? 0,
  };
}

/** 构造来源注册表（QQ / 网易云 / 本地 / 直链 / 网盘） */
export function createSourceRegistry(ctx: { pool: ClientPool }): Map<string, SourceDef> {
  const defs: SourceDef[] = [
    {
      id: 'qqmusic',
      label: 'QQ音乐',
      kind: 'online',
      authed: () => true,
      search: async (keywords, kind, limit) => {
        const client = await ctx.pool.anonymous();
        if (kind === 'playlist') return (await client.search.playlists({ keyword: keywords, limit })).items;
        return (await client.search.songs({ keyword: keywords, limit })).items;
      },
      build: async (body) => {
        const single = body.songMid || (!body.url && !body.disstid && body.mid);
        if (single) {
          const mid = String(body.songMid || body.mid);
          const client = await ctx.pool.anonymous();
          const song = await client.songs.detail({ songmid: mid });
          return { name: song.name, drafts: [songToDraft(song)] };
        }
        const client = await ctx.pool.libraryClient();
        const detail = await client.playlists.importPlaylist({
          url: body.url ? String(body.url) : undefined,
          disstid: body.disstid ? String(body.disstid) : undefined,
          limit: Number(body.limit ?? 1000),
        });
        return { name: detail.name, drafts: detail.songs.map(songToDraft) };
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
          return { name: d.name, drafts: d.songs.map((s) => ({ id: s.id, name: s.name, artists: s.artists, album: s.album, durationMs: s.durationMs, coverUrl: s.coverUrl })) };
        }
        const d = await netease.songDetail([parsed.id]);
        return { name: d[0]?.name, drafts: d.map((s) => ({ id: s.id, name: s.name, artists: s.artists, album: s.album, durationMs: s.durationMs, coverUrl: s.coverUrl })) };
      },
      streamUrl: (song) => netease.songUrl(song.mid),
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
        const drafts: Draft[] = scanned.files.map((f) => ({
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
        return { name: path.resolve(dir), drafts, note: `扫描音频 ${scanned.audio}，文件名不合规 ${scanned.unparsed.length}` };
      },
    },
    {
      id: 'http',
      label: '自建服务器直链',
      kind: 'online',
      authed: () => true,
      build: async (body) => {
        const urls: string[] = Array.isArray(body.urls) ? (body.urls as unknown[]).map(String) : body.url ? [String(body.url)] : [];
        if (!urls.length) throw new Error('urls required');
        const drafts: Draft[] = urls.map((u) => {
          const info = draftFromAudioName(baseNameOf(u));
          return {
            id: 'http:' + crypto.createHash('md5').update(u).digest('hex').slice(0, 12),
            name: info.name,
            artists: info.artists,
            album: null,
            durationMs: info.durationMs,
            coverUrl: null,
            url: u,
            type: info.type,
          };
        });
        return { name: '直链', drafts };
      },
      streamUrl: async (song) => song.url || null,
    },
  ];
  return new Map(defs.map((d) => [d.id, d]));
}
