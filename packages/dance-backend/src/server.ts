import http from 'http';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { QQMusicError, isQQMusicError, createQQMusicClient } from '@hdbc/qqmusic-sdk';
import type { Quality, Song } from '@hdbc/qqmusic-sdk';
import type { IncomingMessage, ServerResponse } from 'http';
import { ROOT, type BackendConfig } from './config';
import { SessionStore } from './session';
import { LibraryStore } from './library';
import { ClientPool } from './clients';
import { MediaCache } from './media';
import { TaskStore } from './tasks';
import { SetlistStore, generateSetlist, type EventMeta } from './setlist';
import { SettingsStore } from './settings';
import { analyze } from './classifier';
import * as netease from './sources/netease';
import * as pan from './sources/pan';
import { createSourceRegistry, type Draft } from './sources/registry';
import { scanDanceDir, parseDanceFileName, coreName, localMid } from './localscan';
import { sendJson, readBody, parseCookies, setCookie, clearCookie } from './http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ape': 'audio/ape',
  '.m4a': 'audio/mp4',
};

function streamFile(req: IncomingMessage, res: ServerResponse, absPath: string, mime: string): boolean {
  let st: fsSync.Stats;
  try {
    st = fsSync.statSync(absPath);
    if (!st.isFile()) return false;
  } catch {
    return false;
  }
  const isHtml = mime.startsWith('text/html');
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=86400',
  };
  const m = req.headers.range ? /bytes=(\d*)-(\d*)/.exec(req.headers.range) : null;
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= st.size) end = st.size - 1;
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      res.end();
      return true;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) });
    fsSync.createReadStream(absPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': String(st.size) });
    fsSync.createReadStream(absPath).pipe(res);
  }
  return true;
}

