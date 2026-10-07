import type { PlaylistBrief, PlaylistDetail, Profile, ResolvedConfig } from '../types';
import type { AuthContext, Cgi } from '../transport';
import { userProfile, userPlaylists } from '../endpoints/user';
import { likedSongs } from '../endpoints/playlist';

export class UserResource {
  constructor(
    private readonly cgi: Cgi,
    private readonly auth: AuthContext,
    private readonly cfg: ResolvedConfig,
  ) {}

  /** 个人资料（需登录态） */
  async profile(signal?: AbortSignal): Promise<Profile> {
    const cookie = await this.auth.getCookie(true);
    return userProfile(this.cgi, cookie?.uin ?? '', signal);
  }

  /** 我创建的歌单（需登录态） */
  async playlists(signal?: AbortSignal): Promise<PlaylistBrief[]> {
    const cookie = await this.auth.getCookie(true);
    return userPlaylists(this.cgi, cookie?.uin ?? '', signal);
  }

  /** 「我喜欢」歌单（dirid=201，需登录态）；分页 page 从 1 起 */
  async liked(params: { page?: number; limit?: number; signal?: AbortSignal } = {}): Promise<PlaylistDetail> {
    const cookie = await this.auth.getCookie(true);
    return likedSongs(
      this.cgi,
      { uin: cookie?.uin ?? '', authst: cookie?.qqmusic_key ?? cookie?.qm_keyst ?? '' },
      params.page ?? 1,
      params.limit ?? 100,
      this.cfg.includeRaw,
      params.signal,
    );
  }
}
