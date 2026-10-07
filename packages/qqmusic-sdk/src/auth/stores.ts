import { promises as fs } from 'fs';
import { dirname } from 'path';
import type { Cookie, TokenStore } from '../types';

/** 参考实现：把 cookie 存成一个 JSON 文件 */
export class FileTokenStore implements TokenStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Cookie | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Cookie;
      return parsed && parsed.uin ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(cookie: Cookie): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(cookie, null, 2), 'utf8');
  }

  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}

/** 内存实现，便于测试 */
export class MemoryTokenStore implements TokenStore {
  constructor(private cookie: Cookie | null = null) {}
  async load(): Promise<Cookie | null> {
    return this.cookie;
  }
  async save(cookie: Cookie): Promise<void> {
    this.cookie = cookie;
  }
  async clear(): Promise<void> {
    this.cookie = null;
  }
}
