import type { PlaylistDetail, Song } from '@hdbc/qqmusic-sdk';
import { readJson, writeJson } from './store';

export interface Asset {
  id: string;
  /** 原版 / 剪辑版 */
  kind: 'original' | 'edited';
  source: string;
  /** 取流依据（mid/url/path 等） */
  ref?: Record<string, unknown> | null;
  /** 本地化后的文件 */
  file?: string | null;
  sizeBytes?: number | null;
  createdAt: number;
}

export interface Provenance {
  /** 归属：external 外部引进 / club 社团自制 */
  rights: 'external' | 'club';
  /** 是否经过剪辑/编辑 */
  edited: boolean;
  /** 最初来源（永久保留，用于溯源） */
  origin: { source: string; mid?: string; url?: string | null; path?: string | null } | null;
  note?: string | null;
}

export interface LibrarySong {
  mid: string;
  name: string;
  artists: string[];
  album: string | null;
  durationMs: number;
  coverUrl: string | null;
  type: string;
  addedAt: number;
  /** 本地缓存的音频文件名（相对 mediaDir） */
  file?: string | null;
  /** 自动分类结果 */
  bpm?: number | null;
  meter?: string | null;
  confidence?: number | null;
  /** 曲风能量 0~1 */
  energy?: number | null;
  /** 曲风标签：舒缓/中/欢快 */
  mood?: string | null;
  /** 节奏稳定性 0~1 */
  stability?: number | null;
  /** 是否适合作为舞曲 */
  suitable?: boolean | null;
  /** 不适合时的提示语 */
  warning?: string | null;
  /** 整体响度 LUFS（用于播放增益/响度归一化） */
  loudness?: number | null;
  /** 本地缓存文件大小（字节） */
  sizeBytes?: number | null;
  /** 最近一次播放时间（用于 LRU 淘汰） */
  playedAt?: number | null;
  /** 是否属于「我喜欢」合集（稳定保留，识别舞种不会移出） */
  liked?: boolean;
  /** 来源：'qqmusic' | 'netease' | 'local' | 'http' | 'pan'（默认 qqmusic） */
  source?: string;
  /** 外部直链来源的地址（http / 网盘 dlink 依据） */
  url?: string | null;
  /* -------- schema v2：正式模型（与上面的扁平字段并存，便于兼容） -------- */
  provenance?: Provenance;
  assets?: Asset[];
  primaryAssetId?: string;
}

/** tracks.json 文档结构（schema v2） */
interface LibraryDoc {
  schemaVersion: number;
  collections: Record<string, LibrarySong[]>;
}

function originOf(s: LibrarySong): Provenance['origin'] {
  const src = s.source || 'qqmusic';
  if (src === 'local') return { source: src, path: s.file ?? null };
  if (src === 'http' || src === 'pan') return { source: src, url: s.url ?? null };
  return { source: src, mid: s.mid };
}

/** 补齐 schema v2 字段；返回是否有改动 */
function normalizeTrack(s: LibrarySong): boolean {
  let changed = false;
  if (!s.source) {
    s.source = 'qqmusic';
    changed = true;
  }
  if (!s.provenance) {
    s.provenance = { rights: s.source === 'local' ? 'club' : 'external', edited: false, origin: originOf(s) };
    changed = true;
  }
  if (!s.assets || !s.assets.length) {
    const aid = `${s.mid}:main`;
    s.assets = [
      { id: aid, kind: 'original', source: s.source, ref: s.url ? { url: s.url } : s.source === 'qqmusic' || s.source === 'netease' ? { mid: s.mid } : null, file: s.file ?? null, sizeBytes: s.sizeBytes ?? null, createdAt: s.addedAt || Date.now() },
    ];
    s.primaryAssetId = aid;
    changed = true;
  }
  return changed;
}

/** 默认曲库：按舞种分类的元数据缓存，浏览/编排零外部依赖 */
export class LibraryStore {
  private data: Record<string, LibrarySong[]> = {};

  constructor(
    private readonly file: string,
    private readonly legacyFile?: string,
  ) {}

  async load(): Promise<void> {
    const raw = (await readJson<unknown | null>(this.file, null)) as LibraryDoc | Record<string, LibrarySong[]> | null;
    if (raw && typeof raw === 'object' && 'collections' in (raw as Record<string, unknown>)) {
      this.data = (raw as LibraryDoc).collections ?? {};
    } else if (raw && typeof raw === 'object') {
      // 旧 library.json 结构：type -> songs[]
      this.data = raw as Record<string, LibrarySong[]>;
    } else if (this.legacyFile) {
      this.data = await readJson<Record<string, LibrarySong[]>>(this.legacyFile, {});
    }
    let changed = raw === null;
    for (const songs of Object.values(this.data)) for (const s of songs) if (normalizeTrack(s)) changed = true;
    if (changed) await this.save();
  }

