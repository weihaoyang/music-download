/**
 * 百度网盘（pan.baidu.com）来源适配器。
 * 通过「分享链接 + BDUSS Cookie」列出目录并解析下载直链。
 *
 * ⚠️ 需要登录后的 BDUSS（及 STOKEN）Cookie 才能访问；请用 setBaiduCookie() 注入。
 * 分享分享→列目录→dlink 的流程随网盘版本变动，未在无 Cookie 环境下验证。
 *
 * 见 docs/library-source-architecture.md。
 */

let baiduCookie = '';
export function setBaiduCookie(c: string): void {
  baiduCookie = String(c || '').trim();
}
export function hasBaiduCookie(): boolean {
  return /BDUSS=/.test(baiduCookie);
}

const BASE = 'https://pan.baidu.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function headers(extraCookie = ''): Record<string, string> {
  return {
    'User-Agent': UA,
    Referer: 'https://pan.baidu.com/disk/home',
    Cookie: baiduCookie + (extraCookie ? '; ' + extraCookie : ''),
  };
}

/** 从分享链接里取 surl（/s/1XXXX → XXXX） */
export function extractSurl(input: string): string | null {
  const s = String(input || '').trim();
  const m = s.match(/\/s\/1([A-Za-z0-9_-]+)/) || s.match(/[?&]surl=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export interface PanItem {
  fsId: string;
  path: string;
  name: string;
  size: number;
  isDir: boolean;
  dlink: string | null;
}

interface ShareRef {
  shareUrl: string;
  pwd?: string;
  /** 存库引用：解析直链时用 */
  uk: string;
  shareid: string;
  bdclnd?: string;
  fsId: string;
  path: string;
}

function pickCookies(res: Response): string {
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

/** 初始化分享（有提取码则提交），返回 shareid/uk 与 BDCLND */
async function initShare(surl: string, pwd?: string): Promise<{ uk: string; shareid: string; bdclnd: string }> {
  if (!hasBaiduCookie()) throw new Error('百度网盘未配置 BDUSS Cookie');
  let bdclnd = '';
  const initRes = await fetch(`${BASE}/share/init?surl=${surl}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(pwd ? { pwd } : {}).toString(),
    redirect: 'manual',
  });
  const setc = pickCookies(initRes);
  if (/BDCLND=/.test(setc)) bdclnd = (setc.match(/BDCLND=([^;]+)/) || [])[1] || '';
  const html = await (await fetch(`${BASE}/s/${surl}`, { headers: headers(bdclnd ? `BDCLND=${bdclnd}` : '') })).text();
  const shareid = (html.match(/"shareid":(\d+)/) || html.match(/shareid["']?\s*[:=]\s*["']?(\d+)/) || [])[1];
  const uk = (html.match(/"share_uk":"?(\d+)"?/) || html.match(/"uk":"?(\d+)"?/) || [])[1];
  if (!shareid || !uk) throw new Error('解析分享失败（可能需要提取码或 Cookie 失效）');
  return { uk, shareid, bdclnd };
}

/** 列出分享目录（递归），返回音频文件 */
async function listShare(uk: string, shareid: string, bdclnd: string, dir = '/', out: PanItem[] = []): Promise<PanItem[]> {
  const q = new URLSearchParams({ uk, shareid, order: 'other', desc: '1', showempty: '0', web: '1', page: '1', num: '200', dir });
  const j: any = await (await fetch(`${BASE}/share/list?${q.toString()}`, { headers: headers(bdclnd ? `BDCLND=${bdclnd}` : '') })).json();
  if (j?.errno && j.errno !== 0) throw new Error(`列目录失败 errno=${j.errno}`);
  for (const f of j?.list || []) {
    if (f.isdir) {
      await listShare(uk, shareid, bdclnd, f.path, out);
    } else if (/\.(mp3|flac|m4a|ape|wav|ogg|aac)$/i.test(f.server_filename || '')) {
      out.push({ fsId: String(f.fs_id), path: String(f.path), name: String(f.server_filename), size: Number(f.size) || 0, isDir: false, dlink: f.dlink ? String(f.dlink) : null });
    }
  }
  return out;
}

/** 分享链接 → 音频列表 */
export async function listShareAudio(shareUrl: string, pwd?: string): Promise<{ items: PanItem[]; ref: ShareRef }> {
  const surl = extractSurl(shareUrl);
  if (!surl) throw new Error('无法从链接解析 surl');
  const { uk, shareid, bdclnd } = await initShare(surl, pwd);
  const items = await listShare(uk, shareid, bdclnd);
  return { items, ref: { shareUrl, pwd, uk, shareid, bdclnd, fsId: '', path: '' } };
}

/** 解析某个文件的下载直链（每次播放时重新解析，dlink 有时效） */
export async function resolveDlink(ref: ShareRef): Promise<string | null> {
  const { uk, shareid, bdclnd, fsId, path: p } = ref;
  const q = new URLSearchParams({ uk, shareid, order: 'other', desc: '1', showempty: '0', web: '1', page: '1', num: '200', dir: p.replace(/\/[^/]*$/, '') || '/' });
  const j: any = await (await fetch(`${BASE}/share/list?${q.toString()}`, { headers: headers(bdclnd ? `BDCLND=${bdclnd}` : '') })).json();
  const f = (j?.list || []).find((x: Record<string, unknown>) => String(x.fs_id) === String(fsId));
  let dlink = f?.dlink ? String(f.dlink) : null;
  if (!dlink) return null;
  // dlink 需要带 Cookie 请求，跟随 302 得到真实地址
  const r = await fetch(dlink, { headers: { ...headers(bdclnd ? `BDCLND=${bdclnd}` : ''), Referer: `${BASE}/` }, redirect: 'manual' });
  const loc = r.headers.get('location');
  return loc || dlink;
}

/** 供存库：把引用序列化进 track.url */
export function encodeRef(ref: ShareRef, item: PanItem): string {
  return 'pan:' + JSON.stringify({ u: ref.shareUrl, p: ref.pwd || '', uk: ref.uk, s: ref.shareid, b: ref.bdclnd || '', f: item.fsId, d: item.path });
}
export function decodeRef(url: string): ShareRef | null {
  if (!url || !url.startsWith('pan:')) return null;
  try {
    const o = JSON.parse(url.slice(4));
    return { shareUrl: o.u, pwd: o.p, uk: o.uk, shareid: o.s, bdclnd: o.b, fsId: o.f, path: o.d };
  } catch {
    return null;
  }
}
