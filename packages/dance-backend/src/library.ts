import type { PlaylistDetail, Song } from '@hdbc/qqmusic-sdk';
import { readJson, writeJson } from './store';

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
}

/** 默认曲库：按舞种分类的元数据缓存，浏览/编排零外部依赖 */
export class LibraryStore {
  private data: Record<string, LibrarySong[]> = {};

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    this.data = await readJson<Record<string, LibrarySong[]>>(this.file, {});
  }

  private save(): Promise<void> {
    return writeJson(this.file, this.data);
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
      arr.push({
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
      });
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
      arr.push({
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
      });
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
    arr.push({
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
    });
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
    patch: Partial<Pick<LibrarySong, 'name' | 'artists' | 'album' | 'type' | 'file' | 'coverUrl' | 'bpm' | 'meter' | 'confidence' | 'energy' | 'mood' | 'stability' | 'suitable' | 'warning'>>,
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