  private save(): Promise<void> {
    return writeJson(this.file, { schemaVersion: 2, collections: this.data } as LibraryDoc);
  }

  types(): Array<{ type: string; count: number; cached: number }> {
    return Object.entries(this.data).map(([type, songs]) => ({
      type,
      count: songs.length,
      cached: songs.filter((s) => s.file).length,
    }));
  }

  list(type: string): LibrarySong[] {
    return this.data[type] ?? [];
  }

  allSongs(): LibrarySong[] {
    return Object.values(this.data).flat();
  }

  /** 「我喜欢」合集：所有标记 liked 的歌（跨舞种，稳定保留） */
  likedSongs(): LibrarySong[] {
    return this.allSongs().filter((s) => s.liked);
  }

  /** 批量标记/取消「我喜欢」（按 mid） */
  async setLiked(mids: string[], liked = true): Promise<number> {
    let n = 0;
    for (const mid of mids) {
      const hit = this.findByMid(mid);
      if (hit) {
        hit.song.liked = liked;
        n++;
      }
    }
    if (n) await this.save();
    return n;
  }

  findByMid(mid: string): { type: string; song: LibrarySong } | undefined {
    for (const [type, songs] of Object.entries(this.data)) {
      const song = songs.find((s) => s.mid === mid);
      if (song) return { type, song };
    }
    return undefined;
  }

  async addSongs(type: string, songs: Song[]): Promise<{ added: number; skipped: number; newMids: string[] }> {
    const arr = this.data[type] ?? (this.data[type] = []);
    // 全局去重：同一 mid 不能出现在多个舞种里
    const seen = new Set(this.allSongs().map((s) => s.mid));
    let added = 0;
    let skipped = 0;
    const newMids: string[] = [];
    for (const s of songs) {
      if (!s.mid || seen.has(s.mid)) {
        skipped++;
        continue;
      }
      const track: LibrarySong = {
        mid: s.mid,
        name: s.name,
        artists: s.artists,
        album: s.album?.name ?? null,
        durationMs: s.durationMs,
        coverUrl: s.coverUrl,
        type,
        addedAt: Date.now(),
        file: null,
        source: 'qqmusic',
      };
      normalizeTrack(track);
      arr.push(track);
      seen.add(s.mid);
      newMids.push(s.mid);
      added++;
    }
    await this.save();
    return { added, skipped, newMids };
  }

  importDetail(type: string, detail: PlaylistDetail): Promise<{ added: number; skipped: number; newMids: string[] }> {
    return this.addSongs(type, detail.songs);
  }

  /** 加入「外部来源」（网易云 / 直链 / 网盘等）的歌曲 */
  async addExternalSongs(
    type: string,
    items: Array<{
      id: string;
      name: string;
      artists?: string[];
      album?: string | null;
      durationMs?: number;
      coverUrl?: string | null;
      url?: string | null;
    }>,
    source: string,
  ): Promise<{ added: number; skipped: number; newMids: string[] }> {
    const arr = this.data[type] ?? (this.data[type] = []);
    const seen = new Set(this.allSongs().map((s) => s.mid));
    let added = 0;
    let skipped = 0;
    const newMids: string[] = [];
    for (const it of items) {
      const mid = String(it.id ?? '');
      if (!mid || seen.has(mid)) {
        skipped++;
        continue;
      }
      const track: LibrarySong = {
        mid,
        name: String(it.name ?? ''),
        artists: it.artists ?? [],
        album: it.album ?? null,
        durationMs: it.durationMs ?? 0,
        coverUrl: it.coverUrl ?? null,
        type,
        addedAt: Date.now(),
        file: null,
        source,
        url: it.url ?? null,
      };
      normalizeTrack(track);
      arr.push(track);
      seen.add(mid);
      newMids.push(mid);
      added++;
    }
    await this.save();
    return { added, skipped, newMids };
  }

  /** 加入/更新「本地文件」歌曲（file 可为绝对路径），返回是否新增 */
  async addLocalSong(
    type: string,
    song: { mid: string; name: string; artists: string[]; durationMs: number; file: string },
  ): Promise<boolean> {
    const arr = this.data[type] ?? (this.data[type] = []);
    const exist = arr.find((s) => s.mid === song.mid);
    if (exist) {
      exist.file = song.file;
      await this.save();
      return false;
    }
    const track: LibrarySong = {
      mid: song.mid,
      name: song.name,
      artists: song.artists,
      album: null,
      durationMs: song.durationMs,
      coverUrl: null,
      type,
      addedAt: Date.now(),
      file: song.file,
      source: 'local',
    };
    normalizeTrack(track);
    arr.push(track);
    await this.save();
    return true;
  }

