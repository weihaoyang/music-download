'use strict';

// 验证音频本地缓存 + 静态前端。
const BASE = 'http://127.0.0.1:8790';
async function j(path, opts) {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const admin = { 'Content-Type': 'application/json', 'x-admin-token': 'dev-admin' };

(async () => {
  console.log('health   =', (await j('/api/health')).body);

  let l = await j('/api/library/list?type=' + encodeURIComponent('慢三'));
  if (!l.body.songs || !l.body.songs.length) {
    const imp = await j('/api/library/import', { method: 'POST', headers: admin, body: JSON.stringify({ url: 'https://y.qq.com/n/ryqq/playlist/9756103868', type: '慢三', limit: 8 }) });
    console.log('import   =', imp.body);
    l = await j('/api/library/list?type=' + encodeURIComponent('慢三'));
  }
  console.log('library  =', l.body.type, l.body.songs.length, '首，已缓存', l.body.songs.filter((s) => s.file).length);

  const dl = await j('/api/library/download', { method: 'POST', headers: admin, body: JSON.stringify({ type: '慢三' }) });
  console.log('download =', dl.body);

  let cached = null;
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    l = await j('/api/library/list?type=' + encodeURIComponent('慢三'));
    cached = l.body.songs.find((s) => s.file);
    if (cached) break;
  }
  console.log('cached   =', cached ? { mid: cached.mid, file: cached.file, name: cached.name } : '(超时，未缓存成功)');

  if (cached) {
    const u = await j('/api/song/url?mid=' + cached.mid);
    console.log('song/url =', { local: u.body.data.local, url: u.body.data.url });
    const m = await fetch(BASE + u.body.data.url, { headers: { Range: 'bytes=0-99' } });
    console.log('media    =', { status: m.status, type: m.headers.get('content-type'), range: m.headers.get('content-range') });
  }

  const idx = await fetch(BASE + '/');
  console.log('index    =', { status: idx.status, hasTitle: (await idx.text()).includes('舞曲排曲台') });
  console.log('app.js   =', (await fetch(BASE + '/app.js')).status);
  console.log('styles   =', (await fetch(BASE + '/styles.css')).status);
})();
