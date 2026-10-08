import type { Logger, QQMusicClient, Quality } from '@hdbc/qqmusic-sdk';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const ffmpegPath = process.env.MF_FFMPEG || 'ffmpeg';
const ffprobePath = process.env.MF_FFPROBE || 'ffprobe';

/** 本地音频缓存：下载成文件（统一转成 mp3），彻底摆脱运行时对 QQ 的依赖 */
export class MediaCache {
  private active = 0;
  private queue: Array<() => Promise<void>> = [];
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly dir: string,
    private readonly quality: Quality,
    private readonly concurrency: number,
    private readonly logger: Logger,
  ) {}

  /**
   * 缓存文件名。统一以 .mp3 结尾：下载后会用 ffmpeg 归一化为 mp3
   * （HQ/320 本身就是 mp3，避免后续播放器遇到 flac/ape/m4a/加密格式）。
   */
  fileFor(mid: string): string {
    return `${mid}.mp3`;
  }

  absPath(file: string): string {
    // 本地文件可能保存为绝对路径（按文件名校准时导入）
    return path.isAbsolute(file) ? file : path.join(this.dir, file);
  }

  async exists(file: string): Promise<boolean> {
    try {
      const st = await fs.stat(this.absPath(file));
      return st.size > 0;
    } catch {
      return false;
    }
  }

  async sizeOf(file: string): Promise<number> {
    try {
      return (await fs.stat(this.absPath(file))).size;
    } catch {
      return 0;
    }
  }

  /** 目录内所有缓存文件的总大小（字节） */
  async totalBytes(): Promise<number> {
    return (await this.stats()).bytes;
  }

  /** 缓存目录统计：总字节数 + 文件数 */
  async stats(): Promise<{ bytes: number; files: number }> {
    let bytes = 0;
    let files = 0;
    try {
      const list = await fs.readdir(this.dir);
      for (const f of list) {
        try {
          const st = await fs.stat(path.join(this.dir, f));
          if (st.isFile()) {
            bytes += st.size;
            files++;
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return { bytes, files };
  }

  /** 删除缓存文件（只允许删本缓存目录内的，绝不碰用户绝对路径文件） */
  async remove(file: string): Promise<void> {
    if (path.isAbsolute(file)) return; // 用户本地文件不删
    try {
      await fs.unlink(path.join(this.dir, path.basename(file)));
    } catch {
      /* ignore */
    }
  }

  /** 同一 mid 的并发下载合并为一个（避免同一临时文件互相覆盖） */
  ensure(client: QQMusicClient, mid: string): Promise<string> {
    const existing = this.inflight.get(mid);
    if (existing) return existing;
    const p = this.doEnsure(client, mid).finally(() => this.inflight.delete(mid));
    this.inflight.set(mid, p);
    return p;
  }

  /** 确保本地有该歌曲的音频（统一 mp3），返回文件名（失败抛错） */
  private async doEnsure(client: QQMusicClient, mid: string): Promise<string> {
    const file = this.fileFor(mid);
    if (await this.exists(file)) return file;
    const dest = this.absPath(file);
    const tmp = `${dest}.part`;
    await client.songs.downloadToFile({ songmid: mid, quality: this.quality, destPath: tmp });
    await this.normalizeToMp3(tmp, dest, mid);
    return file;
  }

  /** 把下载到的文件归一化为 mp3：已是 mp3 直接改名；否则 ffmpeg 转码。 */
  private async normalizeToMp3(tmp: string, dest: string, mid: string): Promise<void> {
    const codec = await this.probeCodec(tmp);
    if (codec === 'mp3') {
      await fs.rename(tmp, dest);
      return;
    }
    // 非 mp3（含 flac/ape/m4a，或极少数异常/加密格式）→ 转 mp3
    const ok = await this.transcode(tmp, dest);
    if (ok) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      this.logger.info(`[media] ${mid} 已转码为 mp3（源 codec=${codec ?? 'unknown'}）`);
      return;
    }
    // 转码失败：保留原文件（避免丢失），但明确告警
    await fs.rename(tmp, dest).catch(() => undefined);
    this.logger.warn(`[media] ${mid} 归一化为 mp3 失败（源 codec=${codec ?? 'unknown'}），已按原格式保留；若为加密文件请用解密工具（如 Unlock Music）处理`);
  }

  private probeCodec(file: string): Promise<string | null> {
    return new Promise((resolve) => {
      const p = spawn(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', file], { windowsHide: true });
      let out = '';
      p.stdout.on('data', (d: Buffer) => (out += d.toString()));
      p.on('error', () => resolve(null));
      p.on('close', (code) => resolve(code === 0 ? out.trim() || null : null));
    });
  }

  private transcode(src: string, dest: string): Promise<boolean> {
    return new Promise((resolve) => {
      const p = spawn(ffmpegPath, ['-v', 'error', '-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', '-ar', '44100', dest], { windowsHide: true });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    });
  }

  /** 后台队列下载（受限并发） */
  enqueue(
    mid: string,
    client: QQMusicClient,
    opts: { onStart?: (mid: string) => void; onDone?: (mid: string, file: string | null, sizeBytes: number) => void } = {},
  ): void {
    this.queue.push(async () => {
      opts.onStart?.(mid);
      try {
        const file = await this.ensure(client, mid);
        const size = await this.sizeOf(file);
        this.logger.info(`[media] 已缓存 ${mid} -> ${file}`);
        opts.onDone?.(mid, file, size);
      } catch (e) {
        this.logger.warn(`[media] 下载失败 ${mid}: ${(e as Error)?.message}`);
        opts.onDone?.(mid, null, 0);
      }
    });
    this.drain();
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (!job) break;
      this.active++;
      job().finally(() => {
        this.active--;
        this.drain();
      });
    }
  }
}
