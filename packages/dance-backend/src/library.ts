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
  /** 建议人工复核（低置信/贴近速度边界/拍号不明确） */
  needsReview?: boolean | null;
  /** 本地缓存文件大小（字节） */
  sizeBytes?: number | null;
  /** 最近一次播放时间（用于 LRU 淘汰） */
  playedAt?: number | null;
  /** 累计播放次数 */
  playCount?: number;
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

/** 默认曲库：按舞种分类的元数据缓存（SQLite 存储；无 node:sqlite 时回退 JSON） */
export class LibraryStore {
  private data: Record<string, LibrarySong[]> = {};
  // node:sqlite 的极简类型（避免引入依赖）
  private db: { exec: (s: string) => void; prepare: (s: string) => { run: (...a: unknown[]) => void; all: () => Array<{ data: string }> } } | null = null;
  private readonly sqlitePath: string;

  constructor(
    private readonly file: string,
    private readonly legacyFile?: string,
  ) {
    this.sqlitePath = file.replace(/\.json$/, '.sqlite');
  }

  /** 尝试打开 SQLite（Node ≥22.5 的 node:sqlite，无需原生编译） */
  private openDb(): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => unknown };
      const db = new DatabaseSync(this.sqlitePath) as NonNullable<LibraryStore['db']>;
      db.exec('CREATE TABLE IF NOT EXISTS tracks (mid TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_tracks_type ON tracks(type)');
      this.db = db;
      return true;
    } catch {
      this.db = null;
      return false;
    }
  }

  async load(): Promise<void> {
    if (this.openDb()) {
      const rows = this.db!.prepare('SELECT data FROM tracks').all();
      if (rows.length) {
        this.data = {};
        for (const r of rows) {
          try {
            const s = JSON.parse(r.data) as LibrarySong;
            (this.data[s.type] ??= []).push(s);
          } catch {
            /* 跳过坏行 */
          }
        }
      } else {
        // 首次：从 tracks.json（this.file）或旧 library.json（legacyFile）迁移
        const legacy = (await readJson<unknown | null>(this.file, null)) as LibraryDoc | Record<string, LibrarySong[]> | null;
        let data: Record<string, LibrarySong[]> = {};
        if (legacy && typeof legacy === 'object' && 'collections' in (legacy as Record<string, unknown>)) data = (legacy as LibraryDoc).collections ?? {};
        else if (legacy && typeof legacy === 'object') data = legacy as Record<string, LibrarySong[]>;
        else if (this.legacyFile) data = await readJson<Record<string, LibrarySong[]>>(this.legacyFile, {});
        this.data = data;
      }
      let changed = rows.length === 0;
      for (const songs of Object.values(this.data)) for (const s of songs) if (normalizeTrack(s)) changed = true;
      if (changed) await this.save();
      return;
    }
    // JSON 回退
    const raw = (await readJson<unknown | null>(this.file, null)) as LibraryDoc | Record<string, LibrarySong[]> | null;
    if (raw && typeof raw === 'object' && 'collections' in (raw as Record<string, unknown>)) {
      this.data = (raw as LibraryDoc).collections ?? {};
    } else if (raw && typeof raw === 'object') {
      this.data = raw as Record<string, LibrarySong[]>;
    } else if (this.legacyFile) {
      this.data = await readJson<Record<string, LibrarySong[]>>(this.legacyFile, {});
    }
    let changed = raw === null;
    for (const songs of Object.values(this.data)) for (const s of songs) if (normalizeTrack(s)) changed = true;
    if (changed) await this.save();
  }

  private save(): Promise<void> {
    if (this.db) {
      // 原子全量替换（事务）
      const db = this.db;
      const del = db.prepare('DELETE FROM tracks');
      const ins = db.prepare('INSERT INTO tracks (mid, type, data) VALUES (?, ?, ?)');
      db.exec('BEGIN');
      try {
        del.run();
        for (const [type, songs] of Object.entries(this.data)) for (const s of songs) ins.run(s.mid, type, JSON.stringify(s));
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return Promise.resolve();
    }
    return writeJson(this.file, { schemaVersion: 2, collections: this.data } as LibraryDoc);
  }

  /** 单曲增量写：SQLite 用 UPSERT 只写一行（避免全表重写）；JSON 回退全量 */
  private saveSong(song: LibrarySong): Promise<void> {
    if (this.db) {
      try {
        this.db
          .prepare('INSERT INTO tracks (mid, type, data) VALUES (?, ?, ?) ON CONFLICT(mid) DO UPDATE SET type = excluded.type, data = excluded.data')
          .run(song.mid, song.type, JSON.stringify(song));
        return Promise.resolve();
      } catch {
        return this.save();
      }
    }
    return this.save();
  }

  /** 单曲删除：SQLite 只删一行 */
  private deleteSongRow(mid: string): Promise<void> {
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM tracks WHERE mid = ?').run(mid);
        return Promise.resolve();
      } catch {
        return this.save();
      }
    }
    return this.save();
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

  /** 曲库统计（舞种/BPM/曲风/来源分布 + 最常播放），供「统计」页使用 */
  stats(): {
    total: number;
    cached: number;
    liked: number;
    needsReview: number;
    unsuitable: number;
    analyzed: number;
    loudness: number;
    byType: Array<{ type: string; count: number; cached: number }>;
    bySource: Array<{ source: string; count: number }>;
    bpm: Array<{ range: string; count: number }>;
    mood: Array<{ mood: string; count: number }>;
    topPlayed: Array<{ mid: string; name: string; artists: string[]; type: string; playCount: number }>;
  } {
    const all = this.allSongs();
    const bpmRanges = ['<80', '80–100', '100–120', '120–140', '140–160', '160–180', '180–200', '≥200'];
    const bpmMap: Record<string, number> = Object.fromEntries(bpmRanges.map((r) => [r, 0]));
    const bucketOf = (b: number): string =>
      b < 80 ? '<80' : b < 100 ? '80–100' : b < 120 ? '100–120' : b < 140 ? '120–140' : b < 160 ? '140–160' : b < 180 ? '160–180' : b < 200 ? '180–200' : '≥200';
    const sourceMap: Record<string, number> = {};
    const moodMap: Record<string, number> = {};
    let cached = 0;
    let liked = 0;
    let needsReview = 0;
    let unsuitable = 0;
    let analyzed = 0;
    let loudness = 0;
    for (const s of all) {
      const src = s.source || 'qqmusic';
      sourceMap[src] = (sourceMap[src] ?? 0) + 1;
      if (s.file) cached++;
      if (s.liked) liked++;
      if (s.needsReview) needsReview++;
      if (s.suitable === false) unsuitable++;
      if (typeof s.bpm === 'number' && s.bpm > 0) {
        analyzed++;
        bpmMap[bucketOf(s.bpm)]++;
      }
      if (s.mood) moodMap[s.mood] = (moodMap[s.mood] ?? 0) + 1;
      if (s.loudness != null) loudness++;
    }
    const moodOrder = ['舒缓', '中', '欢快'];
    const moodList = [...moodOrder.map((m) => ({ mood: m, count: moodMap[m] ?? 0 })), ...Object.entries(moodMap).filter(([m]) => !moodOrder.includes(m)).map(([mood, count]) => ({ mood, count }))];
    return {
      total: all.length,
      cached,
      liked,
      needsReview,
      unsuitable,
      analyzed,
      loudness,
      byType: this.types(),
      bySource: Object.entries(sourceMap)
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
      bpm: bpmRanges.map((range) => ({ range, count: bpmMap[range] })),
      mood: moodList,
      topPlayed: all
        .filter((s) => s.playCount)
        .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
        .slice(0, 10)
        .map((s) => ({ mid: s.mid, name: s.name, artists: s.artists, type: s.type, playCount: s.playCount ?? 0 })),
    };
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
    await this.saveSong(hit.song);
    return true;
  }

  /** 标记最近播放时间（LRU 用）并累计播放次数；同一首播放期间的重复请求去抖，避免多次写库。返回是否真的记了一次（供调用方决定是否追加历史） */
  async markPlayed(mid: string): Promise<boolean> {
    const hit = this.findByMid(mid);
    if (!hit) return false;
    const now = Date.now();
    if (hit.song.playedAt && now - hit.song.playedAt < 8000) return false;
    hit.song.playedAt = now;
    hit.song.playCount = (hit.song.playCount ?? 0) + 1;
    await this.saveSong(hit.song);
    return true;
  }

  /** 编辑歌曲元数据（可改舞种，改舞种时移动到对应列表） */
  async updateSong(
    mid: string,
    patch: Partial<Pick<LibrarySong, 'name' | 'artists' | 'album' | 'type' | 'file' | 'coverUrl' | 'bpm' | 'meter' | 'confidence' | 'energy' | 'mood' | 'stability' | 'suitable' | 'warning' | 'loudness' | 'durationMs' | 'needsReview'>> & {
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
    if (patch.durationMs !== undefined) song.durationMs = patch.durationMs;
    if (patch.needsReview !== undefined) song.needsReview = patch.needsReview;
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
    await this.saveSong(song);
    return song;
  }

  /** 从曲库移除歌曲（不删除磁盘上的音频文件） */
  async removeSong(mid: string): Promise<boolean> {
    const hit = this.findByMid(mid);
    if (!hit) return false;
    const list = this.data[hit.type] ?? [];
    const idx = list.indexOf(hit.song);
    if (idx >= 0) list.splice(idx, 1);
    await this.deleteSongRow(mid);
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

  /** 导出全库（schema v2 文档），用于备份 */
  exportDoc(): LibraryDoc {
    return { schemaVersion: 2, collections: this.data };
  }

  /** 用备份**整体替换**曲库（归一化 schema v2 字段，按 mid 去重） */
  async replaceAll(collections: Record<string, LibrarySong[]>): Promise<number> {
    const next: Record<string, LibrarySong[]> = {};
    const seen = new Set<string>();
    let total = 0;
    for (const [type, songs] of Object.entries(collections || {})) {
      if (!Array.isArray(songs)) continue;
      const arr: LibrarySong[] = [];
      for (const s of songs) {
        if (!s || !s.mid || seen.has(s.mid)) continue;
        seen.add(s.mid);
        normalizeTrack(s);
        arr.push(s);
        total++;
      }
      if (arr.length) next[type] = arr;
    }
    this.data = next;
    await this.save();
    return total;
  }

  /** **合并**备份：只新增曲库里没有的 mid，返回新增/跳过数 */
  async mergeCollections(collections: Record<string, LibrarySong[]>): Promise<{ added: number; skipped: number }> {
    const seen = new Set(this.allSongs().map((s) => s.mid));
    let added = 0;
    let skipped = 0;
    for (const [type, songs] of Object.entries(collections || {})) {
      if (!Array.isArray(songs)) continue;
      const arr = this.data[type] ?? (this.data[type] = []);
      for (const s of songs) {
        if (!s || !s.mid || seen.has(s.mid)) {
          skipped++;
          continue;
        }
        seen.add(s.mid);
        normalizeTrack(s);
        arr.push(s);
        added++;
      }
    }
    if (added) await this.save();
    return { added, skipped };
  }
}
