import { useEffect, useState } from 'react';
import { Button, Input, Toast } from '@douyinfe/semi-ui';
import { api, post } from './api';

interface Req {
  id: string;
  name: string;
  artists: string[];
  note?: string | null;
  requester?: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'played';
}
interface Stats {
  active: number;
  totalLimit: number;
  perRequesterLimit: number;
}

/** 公开点歌页（手机扫码打开） */
export default function RequestApp() {
  const [name, setName] = useState('');
  const [artists, setArtists] = useState('');
  const [note, setNote] = useState('');
  const [requester, setRequester] = useState(() => {
    try {
      return localStorage.getItem('dance.requester') || '';
    } catch {
      return '';
    }
  });
  const [items, setItems] = useState<Req[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api<{ data: Req[]; stats: Stats }>('/api/requests')
      .then((r) => {
        setItems(r.data || []);
        setStats(r.stats);
      })
      .catch(() => {});
  }
  useEffect(() => {
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);

  function submit() {
    if (!name.trim()) return Toast.warning('请填写歌名');
    setBusy(true);
    try {
      localStorage.setItem('dance.requester', requester);
    } catch {
      /* ignore */
    }
    post('/api/requests', {
      name: name.trim(),
      artists: artists.split(/[/、,，]/).map((s) => s.trim()).filter(Boolean),
      note: note.trim(),
      requester: requester.trim(),
    })
      .then(() => {
        Toast.success('已点歌 ✓');
        setName('');
        setArtists('');
        setNote('');
        load();
      })
      .catch((e) => Toast.error(e.message))
      .finally(() => setBusy(false));
  }

  return (
    <div className="request-page">
      <div className="request-head">舞会点歌</div>
      {stats ? (
        <div className="hint">
          本场已点 {stats.active}/{stats.totalLimit} · 每人 ≤{stats.perRequesterLimit} 首
        </div>
      ) : null}
      <div className="request-form">
        <span>歌名</span>
        <Input value={name} onChange={setName} placeholder="想点的歌名" />
        <span>歌手（可选）</span>
        <Input value={artists} onChange={setArtists} placeholder="歌手" />
        <span>备注（可选）</span>
        <Input value={note} onChange={setNote} placeholder="如：想跳平四" />
        <span>你的称呼（可选，用于每人限额）</span>
        <Input value={requester} onChange={setRequester} placeholder="如：小王" />
        <Button theme="solid" type="primary" loading={busy} onClick={submit} style={{ width: '100%' }}>
          点这一首
        </Button>
      </div>
      <div className="request-list-title">当前点歌</div>
      <ol className="request-list">
        {items.filter((x) => x.status !== 'rejected').map((x) => (
          <li key={x.id}>
            <span className="r-name">{x.name}</span>
            <span className="r-sub">
              {(x.artists || []).join('/')}
              {x.requester ? ' · ' + x.requester : ''}
              {x.status === 'accepted' ? ' · 已采纳' : x.status === 'played' ? ' · 已播放' : ''}
            </span>
          </li>
        ))}
        {!items.filter((x) => x.status !== 'rejected').length ? <li className="n-empty">还没有人点歌</li> : null}
      </ol>
      <a className="request-back" href="/">
        ← 返回控制台
      </a>
    </div>
  );
}
