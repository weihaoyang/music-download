'use strict';
const BASE = 'http://127.0.0.1:8790';
async function j(path, opts) {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
(async () => {
  const t = await j('/api/library/types');
  console.log('types =', t.body.data);
  const withSongs = (t.body.data || []).find((x) => x.count > 0);
  const l = await j('/api/library/list?type=' + encodeURIComponent(withSongs.type));
  const songs = l.body.songs || [];
  console.log('sample =', songs.slice(0, 3).map((s) => `${s.type} ${s.bpm}BPM ${s.name.slice(0, 12)}`));
  const saved = await j('/api/setlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '裁剪测试', songs: [{ mid: songs[0].mid, playMs: 60000 }, { mid: songs[1].mid, playMs: null }] }),
  });
  console.log('setlist =', { status: saved.status, name: saved.body.data && saved.body.data.name, totalMs: saved.body.data && saved.body.data.totalMs, playMs0: saved.body.data && saved.body.data.songs[0].playMs, dur0: songs[0].durationMs });
  const ls = await j('/api/setlists');
  console.log('setlists=', ls.body.data && ls.body.data.length);
})();
