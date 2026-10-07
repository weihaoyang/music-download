import fs from 'fs';
import path from 'path';
import type { Logger, Quality } from '@hdbc/qqmusic-sdk';

export const ROOT = path.resolve(__dirname, '..');
export const CONFIG_PATH = process.env.DANCE_CONFIG || path.join(ROOT, 'config.json');

export interface BackendConfig {
  host: string;
  port: number;
  dataDir: string;
  mediaDir: string;
  /** 前端静态产物目录（Vite build 输出） */
  webDir: string;
  bridgeUrl: string;
  adminToken: string;
  /** 本地缓存音质 */
  mediaQuality: Quality;
  /** 导入/播放时自动下载到本地 */
  autoDownload: boolean;
  /** 后台下载并发 */
  downloadConcurrency: number;
  /** 本地缓存上限（字节），默认 20GiB；<=0 表示不限 */
  cacheLimitBytes: number;
  /** 播放缓存后，对「未分类」的歌自动识别舞种 */
  autoClassify: boolean;
  logger: Logger;
}

function abs(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

export function loadConfig(): BackendConfig {
  let file: Record<string, unknown> = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    /* ignore bad config */
  }
  const cfg: BackendConfig = {
    host: String(file.host ?? '127.0.0.1'),
    port: Number(file.port ?? 8790),
    dataDir: abs(String(file.dataDir ?? 'data')),
    mediaDir: abs(String(file.mediaDir ?? 'data/media')),
    webDir: abs(String(file.webDir ?? '../dance-frontend/dist')),
    bridgeUrl: String(file.bridgeUrl ?? 'http://127.0.0.1:8899/cookie'),
    adminToken: String(file.adminToken ?? ''),
    mediaQuality: (String(file.mediaQuality ?? '320') as Quality),
    autoDownload: file.autoDownload !== false,
    downloadConcurrency: Number(file.downloadConcurrency ?? 3),
    cacheLimitBytes: Number(file.cacheLimitBytes ?? 20 * 1024 * 1024 * 1024),
    autoClassify: file.autoClassify !== false,
    logger: console,
  };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.mkdirSync(cfg.mediaDir, { recursive: true });
  return cfg;
}
