'use strict';

// v5 冒烟：自动舞种分类 + 排曲裁剪保存 + /play。
const BASE = 'http://127.0.0.1:8790';
async function j(path, opts) {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const admin = { 'Content-Type': 'application/json', 'x-admin-token': 'dev-admin' };

(async () => {
  const cl = await j('/api/library/classify', { method: 'POST', headers: admin, body: JSON.stringify({ type: '慢三' }) });
  console.log('classify start =', cl.body);
  if (cl.body.taskId) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const t = await j('/api/tasks/' + cl.body.taskId);
      if (t.body.data && t.body.data.status === 'done') {
        console.log('classify done  =', { done: t.body.data.done, failed: t.body.data.failed });
        const sample = Object.entries(t.body.data.results || {}).slice(0, 3);
        for (const [mid, r] of sample) if (r) console.log('   ', mid.slice(0, 8), JSON.stringify(r));
        break;
      }
    }
  }

  const l = await j('/api/library/list?type=' + encodeURIComponent('慢三'));
  const songs = l.body.songs || [];
  console.log('library sample =', songs.slice(0, 3).map((s) => ({ name: s.name.slice(0, 10), type: s.type, bpm: s.bpm })));

  if (songs.length >= 2) {
    const saved = await j('/api/setlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '裁剪测试', songs: [{ mid: songs[0].mid, playMs: 60000 }, { mid: songs[1].mid, playMs: null }] }),
    });
    console.log('setlist save   =', { status: saved.status, name: saved.body.data && saved.body.data.name, totalMs: saved.body.data && saved.body.data.totalMs, playMs0: saved.body.data && saved.body.data.songs[0] && saved.body.data.songs[0].playMs });
  }

  const play = await fetch(BASE + '/play');
  console.log('/play          =', play.status);
})();
