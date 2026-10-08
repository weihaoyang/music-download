import { readJson, writeJson } from './store';

export interface RuntimeSettings {
  /** 自定义音频缓存目录（绝对或相对后端根目录） */
  mediaDir?: string;
  mediaQuality?: string;
  autoDownload?: boolean;
  downloadConcurrency?: number;
  /** 本地缓存上限（字节），默认 20GiB；<=0 表示不限 */
  cacheLimitBytes?: number;
  /** 播放缓存后自动识别「未分类」舞种 */
  autoClassify?: boolean;
  /** 网易云音乐登录 Cookie（MUSIC_U=...） */
  neteaseCookie?: string;
  /** 百度网盘登录 Cookie（BDUSS=...; STOKEN=...） */
  baiduCookie?: string;
}

/** 运行时设置（管理端可改，落盘 data/settings.json） */
export class SettingsStore {
  private data: RuntimeSettings = {};

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    this.data = await readJson<RuntimeSettings>(this.file, {});
  }

  get(): RuntimeSettings {
    return this.data;
  }

  async update(patch: RuntimeSettings): Promise<RuntimeSettings> {
    this.data = { ...this.data, ...patch };
    await writeJson(this.file, this.data);
    return this.data;
  }
}
