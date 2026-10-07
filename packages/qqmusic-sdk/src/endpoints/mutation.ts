import { QQMusicError } from '../errors';
import { sign } from '../upstream';
import type { AuthContext, Cgi } from '../transport';

const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

interface MusicuResult {
  req_0?: { code?: number; data?: { retCode?: number; msg?: string; result?: Record<string, unknown> } };
}

/** 带签名 + 登录态调用 musicu.fcg（写操作走这里） */
async function callMusicu(cgi: Cgi, auth: AuthContext, req0: Record<string, unknown>, signal?: AbortSignal): Promise<MusicuResult> {
  const cookie = await auth.getCookie(true);
  const full = {
    req_0: req0,
    comm: {
      uin: cookie?.uin ?? '',
      authst: cookie?.qqmusic_key ?? cookie?.qm_keyst ?? '',
      format: 'json',
      ct: 24,
      cv: 0,
    },
  };
  const url = `${MUSICU}?sign=${sign(full)}&format=json&data=${encodeURIComponent(JSON.stringify(full))}`;
  return cgi.call<MusicuResult>(url, { auth: 'required', signal });
}

function ensureOk(j: MusicuResult, action: string): MusicuResult {
  const r0 = j?.req_0;
  if (r0?.code === 0 && Number(r0?.data?.retCode) === 0) return j;
  throw new QQMusicError('QQ_UPSTREAM', `${action}失败（code=${r0?.code} retCode=${r0?.data?.retCode}）：${r0?.data?.msg ?? ''}`, {
    upstreamCode: r0?.code,
  });
}

/** 根据 dirid 找到歌单的 tid（现代写接口需要） */
async function resolveTid(cgi: Cgi, auth: AuthContext, dirid: string | number, signal?: AbortSignal): Promise<number> {
  const cookie = await auth.getCookie(true);
  const j = await cgi.call<{ data?: { disslist?: Array<Record<string, unknown>> } }>(
    'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss',
    {
      query: {
        hostUin: 0,
        hostuin: cookie?.uin,
        sin: 0,
        size: 200,
        g_tk: 5381,
        loginUin: 0,
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq.json',
        needNewCode: 0,
      },
      auth: 'required',
      headers: { Referer: 'https://y.qq.com/portal/profile.html' },
      signal,
    },
  );
  const item = (j?.data?.disslist ?? []).find((x) => String(x.dirid) === String(dirid));
  if (!item || !item.tid) throw new QQMusicError('QQ_NOT_FOUND', `找不到歌单 dirid=${dirid}（或缺少 tid）`);
  return Number(item.tid);
}

/** mid -> 数字 songId（现代 AddSonglist 需要 songId 而不是 mid） */
async function midToSongId(cgi: Cgi, mid: string, signal?: AbortSignal): Promise<number> {
  const data = { songinfo: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_mid: mid } } };
  const j = await cgi.call<{ songinfo?: { data?: { track_info?: { id?: number | string } } } }>(MUSICU, {
    query: { format: 'json', data: JSON.stringify(data) },
    auth: 'none',
    signal,
  });
  const id = j?.songinfo?.data?.track_info?.id;
  if (!id) throw new QQMusicError('QQ_NOT_FOUND', `无法解析歌曲 id: ${mid}`);
  return Number(id);
}

/** 创建歌单（写操作，需登录态） */
export async function createPlaylist(
  cgi: Cgi,
  auth: AuthContext,
  name: string,
  signal?: AbortSignal,
): Promise<{ dirid: string; tid?: string }> {
  const j = ensureOk(
    await callMusicu(cgi, auth, { module: 'music.musicasset.PlaylistBaseWrite', method: 'AddPlaylist', param: { dirName: name } }, signal),
    '创建歌单',
  );
  const result = j.req_0?.data?.result as { dirId?: number | string; tid?: number | string } | undefined;
  if (!result?.dirId) throw new QQMusicError('QQ_UPSTREAM', '创建歌单成功但未返回 dirId');
  return { dirid: String(result.dirId), ...(result.tid ? { tid: String(result.tid) } : {}) };
}

/** 加入歌曲（写操作，需登录态）。songMids 会被解析为数字 songId；也可直接传 songIds。 */
export async function addSongsToPlaylist(
  cgi: Cgi,
  auth: AuthContext,
  dirid: string | number,
  songMids: string[],
  songIds?: Array<string | number>,
  signal?: AbortSignal,
): Promise<{ added: number; failed: number }> {
  const ids: number[] = (songIds ?? []).map(Number).filter((n) => !Number.isNaN(n));
  for (const mid of songMids) ids.push(await midToSongId(cgi, mid, signal));
  if (!ids.length) return { added: 0, failed: 0 };

  const tid = await resolveTid(cgi, auth, dirid, signal);
  ensureOk(
    await callMusicu(
      cgi,
      auth,
      {
        module: 'music.musicasset.PlaylistDetailWrite',
        method: 'AddSonglist',
        param: { dirId: Number(dirid), tid, bFmtUtf8: true, v_songInfo: ids.map((songId) => ({ songId, songType: 0 })) },
      },
      signal,
    ),
    '加入歌单',
  );
  return { added: ids.length, failed: 0 };
}

/** 删除歌单（写操作，需登录态） */
export async function deletePlaylist(
  cgi: Cgi,
  auth: AuthContext,
  dirid: string | number,
  signal?: AbortSignal,
): Promise<void> {
  const tid = await resolveTid(cgi, auth, dirid, signal);
  ensureOk(
    await callMusicu(cgi, auth, { module: 'music.musicasset.PlaylistBaseWrite', method: 'DelPlaylist', param: { dirId: Number(dirid), tid } }, signal),
    '删除歌单',
  );
}
