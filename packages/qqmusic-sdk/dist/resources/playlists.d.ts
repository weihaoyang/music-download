import type { AddSongsParams, AddSongsResult, CreatePlaylistParams, DeletePlaylistParams, PlaylistBrief, PlaylistCloneParams, PlaylistDetail, PlaylistDetailParams, PlaylistImportParams, PlaylistResolveParams, ResolvedConfig } from '../types';
import type { AuthContext, Cgi, HttpClient } from '../transport';
export declare class PlaylistsResource {
    private readonly cgi;
    private readonly auth;
    private readonly http;
    private readonly cfg;
    constructor(cgi: Cgi, auth: AuthContext, http: HttpClient, cfg: ResolvedConfig);
    /** 解析歌单（需登录态；匿名会被 QQ 拒绝） */
    detail(params: PlaylistDetailParams): Promise<PlaylistDetail>;
    /** 把「歌单 ID / 完整链接 / 分享短链」解析为 disstid */
    resolve(params: PlaylistResolveParams): Promise<{
        disstid: string;
    }>;
    /**
     * 导入外部歌单：解析链接 -> 拉取并归一化歌曲。
     * 返回的 `songs[].mid` 可直接用于 create/addSongs。
     */
    importPlaylist(params: PlaylistImportParams): Promise<PlaylistDetail>;
    /**
     * 克隆外部歌单到「我的歌单」：
     * - 给了 dirid -> 直接加入该歌单；
     * - 否则用 name 新建歌单并加入。
     * 需要登录态。
     */
    clone(params: PlaylistCloneParams): Promise<PlaylistBrief>;
    /** 把歌曲加入歌单（写操作，需登录态） */
    addSongs(params: AddSongsParams): Promise<AddSongsResult>;
    /** 创建歌单（写操作，需登录态）；如带 songmids 则创建后一并加入 */
    create(params: CreatePlaylistParams): Promise<PlaylistBrief>;
    /** 删除歌单（写操作，需登录态） */
    delete(params: DeletePlaylistParams): Promise<void>;
}
//# sourceMappingURL=playlists.d.ts.map