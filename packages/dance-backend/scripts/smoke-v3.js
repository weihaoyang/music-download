'use strict';

// v3 冒烟：元数据编辑（改舞种）+ 音频重定向（播放器用）。
const BASE = 'http://127.0.0.1:8790';
async function j(path, opts) {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const admin = { 'Content-Type': 'application/json', 'x-admin-token': 'dev-admin' };

(async () => {
  const l = await j('/api/library/list?type=' + encodeURIComponent('慢三'));
  const song = (l.body.songs || [])[0];
  if (!song) return console.log('曲库为空，先导入');
  console.log('before   =', { mid: song.mid, type: song.type, name: song.name });

  const up = await j('/api/library/song', { method: 'PUT', headers: admin, body: JSON.stringify({ mid: song.mid, type: '慢四', name: song.name }) });
  console.log('update   =', { status: up.status, type: up.body.data && up.body.data.type });

  const l4 = await j('/api/library/list?type=' + encodeURIComponent('慢四'));
  const l3 = await j('/api/library/list?type=' + encodeURIComponent('慢三'));
  console.log('moved    =', { in四: (l4.body.songs || []).some((s) => s.mid === song.mid), in三: (l3.body.songs || []).some((s) => s.mid === song.mid) });

  await j('/api/library/song', { method: 'PUT', headers: admin, body: JSON.stringify({ mid: song.mid, type: '慢三' }) });
  console.log('reverted =', true);

  const st = await fetch(BASE + '/api/song/stream?mid=' + song.mid, { redirect: 'manual' });
  console.log('stream   =', { status: st.status, location: st.headers.get('location') });
})();
