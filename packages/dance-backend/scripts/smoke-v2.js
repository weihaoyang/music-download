'use strict';

// v2 冒烟：前端产物（无 CDN）/ 设置（自定义缓存目录）/ 下载任务进度 / 排曲。
const BASE = 'http://127.0.0.1:8790';
async function j(path, opts) {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const admin = { 'Content-Type': 'application/json', 'x-admin-token': 'dev-admin' };

(async () => {
  const idx = await fetch(BASE + '/');
  const html = await idx.text();
  console.log('index    =', { status: idx.status, noCDN: !html.includes('cdn.jsdelivr'), hasBundledAssets: /assets\/index-.*\.js/.test(html) });
  const m = html.match(/\.\/(assets\/[^"']+\.js)/);
  if (m) {
    const a = await fetch(BASE + '/' + m[1]);
    console.log('asset    =', { path: m[1], status: a.status, type: a.headers.get('content-type') });
  }

  const s1 = await j('/api/settings', { headers: { 'x-admin-token': 'dev-admin' } });
  console.log('settings =', { status: s1.status, mediaDir: s1.body.data && s1.body.data.mediaDir, quality: s1.body.data && s1.body.data.mediaQuality });

  const s2 = await j('/api/settings', { method: 'PUT', headers: admin, body: JSON.stringify({ mediaDir: 'D:/music-cache-test' }) });
  console.log('set dir  =', { status: s2.status, mediaDir: s2.body.data && s2.body.data.mediaDir });
  const s3 = await j('/api/settings', { method: 'PUT', headers: admin, body: JSON.stringify({ mediaDir: 'data/media' }) });
  console.log('revert   =', { mediaDir: s3.body.data && s3.body.data.mediaDir });

  const dl = await j('/api/library/download', { method: 'POST', headers: admin, body: JSON.stringify({ type: '慢三' }) });
  console.log('download =', dl.body);
  if (dl.body.taskId) {
    await new Promise((r) => setTimeout(r, 1500));
    const t = await j('/api/tasks/' + dl.body.taskId);
    console.log('task     =', t.body.data && { status: t.body.data.status, total: t.body.data.total, done: t.body.data.done, failed: t.body.data.failed });
  }

  const g = await j('/api/setlist/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ durationMin: 60, weights: { 慢三: 1 }, mode: 'weighted', fill: true }),
  });
  console.log('setlist  =', { status: g.status, count: g.body.songs && g.body.songs.length, totalMs: g.body.totalMs, first: g.body.songs && g.body.songs[0] && g.body.songs[0].name });

  const sv = await j('/api/setlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '测试排曲', mids: (g.body.songs || []).slice(0, 3).map((x) => x.mid) }),
  });
  console.log('save     =', { status: sv.status, name: sv.body.data && sv.body.data.name, count: sv.body.data && sv.body.data.songs.length });
  const ls = await j('/api/setlists');
  console.log('setlists =', ls.body.data && ls.body.data.length);
})();
