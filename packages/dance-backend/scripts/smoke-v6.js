'use strict';

// v6 全量冒烟：曲库/搜索/播放/我喜欢合集/设置/缓存用量/排曲导出导入/校准/缓存并分类/前端路由
const BASE = 'http://127.0.0.1:8790';
const admin = { 'Content-Type': 'application/json', 'x-admin-token': 'dev-admin' };
let pass = 0;
let fail = 0;

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS', name, extra !== undefined ? JSON.stringify(extra) : '');
  } else {
    fail++;
    console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : '');
  }
}
async function j(path, opts) {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitTask(id, maxSec = 90) {
  for (let i = 0; i < maxSec; i += 2) {
    const t = await j('/api/tasks/' + id);
    if (t.body.data && t.body.data.status === 'done') return t.body.data;
    await sleep(2000);
  }
  return null;
}

(async () => {
  console.log('== 1. 基础 ==');
  const health = await j('/api/health');
  ok('health', health.body.ok === true, health.body.version);

  console.log('== 2. 曲库类型 / 列表 / 我喜欢合集 ==');
  const types = await j('/api/library/types');
  const list = types.body.data || [];
  ok('types 有 __liked__', list.some((t) => t.type === '__liked__'), list.map((t) => t.type + ':' + t.count));
  const liked = await j('/api/library/list?liked=1');
  ok('liked 列表', (liked.body.songs || []).length > 0, (liked.body.songs || []).length);
  const firstType = (list.find((t) => t.type !== '__liked__' && t.count > 0) || {}).type;
  const byType = await j('/api/library/list?type=' + encodeURIComponent(firstType || ''));
  ok('list?type=' + firstType, (byType.body.songs || []).length > 0, (byType.body.songs || []).length);

  const someSong = (byType.body.songs || []).find((s) => s.file) || (byType.body.songs || [])[0];
  const uncached = (liked.body.songs || []).find((s) => !s.file);

  console.log('== 3. 搜索 / 详情 ==');
  const search = await j('/api/search?keywords=' + encodeURIComponent('晴天') + '&limit=3');
  ok('search', (search.body.items || []).length > 0, (search.body.items || []).length);
  const detail = await j('/api/song/detail?mid=' + encodeURIComponent(someSong.mid));
  ok('song/detail', detail.body.ok === true, detail.body.data && detail.body.data.name);

  console.log('== 4. 播放直链（本地命中 / QQ 直链）==');
  const urlLocal = await j('/api/song/url?mid=' + encodeURIComponent(someSong.mid));
  ok('song/url 本地命中', urlLocal.body.data && urlLocal.body.data.local === true, urlLocal.body.data && urlLocal.body.data.url);
  if (uncached) {
    const urlRemote = await j('/api/song/url?mid=' + encodeURIComponent(uncached.mid));
    ok('song/url QQ直链', urlRemote.body.data && !!urlRemote.body.data.url, (urlRemote.body.data && urlRemote.body.data.url || '').slice(0, 40));
  }
  const stream = await fetch(BASE + '/api/song/stream?mid=' + encodeURIComponent(someSong.mid), { redirect: 'manual' });
  ok('song/stream（302/200）', stream.status === 302 || stream.status === 200, stream.status);
  try { await stream.body.cancel(); } catch { /* ignore */ }
  const lyric = await fetch(BASE + '/api/song/lyric?mid=' + encodeURIComponent(someSong.mid));
  ok('song/lyric', lyric.status === 200, lyric.headers.get('content-type'));

  console.log('== 5. 设置 / 缓存用量 ==');
  const settings = await j('/api/settings', { headers: admin });
  ok('settings GET', settings.body.data && settings.body.data.mediaQuality, { q: settings.body.data && settings.body.data.mediaQuality, limit: settings.body.data && settings.body.data.cacheLimitBytes, auto: settings.body.data && settings.body.data.autoClassify });
  const usage = await j('/api/media/usage', { headers: admin });
  ok('media/usage', usage.body.data && typeof usage.body.data.bytes === 'number', { mb: Math.round((usage.body.data.bytes || 0) / 1048576), files: usage.body.data && usage.body.data.files });
  const scan = await j('/api/library/scan', { method: 'POST', headers: admin, body: '{}' });
  ok('library/scan', scan.body.ok === true, { linked: scan.body.linked, cleared: scan.body.cleared });

  console.log('== 6. 歌曲编辑 / 移除（可逆）==');
  if (uncached) {
    const put = await j('/api/library/song', { method: 'PUT', headers: admin, body: JSON.stringify({ mid: uncached.mid, suitable: true, warning: null }) });
    ok('song PUT', put.body.ok === true, put.body.data && put.body.data.suitable);
  }

  console.log('== 7. 排曲 生成/保存/导出/导入/删除 ==');
  const gen = await j('/api/setlist/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ durationMin: 30, weights: { [firstType]: 1 } }),
  });
  ok('setlist/generate', Array.isArray(gen.body.songs) && gen.body.songs.length > 0, gen.body.songs && gen.body.songs.length);
  const songsForList = (gen.body.songs || []).slice(0, 3).map((s) => ({ mid: s.mid, playMs: s.playMs ?? null }));
  const saved = await j('/api/setlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'smoke-v6', songs: songsForList, event: { name: '测试舞会', time: '周五' } }) });
  ok('setlist save', saved.body.ok === true, saved.body.data && { id: saved.body.data.id, totalMs: saved.body.data.totalMs });
  const sid = saved.body.data && saved.body.data.id;
  if (sid) {
    const exp = await fetch(BASE + '/api/setlist/' + sid + '/export');
    const expJson = await exp.json().catch(() => ({}));
    ok('setlist export', exp.status === 200 && expJson.format === 'hdbc-setlist', { format: expJson.format, songs: expJson.songs && expJson.songs.length });
    const imp = await j('/api/setlist/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expJson) });
    ok('setlist import', imp.body.ok === true && imp.body.data, imp.body.data && imp.body.data.name);
    const del = await j('/api/setlist/' + sid, { method: 'DELETE' });
    ok('setlist delete', del.status === 200);
    if (imp.body.data && imp.body.data.id) await j('/api/setlist/' + imp.body.data.id, { method: 'DELETE' });
  }

  console.log('== 8. 歌单解析 ==');
  const resolve = await j('/api/playlist/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'https://y.qq.com/n/ryqq/playlist/9756103868' }) });
  ok('playlist/resolve', resolve.body.ok === true, resolve.body.disstid);

  console.log('== 9. 按文件名校准（dryRun，不改动）==');
  const calib = await j('/api/library/calibrate', { method: 'POST', headers: admin, body: JSON.stringify({ entries: [{ type: '吉特巴', name: '不存在的测试歌', artists: ['X'] }], dryRun: true }) });
  ok('calibrate dryRun', calib.body.ok === true, calib.body.data && { scanned: calib.body.data.scanned, unmatched: (calib.body.data.unmatched || []).length });

  console.log('== 10. 批量「缓存并分类」（limit=2，实网）==');
  const cc = await j('/api/library/cache-classify', { method: 'POST', headers: admin, body: JSON.stringify({ type: '未分类', limit: 2 }) });
  ok('cache-classify 启动', cc.body.ok === true && cc.body.queued >= 0, { queued: cc.body.queued, taskId: cc.body.taskId });
  if (cc.body.taskId && cc.body.queued > 0) {
    const done = await waitTask(cc.body.taskId, 120);
    ok('cache-classify 完成', !!done && done.done > 0, done && { done: done.done, failed: done.failed });
    if (done && done.results) {
      const r = Object.values(done.results)[0];
      ok('  识别结果字段', !!r && typeof r.bpm === 'number' && !!r.type, r);
    }
  }

  console.log('== 11. 前端路由 ==');
  for (const p of ['/', '/play', '/wall']) {
    const r = await fetch(BASE + p);
    ok('GET ' + p, r.status === 200, r.headers.get('content-type'));
    try { await r.body.cancel(); } catch { /* ignore */ }
  }

  console.log('\n==== 结果：PASS ' + pass + ' / FAIL ' + fail + ' ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('SMOKE FATAL', e);
  process.exit(2);
});
