import type { QuickItem, QuickResult } from '../types';
import { QQMusicError } from '../errors';
import type { Cgi } from '../transport';
import { str } from './helpers';

interface SmartboxItem {
  id?: string | number;
  mid?: string;
  name?: string;
  singer?: string;
  pic?: string;
}

function toItem(x: SmartboxItem): QuickItem {
  return {
    id: str(x.id),
    mid: str(x.mid),
    name: str(x.name),
    subtitle: x.singer ? String(x.singer) : null,
    coverUrl: x.pic ? String(x.pic) : null,
  };
}

/** 快速联想（smartbox，匿名可用） */
export async function quickSearch(cgi: Cgi, keyword: string, signal?: AbortSignal): Promise<QuickResult> {
  if (!keyword) throw new QQMusicError('QQ_CONFIG', 'keyword 不能为空');
  const url = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
  const j = await cgi.call<{ code?: number; data?: Record<string, { itemlist?: SmartboxItem[] }> }>(url, {
    query: { key: keyword, g_tk: 5381, format: 'json' },
    auth: 'none',
    signal,
  });
  if (j?.code !== 0 || !j.data) {
    throw new QQMusicError('QQ_UPSTREAM', `快速搜索失败：${JSON.stringify(j).slice(0, 150)}`, { upstreamCode: j?.code });
  }
  const pick = (key: string): QuickItem[] => (j.data?.[key]?.itemlist ?? []).map(toItem);
  return { songs: pick('song'), albums: pick('album'), playlists: pick('playlist'), mvs: pick('mv') };
}
