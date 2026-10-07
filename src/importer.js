'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { sanitize, ensureDir, move } = require('./util');

/**
 * 把已经解好的音频文件规范化后放进曲库目录。
 * - naming=keep：保留原文件名
 * - naming=artist-title：重命名为「歌手 - 歌名」
 * 同名冲突时自动加 (2)、(3) 后缀，绝不覆盖已有曲目。
 */
async function importFile(cfg, srcPath, { title, artist } = {}) {
  const ext = path.extname(srcPath).toLowerCase() || '.mp3';
  let base;
  if (cfg.import.naming === 'artist-title' && title) {
    base = sanitize(`${artist ? `${artist} - ` : ''}${title}`);
  } else {
    base = sanitize(path.basename(srcPath, path.extname(srcPath)));
  }
  if (!base) base = `untitled_${Date.now()}`;

  await ensureDir(cfg.paths.libraryDir);
  let dest = path.join(cfg.paths.libraryDir, `${base}${ext}`);
  let i = 1;
  while (true) {
    try {
      await fsp.access(dest);
      i += 1;
      dest = path.join(cfg.paths.libraryDir, `${base} (${i})${ext}`);
    } catch (_) {
      break;
    }
  }
  await move(srcPath, dest);
  return dest;
}

module.exports = { importFile };
