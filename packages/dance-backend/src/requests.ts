import { randomUUID } from 'crypto';
import { readJson, writeJson } from './store';

/** 点歌申请 */
export interface SongRequest {
  id: string;
  name: string;
  artists: string[];
  /** 若从搜索里选，带来源与 mid，方便直接入库 */
  mid?: string | null;
  source?: string | null;
  type?: string | null;
  note?: string | null;
  /** 点歌人称呼（用于「每人每次 1 首」限额） */
  requester?: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'played';
  createdAt: number;
}

export interface RequestLimits {
  /** 每场舞会总点歌上限 */
  total: number;
  /** 每人每次上限 */
  perRequester: number;
}

/** 点歌队列（内存 + data/requests.json） */
export class RequestStore {
  private data: SongRequest[] = [];

  constructor(
    private readonly file: string,
    private readonly limits: RequestLimits = { total: 4, perRequester: 1 },
  ) {}

  async load(): Promise<void> {
    this.data = await readJson<SongRequest[]>(this.file, []);
  }

  private save(): Promise<void> {
    return writeJson(this.file, this.data);
  }

  list(): SongRequest[] {
    return this.data.slice().sort((a, b) => a.createdAt - b.createdAt);
  }

  stats(): { total: number; pending: number; accepted: number; played: number; rejected: number; active: number; totalLimit: number; perRequesterLimit: number } {
    const by = (s: SongRequest['status']): number => this.data.filter((r) => r.status === s).length;
    const pending = by('pending');
    const accepted = by('accepted');
    return { total: this.data.length, pending, accepted, played: by('played'), rejected: by('rejected'), active: pending + accepted, totalLimit: this.limits.total, perRequesterLimit: this.limits.perRequester };
  }

  /** 是否还能点（每场总数 / 每人） */
  canAdd(requester?: string | null): { ok: boolean; reason?: string } {
    const active = this.data.filter((r) => r.status === 'pending' || r.status === 'accepted');
    if (active.length >= this.limits.total) return { ok: false, reason: `本次舞会点歌已满（上限 ${this.limits.total} 首）` };
    const who = (requester || '').trim();
    if (who) {
      const mine = active.filter((r) => (r.requester || '').trim() === who);
      if (mine.length >= this.limits.perRequester) return { ok: false, reason: `你本次已点过 ${this.limits.perRequester} 首` };
    }
    return { ok: true };
  }

  async add(input: Omit<SongRequest, 'id' | 'status' | 'createdAt'>): Promise<SongRequest> {
    const row: SongRequest = { id: randomUUID(), status: 'pending', createdAt: Date.now(), ...input };
    this.data.push(row);
    await this.save();
    return row;
  }

  async update(id: string, patch: Partial<Pick<SongRequest, 'status' | 'note' | 'type'>>): Promise<SongRequest | null> {
    const r = this.data.find((x) => x.id === id);
    if (!r) return null;
    if (patch.status) r.status = patch.status;
    if (patch.note !== undefined) r.note = patch.note;
    if (patch.type !== undefined) r.type = patch.type;
    await this.save();
    return r;
  }

  async remove(id: string): Promise<boolean> {
    const n = this.data.length;
    this.data = this.data.filter((x) => x.id !== id);
    if (this.data.length !== n) {
      await this.save();
      return true;
    }
    return false;
  }

  /** 清空（开始新一场舞会） */
  async reset(): Promise<number> {
    const n = this.data.length;
    this.data = [];
    await this.save();
    return n;
  }
}
