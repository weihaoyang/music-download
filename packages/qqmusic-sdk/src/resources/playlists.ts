import type {
  AddSongsParams,
  AddSongsResult,
  CreatePlaylistParams,
  DeletePlaylistParams,
  PlaylistBrief,
  PlaylistCloneParams,
  PlaylistDetail,
  PlaylistDetailParams,
  PlaylistImportParams,
  PlaylistResolveParams,
  ResolvedConfig,
} from '../types';
import { QQMusicError } from '../errors';
import type { AuthContext, Cgi, HttpClient } from '../transport';
import { playlistDetail, resolvePlaylistInput } from '../endpoints/playlist';
import { addSongsToPlaylist, createPlaylist, deletePlaylist } from '../endpoints/mutation';

export class PlaylistsResource {
  constructor(
    private readonly cgi: Cgi,
    private readonly auth: AuthContext,
    private readonly http: HttpClient,
    private readonly cfg: ResolvedConfig,
  ) {}

  /** 解析歌单（需登录态；匿名会被 QQ 拒绝） */
  async detail(params: PlaylistDetailParams): Promise<PlaylistDetail> {
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const limit = Math.max(1, Math.min(Math.floor(params.limit ?? 100), 1000));
    return playlistDetail(this.cgi, params.disstid, page, limit, this.cfg.includeRaw, params.signal);
  }

  /** 把「歌单 ID / 完整链接 / 分享短链」解析为 disstid */
  async resolve(params: PlaylistResolveParams): Promise<{ disstid: string }> {
    const disstid = await resolvePlaylistInput(this.http, params.input, params.signal);
    return { disstid };
  }

  /**
   * 导入外部歌单：解析链接 -> 拉取并归一化歌曲。
   * 返回的 `songs[].mid` 可直接用于 create/addSongs。
   */
  async importPlaylist(params: PlaylistImportParams): Promise<PlaylistDetail> {
    const disstid = params.disstid || (params.url ? await resolvePlaylistInput(this.http, params.url, params.signal) : '');
    if (!disstid) throw new QQMusicError('QQ_CONFIG', '需要提供 url 或 disstid');
    const limit = Math.max(1, Math.min(Math.floor(params.limit ?? 1000), 5000));
    return playlistDetail(this.cgi, disstid, 1, limit, this.cfg.includeRaw, params.signal);
  }

  /**
   * 克隆外部歌单到「我的歌单」：
   * - 给了 dirid -> 直接加入该歌单；
   * - 否则用 name 新建歌单并加入。
   * 需要登录态。
   */
  async clone(params: PlaylistCloneParams): Promise<PlaylistBrief> {
    const detail = await this.importPlaylist({
      url: params.url,
      disstid: params.disstid,
      limit: params.limit,
      signal: params.signal,
    });
    const songmids = detail.songs.map((s) => s.mid).filter((x): x is string => Boolean(x));
    if (params.dirid !== undefined) {
      await this.addSongs({ dirid: params.dirid, songmids, signal: params.signal });
      return {
        source: 'qqmusic',
        id: String(params.dirid),
        name: detail.name,
        coverUrl: detail.coverUrl,
        songCount: songmids.length,
      };
    }
    return this.create({ name: params.name, songmids, signal: params.signal });
  }

  /** 把歌曲加入歌单（写操作，需登录态） */
  async addSongs(params: AddSongsParams): Promise<AddSongsResult> {
    const r = await addSongsToPlaylist(this.cgi, this.auth, params.dirid, params.songmids, params.songIds, params.signal);
    return { dirid: String(params.dirid), ...r };
  }

  /** 创建歌单（写操作，需登录态）；如带 songmids 则创建后一并加入 */
  async create(params: CreatePlaylistParams): Promise<PlaylistBrief> {
    const { dirid } = await createPlaylist(this.cgi, this.auth, params.name, params.signal);
    if (params.songmids?.length) {
      await addSongsToPlaylist(this.cgi, this.auth, dirid, params.songmids, undefined, params.signal);
    }
    return {
      source: 'qqmusic',
      id: dirid,
      name: params.name,
      coverUrl: null,
      songCount: params.songmids?.length ?? 0,
    };
  }

  /** 删除歌单（写操作，需登录态） */
  async delete(params: DeletePlaylistParams): Promise<void> {
    await deletePlaylist(this.cgi, this.auth, params.dirid, params.signal);
  }
}
