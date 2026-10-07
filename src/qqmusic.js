'use strict';

const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const fsp = require('fs/promises');
const path = require('path');
const log = require('./log');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function apiBase(cfg) {
  return String(cfg.paths.musicApiBase || '').replace(/\/+$/, '');
}

/**
 * 搜索 QQ 音乐。走公开搜索接口，不需要 cookie。
 * 返回统一结构，便于前端 / 排曲系统直接消费。
 */
async function search(keyword, { limit = 10 } = {}) {
  if (!keyword) throw new Error('keyword 不能为空');
  // 注意：新版的 client_search_cp 现在会返回 HTTP 500，search_for_qq_cp 仍可用；
  // 如果以后这里失效，建议直接改用本地 QQMusicApi 服务的 /search。
  const params = {
    format: 'json',
    n: String(Math.min(Math.max(limit, 1), 50)),
    p: '1',
    w: keyword,
    cr: '1',
    g_tk: '5381',
    t: '0',
  };
  const url = 'http://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?' + new URLSearchParams(params).toString();
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://y.qq.com' },
  });
  if (!res.ok) throw new Error(`搜索请求失败 HTTP ${res.status}`);
  const json = await res.json();
  const list = (json && json.data && json.data.song && json.data.song.list) || [];
  return list.map(normalizeSong);
}

function normalizeSong(s) {
  const singers = Array.isArray(s.singer) ? s.singer : [];
  const mid = s.mid || s.songmid || '';
  return {
    mid,
    // search_for_qq_cp 不返回付费歌曲的 media_mid，留空，等取直链时再用 /song 详情补齐
    mediaId: (s.file && s.file.media_mid) || s.media_mid || s.strMediaMid || '',
    songid: s.id || s.songid || '',
    title: s.title || s.songname || s.name || '',
    artist: singers.map((x) => x.name).filter(Boolean).join(' / '),
    album: (s.album && s.album.name) || s.albumname || '',
    interval: s.interval || 0,
    // 付费标记（不同接口版本字段不一，仅作展示参考）
    pay: !!(s.pay && (s.pay.payplay || s.pay.pay_play || s.pay.paydownload)),
  };
}

/**
 * 取播放/下载直链。需要 QQMusicApi 本地服务已登录（带会员 cookie）。
 * 返回的通常是可直接保存的音频流（不需要 TuneFree 解密）。
 */
async function getSongUrl(cfg, { mid, mediaId, type = '320' }) {
  if (!mid) throw new Error('mid 不能为空');
  // 付费歌曲的 media_mid 与 songmid 不同，搜索拿不到时用 /song 详情补齐，否则拿不到直链
  const finalMediaId = mediaId || (await resolveMediaId(cfg, mid)) || mid;
  const url = `${apiBase(cfg)}/song/url?id=${encodeURIComponent(mid)}&mediaId=${encodeURIComponent(
    finalMediaId,
  )}&type=${encodeURIComponent(type)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`获取直链失败 HTTP ${res.status}（请确认 QQMusicApi 服务已启动）`);
  const json = await res.json();
  if (!json || json.result !== 100 || !json.data) {
    throw new Error(`获取直链失败：${(json && json.errMsg) || JSON.stringify(json)}`);
  }
  return typeof json.data === 'string' ? json.data : json.data.url;
}

/** 借助 QQMusicApi 的 /song 详情接口取 media_mid（付费歌曲必需） */
async function resolveMediaId(cfg, mid) {
  try {
    const res = await fetch(`${apiBase(cfg)}/song?songmid=${encodeURIComponent(mid)}`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return '';
    return findMediaMid(await res.json()) || '';
  } catch (_) {
    return '';
  }
}

function findMediaMid(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.media_mid === 'string' && obj.media_mid) return obj.media_mid;
  for (const v of Object.values(obj)) {
    const found = findMediaMid(v);
    if (found) return found;
  }
  return '';
}

/**
 * 把歌曲加进「补歌队列」歌单，触发客户端「自动下载新增歌曲」。
 * 依赖 QQMusicApi 的 /songlist/add，且该服务已登录。
 */
async function addToPlaylist(cfg, mids, dirid) {
  if (!dirid) throw new Error('未配置补歌队列歌单 dirid');
  const url = `${apiBase(cfg)}/songlist/add?mid=${encodeURIComponent(mids.join(','))}&dirid=${encodeURIComponent(
    dirid,
  )}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`加歌失败 HTTP ${res.status}`);
  return res.json();
}

/** 把 url 流式下载到 dest */
async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), require('fs').createWriteStream(dest));
  const st = await fsp.stat(dest);
  if (st.size === 0) {
    await fsp.rm(dest, { force: true });
    throw new Error('下载得到空文件');
  }
  return dest;
}

function baseInfo(cfg) {
  return apiBase(cfg);
}

module.exports = { search, getSongUrl, addToPlaylist, download, baseInfo, UA };