  async setFile(mid: string, file: string | null, sizeBytes?: number): Promise<boolean> {
    const hit = this.findByMid(mid);
    if (!hit) return false;
    hit.song.file = file;
    if (file) {
      hit.song.playedAt = Date.now();
      if (typeof sizeBytes === 'number') hit.song.sizeBytes = sizeBytes;
    } else {
      hit.song.sizeBytes = null;
    }
    // 同步到主资产（schema v2）
    const asset = hit.song.assets?.find((a) => a.id === hit.song.primaryAssetId);
    if (asset) {
      asset.file = file;
      if (typeof sizeBytes === 'number') asset.sizeBytes = sizeBytes;
      else if (!file) asset.sizeBytes = null;
    }
    await this.save();
    return true;
  }

  /** 标记最近播放时间（LRU 用） */
  async markPlayed(mid: string): Promise<void> {
    const hit = this.findByMid(mid);
    if (!hit) return;
    hit.song.playedAt = Date.now();
    await this.save();
  }

  /** 编辑歌曲元数据（可改舞种，改舞种时移动到对应列表） */
  async updateSong(
    mid: string,
    patch: Partial<Pick<LibrarySong, 'name' | 'artists' | 'album' | 'type' | 'file' | 'coverUrl' | 'bpm' | 'meter' | 'confidence' | 'energy' | 'mood' | 'stability' | 'suitable' | 'warning' | 'loudness'>> & {
      /** schema v2：归属 external/club */
      rights?: 'external' | 'club';
      /** schema v2：是否编辑过 */
      edited?: boolean;
    },
  ): Promise<LibrarySong | null> {
    const hit = this.findByMid(mid);
    if (!hit) return null;
    const song = hit.song;
    if (patch.name !== undefined) song.name = patch.name;
    if (patch.artists !== undefined) song.artists = patch.artists;
    if (patch.album !== undefined) song.album = patch.album;
    if (patch.coverUrl !== undefined) song.coverUrl = patch.coverUrl;
    if (patch.file !== undefined) song.file = patch.file;
    if (patch.bpm !== undefined) song.bpm = patch.bpm;
    if (patch.meter !== undefined) song.meter = patch.meter;
    if (patch.confidence !== undefined) song.confidence = patch.confidence;
    if (patch.energy !== undefined) song.energy = patch.energy;
    if (patch.mood !== undefined) song.mood = patch.mood;
    if (patch.stability !== undefined) song.stability = patch.stability;
    if (patch.suitable !== undefined) song.suitable = patch.suitable;
    if (patch.warning !== undefined) song.warning = patch.warning;
    if (patch.loudness !== undefined) song.loudness = patch.loudness;
    if (patch.rights !== undefined || patch.edited !== undefined) {
      song.provenance = song.provenance ?? { rights: 'external', edited: false, origin: originOf(song) };
      if (patch.rights !== undefined) song.provenance.rights = patch.rights;
      if (patch.edited !== undefined) song.provenance.edited = patch.edited;
    }
    if (patch.type !== undefined && patch.type && patch.type !== hit.type) {
      const from = this.data[hit.type];
      const idx = from ? from.indexOf(song) : -1;
      if (idx >= 0) from.splice(idx, 1);
      const to = this.data[patch.type] ?? (this.data[patch.type] = []);
      song.type = patch.type;
      to.push(song);
    }
    await this.save();
    return song;
  }

  /** 从曲库移除歌曲（不删除磁盘上的音频文件） */
  async removeSong(mid: string): Promise<boolean> {
    const hit = this.findByMid(mid);
    if (!hit) return false;
    const list = this.data[hit.type] ?? [];
    const idx = list.indexOf(hit.song);
    if (idx >= 0) list.splice(idx, 1);
    await this.save();
    return true;
  }

  /** 删除某来源的全部曲目（不删磁盘文件），返回删除数量 */
  async removeBySource(source: string): Promise<number> {
    let n = 0;
    for (const type of Object.keys(this.data)) {
      const before = this.data[type].length;
      this.data[type] = this.data[type].filter((s) => (s.source || 'qqmusic') !== source);
      n += before - this.data[type].length;
    }
    if (n) await this.save();
    return n;
  }
}
