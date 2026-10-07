import type { PlaylistBrief, PlaylistDetail, Profile, ResolvedConfig } from '../types';
import type { AuthContext, Cgi } from '../transport';
export declare class UserResource {
    private readonly cgi;
    private readonly auth;
    private readonly cfg;
    constructor(cgi: Cgi, auth: AuthContext, cfg: ResolvedConfig);
    /** 个人资料（需登录态） */
    profile(signal?: AbortSignal): Promise<Profile>;
    /** 我创建的歌单（需登录态） */
    playlists(signal?: AbortSignal): Promise<PlaylistBrief[]>;
    /** 「我喜欢」歌单（dirid=201，需登录态）；分页 page 从 1 起 */
    liked(params?: {
        page?: number;
        limit?: number;
        signal?: AbortSignal;
    }): Promise<PlaylistDetail>;
}
//# sourceMappingURL=user.d.ts.map