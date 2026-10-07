import { randomUUID } from 'crypto';
import type { Cookie } from '@hdbc/qqmusic-sdk';
import { readJson, writeJson } from './store';

export interface Session {
  sid: string;
  uin: string;
  cookie: Cookie;
  createdAt: number;
  nickname?: string | null;
  vip?: boolean;
}

export class SessionStore {
  private data: Record<string, Session> = {};

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    this.data = await readJson<Record<string, Session>>(this.file, {});
  }

  private save(): Promise<void> {
    return writeJson(this.file, this.data);
  }

  async create(cookie: Cookie, profile?: { nickname?: string | null; vip?: boolean }): Promise<Session> {
    const sid = randomUUID();
    const session: Session = {
      sid,
      uin: cookie.uin,
      cookie,
      createdAt: Date.now(),
      nickname: profile?.nickname ?? null,
      vip: profile?.vip ?? false,
    };
    this.data[sid] = session;
    await this.save();
    return session;
  }

  get(sid: string | undefined): Session | undefined {
    return sid ? this.data[sid] : undefined;
  }

  async remove(sid: string): Promise<void> {
    delete this.data[sid];
    await this.save();
  }

  list(): Session[] {
    return Object.values(this.data);
  }
}
