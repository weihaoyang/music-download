'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/** 去掉文件名里的非法字符 */
function sanitize(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

/** 跨盘符安全的移动：先 rename，失败则 copy + unlink */
async function move(src, dest) {
  await ensureDir(path.dirname(dest));
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.copyFile(src, dest);
    await fsp.unlink(src);
  }
  return dest;
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

/** 递归列出目录下匹配扩展名的文件（绝对路径） */
async function listFiles(dir, extensions) {
  const exts = new Set((extensions || []).map((e) => e.toLowerCase()));
  const result = [];
  async function walk(current) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        if (entry.name.startsWith('.') || entry.name.endsWith('.tmp') || entry.name.endsWith('.part')) continue;
        if (exts.has(path.extname(entry.name).toLowerCase())) result.push(full);
      }
    }
  }
  await walk(dir);
  return result;
}

/** 递归找第一个匹配扩展名的文件 */
async function findFirst(dir, extensions) {
  const found = await listFiles(dir, extensions);
  return found[0] || null;
}

/** 从下载链接猜扩展名（去掉 query） */
function guessExt(url, fallback = '.mp3') {
  try {
    const clean = String(url).split('?')[0].split('#')[0];
    const ext = path.extname(clean).toLowerCase();
    if (['.mp3', '.flac', '.ape', '.m4a', '.ogg', '.wav'].includes(ext)) return ext;
  } catch (_) {
    /* ignore */
  }
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { sanitize, ensureDir, move, listFiles, findFirst, guessExt, sleep };
