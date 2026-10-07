'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = process.env.MUSIC_FETCHER_CONFIG || path.join(ROOT, 'config.json');

const DEFAULTS = {
  server: { host: '127.0.0.1', port: 8787, token: '' },
  paths: {
    downloadDir: './.work/download',
    libraryDir: './.work/library',
    workDir: './.work',
    tuneFreeExe: '',
    musicApiBase: 'http://127.0.0.1:3300',
    ffmpeg: '',
  },
  converter: {
    bitrate: '320k',
    keepSource: false,
    // mock=true 时不去调用 TuneFree，直接把加密文件当 mp3 拷出来，便于没有 QQ 音乐环境时自测
    mock: true,
    extraArgs: [],
  },
  watcher: {
    enabled: true,
    pollIntervalMs: 3000,
    // 连续 N 轮文件大小不变才认为下载完成
    stableRounds: 2,
    extensions: ['.mflac', '.mgg', '.mflac0', '.mflac1', '.mgg0', '.mgg1'],
  },
  engine: {
    // web: 走 Web API 直链下载（不依赖客户端）；client: 加歌到歌单触发客户端下载 + TuneFree 解密
    default: 'web',
    // 「补歌队列」歌单的 dirid，engine=client 时必填
    playlistDirId: 0,
  },
  import: {
    // keep: 保留原文件名；artist-title: 重命名为「歌手 - 歌名」
    naming: 'keep',
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function resolvePath(p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

function loadConfig() {
  let fileCfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  const cfg = deepMerge(DEFAULTS, fileCfg);

  // 环境变量覆盖，方便临时调试 / 部署
  if (process.env.MF_PORT) cfg.server.port = Number(process.env.MF_PORT);
  if (process.env.MF_MUSIC_API) cfg.paths.musicApiBase = process.env.MF_MUSIC_API;
  if (process.env.MF_TUNEFREE) cfg.paths.tuneFreeExe = process.env.MF_TUNEFREE;
  if (process.env.MF_DOWNLOAD_DIR) cfg.paths.downloadDir = process.env.MF_DOWNLOAD_DIR;
  if (process.env.MF_LIBRARY_DIR) cfg.paths.libraryDir = process.env.MF_LIBRARY_DIR;
  if (process.env.MF_MOCK) cfg.converter.mock = process.env.MF_MOCK !== '0';

  cfg.paths.downloadDir = resolvePath(cfg.paths.downloadDir);
  cfg.paths.libraryDir = resolvePath(cfg.paths.libraryDir);
  cfg.paths.workDir = resolvePath(cfg.paths.workDir);
  cfg.paths.tuneFreeExe = resolvePath(cfg.paths.tuneFreeExe);
  cfg.paths.ffmpeg = resolvePath(cfg.paths.ffmpeg);
  return cfg;
}

module.exports = { ROOT, CONFIG_PATH, DEFAULTS, loadConfig, deepMerge, resolvePath };
