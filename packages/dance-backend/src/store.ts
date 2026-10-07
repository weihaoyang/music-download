import fs from 'fs/promises';
import path from 'path';

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** 同一文件的写入串行化，避免并发 rename 竞争导致 ENOENT / 崩溃 */
const chains = new Map<string, Promise<void>>();

export function writeJson(file: string, data: unknown): Promise<void> {
  const prev = chains.get(file) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmp, file);
    });
  chains.set(file, next);
  return next;
}
