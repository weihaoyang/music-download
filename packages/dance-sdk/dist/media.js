"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaCache = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const ffmpegPath = process.env.MF_FFMPEG || 'ffmpeg';
const ffprobePath = process.env.MF_FFPROBE || 'ffprobe';
/** 本地音频缓存：下载成文件（统一转成 mp3），彻底摆脱运行时对 QQ 的依赖 */
class MediaCache {
    constructor(dir, quality, concurrency, logger) {
        this.dir = dir;
        this.quality = quality;
        this.concurrency = concurrency;
        this.logger = logger;
        this.active = 0;
        this.queue = [];
        this.inflight = new Map();
    }
    /**
     * 缓存文件名。统一以 .mp3 结尾：下载后会用 ffmpeg 归一化为 mp3
     * （HQ/320 本身就是 mp3，避免后续播放器遇到 flac/ape/m4a/加密格式）。
     */
    fileFor(mid) {
        return `${mid}.mp3`;
    }
    absPath(file) {
        // 本地文件可能保存为绝对路径（按文件名校准时导入）
        return path_1.default.isAbsolute(file) ? file : path_1.default.join(this.dir, file);
    }
    async exists(file) {
        try {
            const st = await promises_1.default.stat(this.absPath(file));
            return st.size > 0;
        }
        catch {
            return false;
        }
    }
    async sizeOf(file) {
        try {
            return (await promises_1.default.stat(this.absPath(file))).size;
        }
        catch {
            return 0;
        }
    }
    /** 目录内所有缓存文件的总大小（字节） */
    async totalBytes() {
        return (await this.stats()).bytes;
    }
    /** 缓存目录统计：总字节数 + 文件数 */
    async stats() {
        let bytes = 0;
        let files = 0;
        try {
            const list = await promises_1.default.readdir(this.dir);
            for (const f of list) {
                try {
                    const st = await promises_1.default.stat(path_1.default.join(this.dir, f));
                    if (st.isFile()) {
                        bytes += st.size;
                        files++;
                    }
                }
                catch {
                    /* ignore */
                }
            }
        }
        catch {
            /* ignore */
        }
        return { bytes, files };
    }
    /** 删除缓存文件（只允许删本缓存目录内的，绝不碰用户绝对路径文件） */
    async remove(file) {
        if (path_1.default.isAbsolute(file))
            return; // 用户本地文件不删
        try {
            await promises_1.default.unlink(path_1.default.join(this.dir, path_1.default.basename(file)));
        }
        catch {
            /* ignore */
        }
    }
    /** 同一 mid 的并发下载合并为一个（避免同一临时文件互相覆盖） */
    ensureFile(mid, producer) {
        const existing = this.inflight.get(mid);
        if (existing)
            return existing;
        const p = (async () => {
            const file = this.fileFor(mid);
            if (await this.exists(file))
                return file;
            const dest = this.absPath(file);
            const tmp = `${dest}.part`;
            await producer(tmp);
            await this.normalizeToMp3(tmp, dest, mid);
            return file;
        })().finally(() => this.inflight.delete(mid));
        this.inflight.set(mid, p);
        return p;
    }
    /** QQ 音乐：确保本地有该歌曲的音频（统一 mp3） */
    ensure(client, mid) {
        return this.ensureFile(mid, async (tmp) => {
            await client.songs.downloadToFile({ songmid: mid, quality: this.quality, destPath: tmp });
        });
    }
    /** 任意直链（网易云 / HTTP 来源）：下载到本地并转 mp3；给 expectedDurationMs 时拒绝试听片段 */
    ensureFromUrl(url, mid, opts = {}) {
        return this.ensureFile(mid, async (tmp) => {
            const r = await fetch(url);
            if (!r.ok)
                throw new Error(`下载失败 HTTP ${r.status}`);
            await promises_1.default.writeFile(tmp, Buffer.from(await r.arrayBuffer()));
            if (opts.expectedDurationMs && opts.expectedDurationMs > 0) {
                const dur = await this.probeDurationMs(tmp);
                if (dur > 0 && dur < opts.expectedDurationMs * 0.7) {
                    await promises_1.default.rm(tmp, { force: true }).catch(() => undefined);
                    throw new Error(`返回的是试听片段（${Math.round(dur / 1000)}s < 完整 ${Math.round(opts.expectedDurationMs / 1000)}s），需登录 Cookie/会员`);
                }
            }
        });
    }
    /** 用 ffprobe 读音频时长（毫秒），失败返回 0 */
    probeDurationMs(file) {
        return new Promise((resolve) => {
            const p = (0, child_process_1.spawn)(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { windowsHide: true });
            let out = '';
            p.stdout.on('data', (d) => (out += d.toString()));
            p.on('error', () => resolve(0));
            p.on('close', () => resolve(Math.round((parseFloat(out.trim()) || 0) * 1000)));
        });
    }
    /** 把下载到的文件归一化为 mp3：已是 mp3 直接改名；否则 ffmpeg 转码。 */
    async normalizeToMp3(tmp, dest, mid) {
        const codec = await this.probeCodec(tmp);
        if (codec === 'mp3') {
            await promises_1.default.rename(tmp, dest);
            return;
        }
        // 非 mp3（含 flac/ape/m4a，或极少数异常/加密格式）→ 转 mp3
        const ok = await this.transcode(tmp, dest);
        if (ok) {
            await promises_1.default.rm(tmp, { force: true }).catch(() => undefined);
            this.logger.info(`[media] ${mid} 已转码为 mp3（源 codec=${codec ?? 'unknown'}）`);
            return;
        }
        // 转码失败：保留原文件（避免丢失），但明确告警
        await promises_1.default.rename(tmp, dest).catch(() => undefined);
        this.logger.warn(`[media] ${mid} 归一化为 mp3 失败（源 codec=${codec ?? 'unknown'}），已按原格式保留；若为加密文件请用解密工具（如 Unlock Music）处理`);
    }
    probeCodec(file) {
        return new Promise((resolve) => {
            const p = (0, child_process_1.spawn)(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', file], { windowsHide: true });
            let out = '';
            p.stdout.on('data', (d) => (out += d.toString()));
            p.on('error', () => resolve(null));
            p.on('close', (code) => resolve(code === 0 ? out.trim() || null : null));
        });
    }
    transcode(src, dest) {
        return new Promise((resolve) => {
            const p = (0, child_process_1.spawn)(ffmpegPath, ['-v', 'error', '-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', '-ar', '44100', dest], { windowsHide: true });
            p.on('error', () => resolve(false));
            p.on('close', (code) => resolve(code === 0));
        });
    }
    /** 后台队列下载（受限并发）；fetcher 返回本地文件名；失败时回传原因 */
    enqueue(mid, fetcher, opts = {}) {
        this.queue.push(async () => {
            opts.onStart?.(mid);
            try {
                const file = await fetcher();
                const size = await this.sizeOf(file);
                this.logger.info(`[media] 已缓存 ${mid} -> ${file}`);
                opts.onDone?.(mid, file, size);
            }
            catch (e) {
                const msg = e?.message || String(e);
                this.logger.warn(`[media] 下载失败 ${mid}: ${msg}`);
                opts.onDone?.(mid, null, 0, msg);
            }
        });
        this.drain();
    }
    drain() {
        while (this.active < this.concurrency && this.queue.length) {
            const job = this.queue.shift();
            if (!job)
                break;
            this.active++;
            job().finally(() => {
                this.active--;
                this.drain();
            });
        }
    }
}
exports.MediaCache = MediaCache;
//# sourceMappingURL=media.js.map