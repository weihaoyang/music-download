import type { PlaylistBrief, Profile } from '../types';
import type { Cgi } from '../transport';
export declare function normalizeProfile(raw: unknown, uin: string): Profile;
/** 个人资料（需登录态） */
export declare function userProfile(cgi: Cgi, uin: string, signal?: AbortSignal): Promise<Profile>;
export declare function normalizeUserPlaylist(x: Record<string, unknown>): PlaylistBrief;
/** 我创建的歌单（需登录态） */
export declare function userPlaylists(cgi: Cgi, uin: string, signal?: AbortSignal): Promise<PlaylistBrief[]>;
//# sourceMappingURL=user.d.ts.map