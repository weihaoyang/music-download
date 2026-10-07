import type { AuthContext, Cgi } from '../transport';
/** 创建歌单（写操作，需登录态） */
export declare function createPlaylist(cgi: Cgi, auth: AuthContext, name: string, signal?: AbortSignal): Promise<{
    dirid: string;
    tid?: string;
}>;
/** 加入歌曲（写操作，需登录态）。songMids 会被解析为数字 songId；也可直接传 songIds。 */
export declare function addSongsToPlaylist(cgi: Cgi, auth: AuthContext, dirid: string | number, songMids: string[], songIds?: Array<string | number>, signal?: AbortSignal): Promise<{
    added: number;
    failed: number;
}>;
/** 删除歌单（写操作，需登录态） */
export declare function deletePlaylist(cgi: Cgi, auth: AuthContext, dirid: string | number, signal?: AbortSignal): Promise<void>;
//# sourceMappingURL=mutation.d.ts.map