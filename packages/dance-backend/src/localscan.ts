import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/**
 * 按《HBDC 舞曲及排曲规则 表1》的文件命名规则解析本地舞曲文件：
 *   舞蹈类型-歌曲名-歌手
 *   舞蹈类型-歌曲名-歌手-时长（如 吉特巴-火花-格格-4′20″）
 *   舞蹈类型-歌曲名-歌手(剪辑版)
 * 支持全角/半角连字符与下划线。
 */

/** 俱乐部常见舞蹈类型（用于从文件名前缀识别） */
export const KNOWN_TYPES = [
  '慢三',
  '中三',
  '快三',
  '慢四',
  '中四',
  '平四',
  '并四',
  '伦巴',
  '吉特巴',
  '集体舞',
  '华尔兹',
  '探戈',
  '狐步',
  '快步',
  '维也纳',
  '舞厅伦巴',
  '国标伦巴',
  '国标恰恰',
  '恰恰',
  '桑巴',
  '牛仔',
  '斗牛',
];

export const AUDIO_EXTS = ['.mp3', '.flac', '.m4a', '.wav', '.ape', '.ogg', '.aac'];

export interface ParsedDanceFile {
  /** 绝对路径 */
  file: string;
  type: string;
  name: string;
  artists: string[];
  durationMs: number | null;
}

export function parseDanceFileName(absPath: string): ParsedDanceFile | null {
  const base = path.basename(absPath);
  const stem = base.replace(/\.[^.]+$/, '');
  const norm = stem
    .replace(/[－–—]/g, '-')
    .replace(/[_]/g, '-')
    .trim();
  const parts = norm
    .split('-')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  // 前缀里包含某个已知舞种即可（允许「32步」「青春16步」等集体舞前缀）
  const type = KNOWN_TYPES.find((t) => parts[0].includes(t)) ?? null;
  if (!type) return null;
  const name = parts[1];
  if (!name) return null;
  const artists = parts[2]
    ? parts[2]
        .split(/[、&/／＋+]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const tail = parts.slice(3).join('-');
  const m = tail.match(/(\d{1,2})\s*[′'′:：]\s*(\d{1,2})/);
  const durationMs = m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null;
  return { file: absPath, type, name, artists, durationMs };
}

export async function scanDanceDir(dir: string, recursive = false): Promise<{ files: ParsedDanceFile[]; audio: number; unparsed: string[] }> {
  const files: ParsedDanceFile[] = [];
  const unparsed: string[] = [];
  let audio = 0;
  const walk = async (d: string): Promise<void> => {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (recursive) await walk(p);
        continue;
      }
      if (!AUDIO_EXTS.includes(path.extname(e.name).toLowerCase())) continue;
      audio++;
      const parsed = parseDanceFileName(p);
      if (parsed) files.push(parsed);
      else unparsed.push(p);
    }
  };
  await walk(dir);
  return { files, audio, unparsed };
}

/** 归一化歌名：去括号内容、去标点与空白，便于与 QQ 曲库匹配 */
export function coreName(s: string): string {
  return s
    .replace(/[（(\[【][^)）\]】]*[)）\]】]/g, '')
    .toLowerCase()
    .replace(/[\s\-—_·、,，.。'"'"]/g, '');
}

export function localMid(absPath: string): string {
  return 'local-' + crypto.createHash('md5').update(path.resolve(absPath)).digest('hex').slice(0, 12);
}
