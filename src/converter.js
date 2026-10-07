'use strict';

const { spawn } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');
const log = require('./log');
const { ensureDir, findFirst } = require('./util');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`退出码 ${code}${err || out ? `: ${(err || out).trim().slice(0, 500)}` : ''}`));
    });
  });
}

/**
 * 把一个加密文件（.mflac/.mgg）转成 mp3。
 * 为了兼容 TuneFree「按目录批量处理」的接口，先把这个文件单独拷进临时输入目录，
 * 再对临时输出目录执行，最后返回产出的 mp3 路径。
 *
 * mock=true 或未配置 tuneFreeExe 时，直接拷成 mp3，便于无 QQ 音乐环境时自测整条流水线。
 */
async function convert(cfg, inputPath, { jobId } = {}) {
  const key = jobId || path.basename(inputPath).replace(/\W+/g, '_');
  const inDir = path.join(cfg.paths.workDir, 'convert-in', key);
  const outDir = path.join(cfg.paths.workDir, 'convert-out', key);

  await fsp.rm(inDir, { recursive: true, force: true });
  await fsp.rm(outDir, { recursive: true, force: true });
  await ensureDir(inDir);
  await ensureDir(outDir);

  const staged = path.join(inDir, path.basename(inputPath));
  await fsp.copyFile(inputPath, staged);

  const useMock = cfg.converter.mock || !cfg.paths.tuneFreeExe;
  if (useMock) {
    if (!cfg.converter.mock) log.warn('未配置 paths.tuneFreeExe，降级为 mock 转换');
    const mockDir = path.join(outDir, 'mp3');
    await ensureDir(mockDir);
    const out = path.join(mockDir, path.basename(staged).replace(/\.[^.]+$/, '.mp3'));
    await fsp.copyFile(staged, out);
    return out;
  }

  const args = ['-i', inDir, '-o', outDir, '-b', cfg.converter.bitrate, ...(cfg.converter.extraArgs || [])];
  log.info(`TuneFree: "${cfg.paths.tuneFreeExe}" ${args.map((a) => `"${a}"`).join(' ')}`);
  await run(cfg.paths.tuneFreeExe, args);

  const found = await findFirst(outDir, ['.mp3']);
  if (!found) throw new Error('TuneFree 执行完成但未找到 MP3 输出（检查客户端是否运行/加密格式是否变化）');
  return found;
}

module.exports = { convert };
