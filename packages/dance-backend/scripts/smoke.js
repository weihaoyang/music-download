'use strict';

// 数据后端冒烟（Node，避免 shell 中文编码问题）
const BASE = 'http://127.0.0.1:8790';
const call = async (path, opts) => {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const json = (obj) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

(async () => {
  console.log('health   =', (await call('/api/health')).body);

  const s = await call('/api/search?keywords=' + encodeURIComponent('晴天') + '&limit=2');
  console.log('search   =', { total: s.body.total, first: s.body.items && s.body.items[0] && s.body.items[0].name });

  const imp = await call('/api/library/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': 'dev-admin' },
    body: JSON.stringify({ url: 'https://y.qq.com/n/ryqq/playlist/9756103868', type: '慢三', limit: 8 }),
  });
  console.log('import   =', imp.body);

  const l = await call('/api/library/list?type=' + encodeURIComponent('慢三'));
  console.log('library  =', { type: l.body.type, count: l.body.songs && l.body.songs.length, first: l.body.songs && l.body.songs[0] && l.body.songs[0].name });

  const u = await call('/api/song/url?mid=0039MnYb0qxYhV&quality=320');
  console.log('song/url =', { quality: u.body.data && u.body.data.quality, origin: u.body.data && u.body.data.url && u.body.data.url.slice(0, 30) });

  const rr = await call('/api/playlist/resolve', json({ input: 'https://y.qq.com/n/ryqq/playlist/9756103868' }));
  console.log('resolve  =', { disstid: rr.body.disstid });

  const qr = await call('/api/auth/qr/start', json({ type: 'qq' }));
  console.log('qr/start =', { type: qr.body.type, tokenLen: qr.body.token && qr.body.token.length, imgHead: qr.body.image && qr.body.image.slice(0, 22) });
})();
