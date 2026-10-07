import type { PlaylistBrief, Profile } from '../types';
import { QQMusicError } from '../errors';
import type { Cgi } from '../transport';
import { num, str } from './helpers';

export function normalizeProfile(raw: unknown, uin: string): Profile {
  const root = (raw ?? {}) as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const creator = (data.creator ?? data) as Record<string, unknown>;
  const avatar = creator.headpic ?? creator.headurl ?? data.headpic;
  return {
    source: 'qqmusic',
    uin,
    nickname: str(creator.nick ?? creator.hostname ?? data.nick) || null,
    avatarUrl: avatar ? String(avatar) : null,
    vip: num(creator.isvip ?? data.isvip) === 1,
  };
}

/** 个人资料（需登录态） */
export async function userProfile(cgi: Cgi, uin: string, signal?: AbortSignal): Promise<Profile> {
  const url = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg';
  const j = await cgi.call<Record<string, unknown>>(url, {
    query: { cid: 205360838, userid: uin, reqfrom: 1, g_tk: 5381, format: 'json' },
    auth: 'required',
    signal,
  });
  if (j && j.code !== undefined && num(j.code) !== 0) {
    throw new QQMusicError('QQ_UPSTREAM', `获取资料失败：${JSON.stringify(j).slice(0, 150)}`, { upstreamCode: num(j.code) });
  }
  return normalizeProfile(j, uin);
}

export function normalizeUserPlaylist(x: Record<string, unknown>): PlaylistBrief {
  const cover = x.diss_cover ?? x.logo;
  return {
    source: 'qqmusic',
    id: str(x.dirid ?? x.dissid ?? x.tid),
    name: str(x.diss_name ?? x.dissname),
    coverUrl: cover ? String(cover) : null,
    songCount: num(x.song_cnt ?? x.songnum),
  };
}

/** 我创建的歌单（需登录态） */
export async function userPlaylists(cgi: Cgi, uin: string, signal?: AbortSignal): Promise<PlaylistBrief[]> {
  const url = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss';
  const j = await cgi.call<{ code?: number; data?: { disslist?: Array<Record<string, unknown>> } }>(url, {
    query: {
      hostUin: 0,
      hostuin: uin,
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
  });
  if (num(j?.code) === 4000) return []; // 不公开歌单
  const list = j?.data?.disslist ?? [];
  return list.map(normalizeUserPlaylist);
}