export function createServer(cfg: BackendConfig) {
  const sessions = new SessionStore(path.join(cfg.dataDir, 'sessions.json'));
  const library = new LibraryStore(path.join(cfg.dataDir, 'tracks.json'), path.join(cfg.dataDir, 'library.json'));
  const setlists = new SetlistStore(path.join(cfg.dataDir, 'setlists.json'));
  const settings = new SettingsStore(path.join(cfg.dataDir, 'settings.json'));
  const tasks = new TaskStore();
  const pool = new ClientPool(cfg.bridgeUrl, cfg.logger);
  const sources = createSourceRegistry({ pool });

  function eff() {
    const s = settings.get();
    return {
      mediaDir: s.mediaDir ? path.resolve(s.mediaDir) : cfg.mediaDir,
      mediaQuality: (s.mediaQuality as Quality) ?? cfg.mediaQuality,
      autoDownload: s.autoDownload ?? cfg.autoDownload,
      downloadConcurrency: s.downloadConcurrency ?? cfg.downloadConcurrency,
      cacheLimitBytes: s.cacheLimitBytes ?? cfg.cacheLimitBytes,
      autoClassify: s.autoClassify ?? cfg.autoClassify,
      neteaseCookie: s.neteaseCookie ?? cfg.neteaseCookie,
      baiduCookie: s.baiduCookie ?? cfg.baiduCookie,
    };
  }

  let media = new MediaCache(cfg.mediaDir, cfg.mediaQuality, cfg.downloadConcurrency, cfg.logger);
  const webDirs = [cfg.webDir, path.join(ROOT, 'public')];

  /** 按舞种或特殊合集取值（'__liked__' = 我喜欢） */
  function songsOfType(type: string) {
    if (!type) return library.allSongs();
    if (type === '__liked__') return library.likedSongs();
    return library.list(type);
  }

  const ready = Promise.all([sessions.load(), library.load(), setlists.load(), settings.load()]).then(() => {
    const e = eff();
    media = new MediaCache(e.mediaDir, e.mediaQuality, e.downloadConcurrency, cfg.logger);
    netease.setNeteaseCookie(e.neteaseCookie);
    pan.setBaiduCookie(e.baiduCookie);
    try {
      fsSync.mkdirSync(e.mediaDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  const server = http.createServer((req, res) => {
    void (async () => {
      await ready;
      try {
        await route(req, res);
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        cfg.logger.error('[dance-backend]', msg);
        if (isQQMusicError(e)) {
          const status = e.code === 'QQ_AUTH_REQUIRED' || e.code === 'QQ_TOKEN_EXPIRED' ? 401 : 502;
          return sendJson(res, status, { ok: false, error: e.code, message: msg });
        }
        sendJson(res, 500, { ok: false, error: 'SERVER_ERROR', message: msg });
      }
    })();
  });

  /** 对「未分类」的歌自动识别舞种（不覆盖手动设置的舞种） */
  async function classifyOne(mid: string, file: string): Promise<void> {
    const hit = library.findByMid(mid);
    if (!hit || hit.type !== '未分类') return;
    try {
      const r = await analyze(path.join(eff().mediaDir, file));
      await library.updateSong(mid, {
        type: r.type ?? undefined,
        bpm: r.bpm,
        meter: r.meter,
        confidence: r.confidence,
        energy: r.energy,
        mood: r.mood,
        stability: r.stability,
        suitable: r.suitable,
        warning: r.warning,
      });
    } catch (e) {
      cfg.logger.warn('[auto-classify]', mid, (e as Error)?.message);
    }
  }

  function onDownloaded(m: string, file: string | null, size: number): void {
    void (async () => {
      try {
        await library.setFile(m, file, size);
      } catch {
        /* ignore */
      }
      if (!file) return;
      if (eff().autoClassify) await classifyOne(m, file);
      await enforceCacheLimit();
    })();
  }

  async function queueDownloads(mids: string[], type: string | null): Promise<string> {
    const task = tasks.create(type, eff().autoDownload ? mids : []);
    if (!eff().autoDownload || !mids.length) return task.id;
    for (const mid of mids) {
      media.enqueue(mid, () => assetFetcher(mid), {
        onStart: (m) => tasks.start(task.id, m),
        onDone: (m, file, size) => {
          tasks.settle(task.id, m, !!file);
          onDownloaded(m, file, size);
        },
      });
    }
    return task.id;
  }

  /** 外部来源（注册表）解析出可播放直链；返回 null 表示该来源由其它逻辑处理 */
  async function resolveExternalUrl(hit: { song: { source?: string; mid: string; url?: string | null } }): Promise<string | null> {
    const def = sources.get(hit.song.source || 'qqmusic');
    if (def?.streamUrl) return def.streamUrl(hit.song);
    return null;
  }

  /** 按来源取流并落盘：外部来源走直链下载，其余（QQ）走 SDK */
  async function assetFetcher(mid: string): Promise<string> {
    const hit = library.findByMid(mid);
    const src = hit?.song.source;
    if (src === 'local') {
      const f = hit?.song.file;
      if (f && (await media.exists(f))) return f;
      throw new QQMusicError('QQ_UNSUPPORTED', '本地文件不存在');
    }
    if (src && src !== 'qqmusic') {
      const u = await resolveExternalUrl(hit!);
      if (!u) throw new QQMusicError('QQ_UNSUPPORTED', `${src} 来源该曲无可用直链`);
      return media.ensureFromUrl(u, mid);
    }
    const client = await pool.libraryClient();
    return media.ensure(client, mid);
  }

  /** 缓存超限时按 LRU 淘汰（保留最近播放的），只删真正存在于缓存目录里的文件 */
  async function enforceCacheLimit(): Promise<void> {
    const limit = eff().cacheLimitBytes;
    if (!limit || limit <= 0) return;
    let total = await media.totalBytes();
    if (total <= limit) return;
    const target = Math.floor(limit * 0.9); // 清到 90%，避免频繁抖动
    const cands = library
      .allSongs()
      .filter((s) => s.file && !path.isAbsolute(s.file))
      .sort((a, b) => (a.playedAt ?? a.addedAt ?? 0) - (b.playedAt ?? b.addedAt ?? 0));
    for (const s of cands) {
      if (total <= target) break;
      if (!(await media.exists(s.file as string))) continue; // 文件不在缓存目录则跳过，不清标记
      const size = await media.sizeOf(s.file as string);
      await media.remove(s.file as string);
      await library.setFile(s.mid, null);
      total -= size;
      cfg.logger.info(`[media] 缓存超限，淘汰 ${s.mid}（-${Math.round(size / 1048576)}MB）`);
    }
  }

  async function runClassify(taskId: string, songs: Array<{ mid: string; file?: string | null }>): Promise<void> {
    const dir = eff().mediaDir;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < songs.length) {
        const s = songs[cursor++];
        if (!s.file) {
          tasks.settle(taskId, s.mid, false);
          continue;
        }
        tasks.start(taskId, s.mid);
        try {
          const r = await analyze(path.join(dir, s.file));
          await library.updateSong(s.mid, {
            type: r.type ?? undefined,
            bpm: r.bpm,
            meter: r.meter,
            confidence: r.confidence,
            energy: r.energy,
            mood: r.mood,
            stability: r.stability,
            suitable: r.suitable,
            warning: r.warning,
          });
          tasks.setResult(taskId, s.mid, r);
          tasks.settle(taskId, s.mid, true);
        } catch (e) {
          cfg.logger.warn('[classify]', s.mid, (e as Error)?.message);
          tasks.settle(taskId, s.mid, false);
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  /** 批量：未缓存的下载（HQ）再分析，已缓存的直接分析；逐首回写舞种 */
  async function runCacheClassify(taskId: string, songs: Array<{ mid: string; file?: string | null }>): Promise<void> {
    const client = await pool.libraryClient();
    const dir = eff().mediaDir;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < songs.length) {
        const s = songs[cursor++];
        tasks.start(taskId, s.mid);
        try {
          let file = s.file && (await media.exists(s.file)) ? s.file : null;
          if (!file) {
            file = await media.ensure(client, s.mid);
            await library.setFile(s.mid, file, await media.sizeOf(file));
            await enforceCacheLimit();
          }
          const r = await analyze(path.join(dir, file));
          await library.updateSong(s.mid, {
            type: r.type ?? undefined,
            bpm: r.bpm,
            meter: r.meter,
            confidence: r.confidence,
            energy: r.energy,
            mood: r.mood,
            stability: r.stability,
            suitable: r.suitable,
            warning: r.warning,
          });
          tasks.setResult(taskId, s.mid, r);
          tasks.settle(taskId, s.mid, true);
        } catch (e) {
          cfg.logger.warn('[cache-classify]', s.mid, (e as Error)?.message);
          tasks.settle(taskId, s.mid, false);
        }
      }
    };
    const workers = Math.max(1, Math.min(eff().downloadConcurrency, 4));
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }

  function serveWeb(req: IncomingMessage, res: ServerResponse, p: string): boolean {
    const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    for (const dir of webDirs) {
      const abs = path.join(dir, rel);
      if (streamFile(req, res, abs, MIME[path.extname(rel).toLowerCase()] ?? 'application/octet-stream')) return true;
    }
    if (!path.extname(p)) {
      for (const dir of webDirs) {
        const idx = path.join(dir, 'index.html');
        if (streamFile(req, res, idx, MIME['.html'])) return true;
      }
    }
    return false;
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    const method = req.method || 'GET';
    const cookies = parseCookies(req);
    const session = sessions.get(cookies['sid']);
    const isAdmin = !cfg.adminToken || req.headers['x-admin-token'] === cfg.adminToken;

    /* --------------------------- 静态：音频 / 前端 --------------------------- */
    if (p.startsWith('/media/')) {
      const file = path.basename(p.slice('/media/'.length));
      if (streamFile(req, res, path.join(eff().mediaDir, file), MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')) return;
      return sendJson(res, 404, { ok: false, error: 'media not found' });
    }
    if (method === 'GET' && !p.startsWith('/api/') && serveWeb(req, res, p)) return;

    /* ------------------------------- 健康 ------------------------------- */
    if (p === '/api/health') {
      const e = eff();
      return sendJson(res, 200, {
        ok: true,
        libraryTypes: library.types().length,
        sessions: sessions.list().length,
        setlists: setlists.list().length,
        mediaDir: e.mediaDir,
        mediaQuality: e.mediaQuality,
        autoDownload: e.autoDownload,
      });
    }

    /* ------------------------------ 运行时设置 ------------------------------ */
    if (p === '/api/media/usage' && method === 'GET') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const s = await media.stats();
      return sendJson(res, 200, { ok: true, data: { ...s, limit: eff().cacheLimitBytes, mediaDir: eff().mediaDir } });
    }
    if (p === '/api/settings' && method === 'GET') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      return sendJson(res, 200, { ok: true, data: { ...eff(), overrides: settings.get(), defaultMediaDir: cfg.mediaDir } });
    }
    if (p === '/api/settings' && method === 'PUT') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const body = await readBody(req);
      const patch: Record<string, unknown> = {};
      if (typeof body.mediaDir === 'string' && body.mediaDir.trim()) patch.mediaDir = String(body.mediaDir).trim();
      if (typeof body.mediaQuality === 'string') patch.mediaQuality = String(body.mediaQuality);
      if (typeof body.autoDownload === 'boolean') patch.autoDownload = body.autoDownload;
      if (body.downloadConcurrency !== undefined) patch.downloadConcurrency = Number(body.downloadConcurrency);
      if (body.cacheLimitBytes !== undefined) patch.cacheLimitBytes = Number(body.cacheLimitBytes);
      if (typeof body.autoClassify === 'boolean') patch.autoClassify = body.autoClassify;
      if (typeof body.neteaseCookie === 'string') patch.neteaseCookie = String(body.neteaseCookie).trim();
      if (typeof body.baiduCookie === 'string') patch.baiduCookie = String(body.baiduCookie).trim();
      await settings.update(patch);
      const e = eff();
      media = new MediaCache(e.mediaDir, e.mediaQuality, e.downloadConcurrency, cfg.logger);
      netease.setNeteaseCookie(e.neteaseCookie);
      pan.setBaiduCookie(e.baiduCookie);
      try {
        fsSync.mkdirSync(e.mediaDir, { recursive: true });
      } catch {
        /* ignore */
      }
      await enforceCacheLimit();
      return sendJson(res, 200, { ok: true, data: eff() });
    }

    /* --------------------------- 默认曲库（零 token） --------------------------- */
    if (p === '/api/library/types' && method === 'GET') {
      const data = library.types();
      const liked = library.likedSongs();
      data.push({ type: '__liked__', count: liked.length, cached: liked.filter((s) => s.file).length });
      return sendJson(res, 200, { ok: true, data });
    }
    if (p === '/api/library/list' && method === 'GET') {
      if (url.searchParams.get('liked')) return sendJson(res, 200, { ok: true, type: '__liked__', songs: library.likedSongs() });
      const type = url.searchParams.get('type') || '';
      return sendJson(res, 200, { ok: true, type, songs: library.list(type) });
    }
    if (p === '/api/library/import' && method === 'POST') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const body = await readBody(req);
      const type = String(body.type || '');
      if (!type) return sendJson(res, 400, { ok: false, error: 'type required' });
      const client = await pool.libraryClient();
      const detail = await client.playlists.importPlaylist({
        url: body.url ? String(body.url) : undefined,
        disstid: body.disstid ? String(body.disstid) : undefined,
        limit: Number(body.limit ?? 1000),
      });
      const r = await library.importDetail(type, detail);
      const taskId = await queueDownloads(r.newMids, type);
      return sendJson(res, 200, { ok: true, type, name: detail.name, added: r.added, skipped: r.skipped, queued: r.newMids.length, taskId });
    }
    // 导入「我喜欢」（dirid=201，走客户端镜像的会员账号）；默认只导元数据，不批量下载（播放时再缓存）
    if (p === '/api/library/import-liked' && method === 'POST') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const body = await readBody(req);
      const type = String(body.type || '未分类');
      const download = !!body.download;
      const limit = Number(body.limit ?? 0);
      // 优先用当前登录用户自己的账号；否则用客户端镜像的会员账号
      const client = session ? await pool.userClient(session) : await pool.libraryClient();
      const all: Song[] = [];
      let total = 0;
      for (let pageNum = 1; pageNum <= 50; pageNum++) {
        const d = await client.user.liked({ page: pageNum, limit: 1000 });
        total = d.songCount || total;
        all.push(...d.songs);
        if (limit && all.length >= limit) break;
        if (!d.songsTruncated || !d.songs.length) break;
      }
      const picked = limit ? all.slice(0, limit) : all;
      const r = await library.addSongs(type, picked);
      await library.setLiked(picked.map((s) => s.mid)); // 标记进「我喜欢」合集（稳定保留）
      let taskId: string | undefined;
      if (download && r.newMids.length) taskId = await queueDownloads(r.newMids, type);
      return sendJson(res, 200, { ok: true, type, name: '我喜欢', total, fetched: picked.length, added: r.added, skipped: r.skipped, queued: download ? r.newMids.length : 0, taskId });
    }
    // 按 HBDC 文件命名规则「舞种-歌曲名-歌手」精确校准曲库
    if (p === '/api/library/calibrate' && method === 'POST') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const body = await readBody(req);
      const addMissing = !!body.addMissing;
      const dryRun = !!body.dryRun;
      let parsed: Array<{ file?: string; type: string; name: string; artists: string[]; durationMs: number | null }> = [];
      let audio = 0;
      const unparsed: string[] = [];
      if (body.dir) {
        const dir = path.resolve(String(body.dir));
        try {
          const r = await scanDanceDir(dir, !!body.recursive);
          parsed = r.files;
          audio = r.audio;
          unparsed.push(...r.unparsed);
        } catch (e) {
          return sendJson(res, 400, { ok: false, error: '无法读取目录：' + (e as Error).message });
        }
      } else if (Array.isArray(body.entries)) {
        parsed = (body.entries as Array<Record<string, unknown>>).map((e) => ({
          type: String(e.type || ''),
          name: String(e.name || ''),
          artists: Array.isArray(e.artists) ? (e.artists as unknown[]).map(String) : [],
          durationMs: null,
        }));
      } else {
        return sendJson(res, 400, { ok: false, error: 'dir 或 entries 必填' });
      }

      const all = library.allSongs();
      const byCore = new Map<string, typeof all>();
      for (const s of all) {
        const k = coreName(s.name);
        const arr = byCore.get(k) ?? [];
        arr.push(s);
        byCore.set(k, arr);
      }
      const report = {
        scanned: parsed.length,
        audio,
        matched: 0,
        updated: 0,
        unchanged: 0,
        added: 0,
        unmatched: [] as Array<{ name: string; type: string; artists: string[]; file: string | null }>,
      };
      for (const e of parsed) {
        if (!e.type || !e.name) continue;
        const k = coreName(e.name);
        let cands = byCore.get(k);
        if (!cands) {
          cands = all.filter((s) => {
            const c = coreName(s.name);
            return c !== '' && (c.includes(k) || k.includes(c));
          });
        }
        let hit = cands.length
          ? e.artists.length
            ? cands.find((s) => s.artists.some((a) => e.artists.some((b) => a.includes(b) || b.includes(a)))) ?? cands[0]
            : cands[0]
          : undefined;
        if (hit) {
          report.matched++;
          if (hit.type !== e.type) {
            report.updated++;
            if (!dryRun) await library.updateSong(hit.mid, { type: e.type, confidence: 1, warning: null });
          } else {
            report.unchanged++;
          }
        } else if (addMissing && e.file) {
          if (!dryRun) {
            const mid = localMid(e.file);
            await library.addLocalSong(e.type, { mid, name: e.name, artists: e.artists, durationMs: e.durationMs ?? 0, file: e.file });
          }
          report.added++;
        } else {
          report.unmatched.push({ name: e.name, type: e.type, artists: e.artists, file: e.file ?? null });
        }
      }
      return sendJson(res, 200, { ok: true, data: { ...report, unparsed: unparsed.slice(0, 50) } });
    }
    if (p === '/api/library/download' && method === 'POST') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const body = await readBody(req);
      const type = String(body.type || '');
      const source = body.source ? String(body.source) : '';
      let songs = type ? songsOfType(type) : library.allSongs();
      if (source) songs = songs.filter((s) => (s.source || 'qqmusic') === source);
      const missing = songs.filter((s) => !s.file).map((s) => s.mid);
      const taskId = await queueDownloads(missing, type || null);
      return sendJson(res, 200, { ok: true, queued: missing.length, taskId });
    }
    // 按来源清空曲库（可顺带删除缓存文件；绝不删用户本地文件）
    if (p === '/api/library/delete-by-source' && method === 'POST') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const body = await readBody(req);
      const source = String(body.source || '');
      if (!source || source === 'all') return sendJson(res, 400, { ok: false, error: 'source required' });
      const purge = !!body.purgeFiles;
      const files: string[] = [];
      for (const s of library.allSongs()) {
        if ((s.source || 'qqmusic') === source && s.file && !path.isAbsolute(s.file)) files.push(s.file);
      }
      const removed = await library.removeBySource(source);
      let purged = 0;
      if (purge) {
        for (const f of files) {
          await media.remove(f);
          purged++;
        }
      }
      return sendJson(res, 200, { ok: true, source, removed, purged });
    }
    if (p === '/api/library/song' && method === 'PUT') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const body = await readBody(req);
      const mid = String(body.mid || '');
      if (!mid) return sendJson(res, 400, { ok: false, error: 'mid required' });
      const patch: Record<string, unknown> = {};
      if (typeof body.name === 'string') patch.name = body.name;
      if (Array.isArray(body.artists)) patch.artists = (body.artists as unknown[]).map(String);
      if (typeof body.album === 'string') patch.album = body.album;
      if (typeof body.type === 'string' && body.type) patch.type = body.type;
      if (typeof body.suitable === 'boolean') patch.suitable = body.suitable;
      if (typeof body.warning === 'string' || body.warning === null) patch.warning = body.warning;
      if (body.rights === 'external' || body.rights === 'club') patch.rights = body.rights;
      if (typeof body.edited === 'boolean') patch.edited = body.edited;
      const song = await library.updateSong(mid, patch);
      if (!song) return sendJson(res, 404, { ok: false, error: 'song not found' });
      return sendJson(res, 200, { ok: true, data: song });
    }
    if (p === '/api/library/song' && method === 'DELETE') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const mid = url.searchParams.get('mid') || String((await readBody(req)).mid || '');
      if (!mid) return sendJson(res, 400, { ok: false, error: 'mid required' });
      const ok = await library.removeSong(mid);
      if (!ok) return sendJson(res, 404, { ok: false, error: 'song not found' });
      return sendJson(res, 200, { ok: true });
    }
    // 重新扫描缓存目录：文件存在的补上 file 标记/大小，缺失的清掉（换目录/手工删文件后校正）
    if (p === '/api/library/scan' && method === 'POST') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      let linked = 0;
      let cleared = 0;
      for (const s of library.allSongs()) {
        if (s.file && path.isAbsolute(s.file)) continue; // 用户本地文件不动
        const candidate = media.fileFor(s.mid);
        if (await media.exists(candidate)) {
          if (s.file !== candidate) {
            await library.setFile(s.mid, candidate, await media.sizeOf(candidate));
            linked++;
          }
        } else if (s.file) {
          await library.setFile(s.mid, null);
          cleared++;
        }
      }
      return sendJson(res, 200, { ok: true, linked, cleared });
    }
    // 自动舞种分类（基于 aubio BPM + 节拍）：对已缓存音频逐个分析并回写舞种
    if (p === '/api/library/classify' && method === 'POST') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const body = await readBody(req);
      const type = String(body.type || '');
      // 只跳过人工类型（集体舞）；「未分类」等都可自动识别（只处理已缓存音频）
      const manual = new Set(['集体舞']);
      const songs = (type ? songsOfType(type) : library.allSongs()).filter((s) => s.file && !manual.has(s.type));
      const task = tasks.create(type || 'all', songs.map((s) => s.mid), 'classify');
      void runClassify(task.id, songs);
      return sendJson(res, 200, { ok: true, queued: songs.length, taskId: task.id });
    }
    // 批量「缓存 + 分类」：未缓存的先下载（HQ），再分析舞种；受 20GB 缓存上限约束
    if (p === '/api/library/cache-classify' && method === 'POST') {
      if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const body = await readBody(req);
      const type = String(body.type || '未分类');
      const limit = Number(body.limit ?? 0);
      const manual = new Set(['集体舞']);
      let songs = songsOfType(type).filter((s) => !manual.has(s.type));
      if (limit > 0) songs = songs.slice(0, limit);
      const task = tasks.create(type, songs.map((s) => s.mid), 'cacheClassify');
      void runCacheClassify(task.id, songs);
      return sendJson(res, 200, { ok: true, queued: songs.length, taskId: task.id });
    }

    /* ------------------------------ 任务进度 ------------------------------ */
    if (p === '/api/tasks' && method === 'GET') return sendJson(res, 200, { ok: true, data: tasks.list() });
    const taskMatch = p.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && method === 'GET') {
      const t = tasks.get(taskMatch[1]);
      if (!t) return sendJson(res, 404, { ok: false, error: 'task not found' });
      return sendJson(res, 200, { ok: true, data: t });
    }

    /* ------------------------------ 搜索（匿名） ------------------------------ */
    if (p === '/api/search' && method === 'GET') {
      const client = await pool.anonymous();
      const page = await client.search.songs({
        keyword: url.searchParams.get('keywords') || url.searchParams.get('q') || '',
        limit: Number(url.searchParams.get('limit') || 20),
      });
      return sendJson(res, 200, { ok: true, ...page });
    }
    if (p === '/api/search/playlists' && method === 'GET') {
      const client = await pool.anonymous();
      const page = await client.search.playlists({ keyword: url.searchParams.get('keywords') || '', limit: Number(url.searchParams.get('limit') || 20) });
      return sendJson(res, 200, { ok: true, ...page });
    }
    // 可用下载来源（来源注册表）
    if (p === '/api/sources' && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        data: [...sources.values()].map((d) => ({ id: d.id, label: d.label, kind: d.kind, auth: d.authed(), search: !!d.search })),
      });
    }
    // 来源通用搜索：GET /api/source/:id/search?keywords=&type=song|playlist&limit=
    {
      const m = p.match(/^\/api\/source\/([^/]+)\/search$/);
      if (m && method === 'GET') {
        const def = sources.get(m[1]);
        if (!def) return sendJson(res, 404, { ok: false, error: 'unknown source' });
        if (!def.search) return sendJson(res, 400, { ok: false, error: '该来源不支持搜索' });
        const kw = url.searchParams.get('keywords') || '';
        const kind = url.searchParams.get('type') || 'song';
        const limit = Number(url.searchParams.get('limit') || 20);
        return sendJson(res, 200, { ok: true, kind, items: await def.search(kw, kind, limit) });
      }
    }
    // 来源通用导入：POST /api/source/:id/import  { type, download?, ...来源参数 }
    {
      const m = p.match(/^\/api\/source\/([^/]+)\/import$/);
      if (m && method === 'POST') {
        if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });
        const def = sources.get(m[1]);
        if (!def) return sendJson(res, 404, { ok: false, error: 'unknown source' });
        const body = await readBody(req);
        const defaultType = String(body.type || '未分类');
        let built: { name?: string; drafts: Draft[]; note?: string };
        try {
          built = await def.build(body);
        } catch (e) {
          return sendJson(res, 502, { ok: false, error: 'SOURCE_ERROR', message: (e as Error).message });
        }
        let added = 0;
        let skipped = 0;
        const newMids: string[] = [];
        const byType = new Map<string, Draft[]>();
        for (const d of built.drafts) {
          const ty = d.type || defaultType;
          const arr = byType.get(ty) ?? [];
          arr.push(d);
          byType.set(ty, arr);
        }
        for (const [ty, list] of byType) {
          for (const d of list) {
            if (d.local && d.file) {
              const isNew = await library.addLocalSong(ty, { mid: d.id, name: d.name, artists: d.artists ?? [], durationMs: d.durationMs ?? 0, file: d.file });
              if (isNew) {
                added++;
                newMids.push(d.id);
              } else skipped++;
            }
          }
          const externals = list.filter((d) => !(d.local && d.file));
          if (externals.length) {
            const r = await library.addExternalSongs(
              ty,
              externals.map((d) => ({ id: d.id, name: d.name, artists: d.artists, album: d.album, durationMs: d.durationMs, coverUrl: d.coverUrl, url: d.url })),
              def.id,
            );
            added += r.added;
            skipped += r.skipped;
            newMids.push(...r.newMids);
          }
        }
        const download = !!body.download;
        const taskId = download && newMids.length ? await queueDownloads(newMids, defaultType) : undefined;
        return sendJson(res, 200, { ok: true, source: def.id, name: built.name, note: built.note, total: built.drafts.length, added, skipped, queued: download ? newMids.length : 0, taskId });
      }
    }
    /* 各来源导入已收敛到上面的 /api/source/:id/import 通用路由 */

    /* -------------------------------- 歌曲 -------------------------------- */
    if (p === '/api/song/detail' && method === 'GET') {
      const client = await pool.anonymous();
      const song = await client.songs.detail({ songmid: url.searchParams.get('mid') || '' });
      return sendJson(res, 200, { ok: true, data: song });
    }
    if (p === '/api/song/url' && method === 'GET') {
      const mid = url.searchParams.get('mid') || '';
      const quality = (url.searchParams.get('quality') || eff().mediaQuality) as Quality;
      const hit = library.findByMid(mid);
      if (hit?.song.file && (await media.exists(hit.song.file))) {
        void library.markPlayed(mid);
        const local = hit.song.file;
        const u = path.isAbsolute(local) ? `/api/song/stream?mid=${encodeURIComponent(mid)}` : `/media/${local}`;
        return sendJson(res, 200, { ok: true, data: { songmid: mid, quality: eff().mediaQuality, url: u, local: true, expiresAt: null } });
      }
      if (hit?.song.source && hit.song.source !== 'qqmusic' && hit.song.source !== 'local') {
        const eu = await resolveExternalUrl(hit);
        if (eff().autoDownload && !hit.song.file) media.enqueue(mid, () => assetFetcher(mid), { onDone: onDownloaded });
        if (!eu) return sendJson(res, 502, { ok: false, error: 'SOURCE_UNSUPPORTED', message: `${hit.song.source} 来源该曲无可用直链` });
        return sendJson(res, 200, { ok: true, data: { songmid: mid, quality: '320', url: eu, local: false, expiresAt: null } });
      }
      const client = session ? await pool.userClient(session) : await pool.libraryClient();
      const u = await client.songs.url({ songmid: mid, quality });
      if (hit && eff().autoDownload && !hit.song.file) {
        media.enqueue(mid, () => assetFetcher(mid), { onDone: onDownloaded });
      }
      return sendJson(res, 200, { ok: true, data: { ...u, local: false } });
    }
    // 给播放器直接用的音频地址（302 到本地缓存或 QQ 直链）
    if (p === '/api/song/stream' && method === 'GET') {
      const mid = url.searchParams.get('mid') || '';
      const quality = (url.searchParams.get('quality') || eff().mediaQuality) as Quality;
      const hit = library.findByMid(mid);
      if (hit?.song.file && (await media.exists(hit.song.file))) {
        void library.markPlayed(mid);
        const local = hit.song.file;
        if (path.isAbsolute(local)) {
          if (streamFile(req, res, local, MIME[path.extname(local).toLowerCase()] ?? 'audio/mpeg')) return;
          return sendJson(res, 404, { ok: false, error: 'media not found' });
        }
        res.writeHead(302, { Location: `/media/${local}` });
        res.end();
        return;
      }
      if (hit?.song.source && hit.song.source !== 'qqmusic' && hit.song.source !== 'local') {
        const eu = await resolveExternalUrl(hit);
        if (eff().autoDownload && !hit.song.file) media.enqueue(mid, () => assetFetcher(mid), { onDone: onDownloaded });
        if (!eu) {
          const nb = Buffer.from(JSON.stringify({ ok: false, error: 'SOURCE_UNSUPPORTED', message: `${hit.song.source} 来源该曲无可用直链` }), 'utf8');
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(nb.length) });
          res.end(nb);
          return;
        }
        res.writeHead(302, { Location: eu });
        res.end();
        return;
      }
      const client = session ? await pool.userClient(session) : await pool.libraryClient();
      const u = await client.songs.url({ songmid: mid, quality });
      // 点击播放即后台缓存：一边用 QQ 直链播，一边下载到本地（下次即离线）
      if (hit && eff().autoDownload && !hit.song.file) {
        media.enqueue(mid, () => assetFetcher(mid), { onDone: onDownloaded });
      }
      res.writeHead(302, { Location: u.url });
      res.end();
      return;
    }
    // 歌词：默认返回 text/plain（给 APlayer lrc 用），?json=1 返回 JSON
    if (p === '/api/song/lyric' && method === 'GET') {
      const mid = url.searchParams.get('mid') || '';
      const hit = library.findByMid(mid);
      let lyr: { lyric: string; trans?: string | null };
      if (hit?.song.source === 'netease') {
        lyr = await netease.lyric(hit.song.mid);
      } else {
        const client = await pool.anonymous();
        lyr = await client.songs.lyric({ songmid: mid });
      }
      if (url.searchParams.get('json')) return sendJson(res, 200, { ok: true, data: lyr });
      const buf = Buffer.from(lyr.lyric || '', 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': String(buf.length), 'Cache-Control': 'public, max-age=86400' });
      res.end(buf);
      return;
    }

    /* ---------------------------- 扫码登录（每用户） ---------------------------- */
    if (p === '/api/auth/qr/start' && method === 'POST') {
      const body = await readBody(req);
      const type = body.type === 'wx' ? 'wx' : 'qq';
      const start = await pool.qrLogin().start(type);
      return sendJson(res, 200, { ok: true, ...start });
    }
    if (p === '/api/auth/qr/check' && method === 'GET') {
      const type = url.searchParams.get('type') === 'wx' ? 'wx' : 'qq';
      const token = url.searchParams.get('token') || '';
      const result = await pool.qrLogin().check(type, token);
      if (result.state === 'confirmed' && result.cookie) {
        let profile: { nickname?: string | null; vip?: boolean } | undefined;
        try {
          const c = await createQQMusicClient({ seedCookie: result.cookie });
          const pr = await c.user.profile();
          c.auth.stopAutoRefresh();
          profile = { nickname: pr.nickname, vip: pr.vip };
        } catch {
          /* ignore */
        }
        const s = await sessions.create(result.cookie, profile);
        setCookie(res, 'sid', s.sid, { maxAge: 60 * 60 * 24 * 30 });
        return sendJson(res, 200, { ok: true, state: result.state, user: { uin: s.uin, nickname: s.nickname, vip: s.vip } });
      }
      return sendJson(res, 200, { ok: true, state: result.state });
    }
    if (p === '/api/auth/me' && method === 'GET') {
      if (!session) return sendJson(res, 200, { ok: true, user: null });
      return sendJson(res, 200, { ok: true, user: { uin: session.uin, nickname: session.nickname, vip: session.vip, createdAt: session.createdAt } });
    }
    if (p === '/api/auth/logout' && method === 'POST') {
      if (session) {
        await sessions.remove(session.sid);
        pool.evictUser(session.sid);
      }
      clearCookie(res, 'sid');
      return sendJson(res, 200, { ok: true });
    }

    /* ------------------------------ 歌单 ------------------------------ */
    if (p === '/api/playlist/resolve' && method === 'POST') {
      const body = await readBody(req);
      const client = await pool.anonymous();
      const r = await client.playlists.resolve({ input: String(body.input || '') });
      return sendJson(res, 200, { ok: true, ...r });
    }
    if (p === '/api/playlist/import' && method === 'GET') {
      const client = await pool.libraryClient();
      const detail = await client.playlists.importPlaylist({
        url: url.searchParams.get('url') || undefined,
        disstid: url.searchParams.get('disstid') || undefined,
        limit: Number(url.searchParams.get('limit') || 1000),
      });
      return sendJson(res, 200, { ok: true, data: detail });
    }
    if (p === '/api/playlist/clone' && method === 'POST') {
      if (!session) throw new QQMusicError('QQ_AUTH_REQUIRED', '请先扫码登录');
      const body = await readBody(req);
      const client = await pool.userClient(session);
      const r = await client.playlists.clone({
        url: body.url ? String(body.url) : undefined,
        disstid: body.disstid ? String(body.disstid) : undefined,
        name: String(body.name || '导入歌单'),
        dirid: body.dirid as string | number | undefined,
        limit: Number(body.limit ?? 1000),
      });
      return sendJson(res, 200, { ok: true, data: r });
    }
    if (p === '/api/user/playlists' && method === 'GET') {
      if (!session) throw new QQMusicError('QQ_AUTH_REQUIRED', '请先扫码登录');
      const client = await pool.userClient(session);
      const list = await client.user.playlists();
      return sendJson(res, 200, { ok: true, data: list });
    }

    /* ------------------------------ 排曲 ------------------------------ */
    if (p === '/api/setlist/generate' && method === 'POST') {
      const body = await readBody(req);
      const songs = generateSetlist(library, {
        durationMin: Number(body.durationMin ?? 120),
        weights: (body.weights as Record<string, number>) || {},
        mode: body.mode === 'sequential' ? 'sequential' : 'weighted',
        fill: body.fill !== false,
        order: Array.isArray(body.order) ? (body.order as string[]).map(String) : undefined,
      });
      const totalMs = songs.reduce((s, x) => s + (x.durationMs || 0), 0);
      let saved = null;
      if (body.name) saved = await setlists.save_list(String(body.name), songs, Number(body.durationMin ?? 120));
      return sendJson(res, 200, { ok: true, totalMs, songs, saved });
    }
    if (p === '/api/setlist' && method === 'POST') {
      const body = await readBody(req);
      const raw: Array<{ mid?: unknown; playMs?: unknown }> = Array.isArray(body.songs)
        ? (body.songs as Array<{ mid?: unknown; playMs?: unknown }>)
        : Array.isArray(body.mids)
          ? (body.mids as unknown[]).map((mid) => ({ mid }))
          : [];
      const songs = raw
        .map((it) => {
          const hit = library.findByMid(String(it.mid ?? ''));
          if (!hit) return null;
          const s = hit.song;
          const playMs = Number(it.playMs);
          return {
            mid: s.mid,
            name: s.name,
            artists: s.artists,
            type: s.type,
            durationMs: s.durationMs,
            file: s.file ?? null,
            playMs: Number.isFinite(playMs) && playMs > 0 ? playMs : null,
          };
        })
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      const setlist = await setlists.save_list(String(body.name || '未命名排曲'), songs, Number(body.targetMin) || undefined, (body.event as EventMeta) || undefined);
      return sendJson(res, 200, { ok: true, data: setlist });
    }
    // 导入一份「排曲传递文件」
    if (p === '/api/setlist/import' && method === 'POST') {
      const body = await readBody(req);
      const rawSongs = Array.isArray(body.songs) ? (body.songs as Array<Record<string, unknown>>) : [];
      const songs = rawSongs
        .map((s) => ({
          mid: String(s.mid ?? ''),
          name: String(s.name ?? ''),
          artists: Array.isArray(s.artists) ? (s.artists as unknown[]).map(String) : [],
          type: String(s.type ?? ''),
          durationMs: Number(s.durationMs) || 0,
          file: null as string | null,
          playMs: Number(s.playMs) > 0 ? Number(s.playMs) : null,
        }))
        .filter((s) => s.mid || s.name);
      const setlist = await setlists.save_list(String(body.name || '导入排曲'), songs, Number(body.targetMin) || undefined, (body.event as EventMeta) || undefined);
      return sendJson(res, 200, { ok: true, data: setlist });
    }
    // 导出「排曲传递文件」（下载 JSON）
    const exMatch = p.match(/^\/api\/setlist\/([^/]+)\/export$/);
    if (exMatch && method === 'GET') {
      const sl = setlists.get(exMatch[1]);
      if (!sl) return sendJson(res, 404, { ok: false, error: 'setlist not found' });
      const file = {
        format: 'hdbc-setlist',
        version: 1,
        name: sl.name,
        event: sl.event || {},
        targetMin: sl.targetMin ?? null,
        totalMs: sl.totalMs,
        exportedAt: new Date().toISOString(),
        songs: sl.songs,
      };
      const buf = Buffer.from(JSON.stringify(file, null, 2), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="hdbc-setlist-${exMatch[1]}.json"`,
        'Content-Length': String(buf.length),
      });
      res.end(buf);
      return;
    }
    if (p === '/api/setlists' && method === 'GET') return sendJson(res, 200, { ok: true, data: setlists.list() });
    const slMatch = p.match(/^\/api\/setlist\/([^/]+)$/);
    if (slMatch && method === 'GET') {
      const sl = setlists.get(slMatch[1]);
      if (!sl) return sendJson(res, 404, { ok: false, error: 'setlist not found' });
      return sendJson(res, 200, { ok: true, data: sl });
    }
    if (slMatch && method === 'DELETE') {
      await setlists.remove(slMatch[1]);
      return sendJson(res, 200, { ok: true });
    }

    sendJson(res, 404, { ok: false, error: 'not found', path: p });
  }

  return { server, sessions, library, pool, media, tasks, setlists };
}
