import { readJson, writeJson } from './store';

export interface PlayEvent {
  mid: string;
  name: string;
  artists: string[];
  type: string;
  coverUrl?: string | null;
  at: number;
}

interface HistoryDoc {
  events: PlayEvent[];
}

/** 最近播放历史（新的在前，最多保留 cap 条） */
export class HistoryStore {
  private events: PlayEvent[] = [];

  constructor(
    private readonly file: string,
    private readonly cap = 500,
  ) {}

  async load(): Promise<void> {
    const doc = await readJson<HistoryDoc | PlayEvent[]>(this.file, { events: [] });
    this.events = Array.isArray(doc) ? doc : doc.events ?? [];
  }

  list(limit = 100): PlayEvent[] {
    return this.events.slice(0, Math.max(0, limit));
  }

  async add(e: PlayEvent): Promise<void> {
    this.events.unshift(e);
    if (this.events.length > this.cap) this.events.length = this.cap;
    await this.save();
  }

  async clear(): Promise<void> {
    this.events = [];
    await this.save();
  }

  private save(): Promise<void> {
    return writeJson(this.file, { events: this.events } as HistoryDoc);
  }
}
