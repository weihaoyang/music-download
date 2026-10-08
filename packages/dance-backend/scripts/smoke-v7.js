'use strict';
// v7 冒烟：多来源（来源列表 / 网易云搜索+单曲导入 / QQ 单曲导入 / 本地文件夹 / 直链 / 网盘报错）——均含清理
const fs = require('fs');
const path = require('path');
const os = require('os');
const B = 'http://127.0.0.1:8790';
const H = { 'Content-Type': 'application/json', 'x-admin-token': 'dev-admin' };
let pass = 0;
let fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS', n, x !== undefined ? JSON.stringify(x) : ''); }
  else { fail++; console.log('  FAIL', n, x !== undefined ? JSON.stringify(x) : ''); }
};
const j = async (p, o) => { const r = await fetch(B + p, o); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const del = (mid) => j('/api/library/song?mid=' + encodeURIComponent(mid), { method: 'DELETE', headers: H });
async function findMid(mid, types) {
  for (const ty of types) {
    const l = await j('/api/library/list?type=' + encodeURIComponent(ty.type));
    const s = (l.body.songs || []).find((x) => x.mid === mid);
    if (s) return s;
  }
  return null;
}

(async () => {
  const types = (await j('/api/library/types')).body.data.filter((t) => t.type !== '__liked__');

  console.log('== 1. /api/sources ==');
  const src = await j('/api/sources');
  const ids = (src.body.data || []).map((s) => s.id);
  ok('sources 5 项', ids.length === 5 && ['qqmusic', 'netease', 'local', 'http', 'pan'].every((x) => ids.includes(x)), ids);

  console.log('== 2. 网易云搜索 ==');
  const nes = await j('/api/search/netease?keywords=' + encodeURIComponent('晴天') + '&limit=3');
  ok('netease search', (nes.body.items || []).length > 0, nes.body.items && nes.body.items[0] && nes.body.items[0].name);

  console.log('== 3. 网易云单曲导入 + 清理 ==');
  if (nes.body.items && nes.body.items[0]) {
    const id = nes.body.items[0].id;
    const imp = await j('/api/source/netease/import', { method: 'POST', headers: H, body: JSON.stringify({ type: '未分类', input: 'https://music.163.com/song?id=' + id }) });
    ok('netease import', imp.body.ok === true, { added: imp.body.added });
    const found = await findMid(String(id), types);
    ok('  可检索到(来源=netease)', found && found.source === 'netease', found && { type: found.type, source: found.source });
    if (found && imp.body.added > 0) await del(String(id)); // 仅清理本次新增，避免删掉既有曲目
  }

  console.log('== 4. QQ 单曲导入 + 清理 ==');
  const qq = await j('/api/search?keywords=' + encodeURIComponent('晴天') + '&limit=1');
  const qmid = qq.body.items && qq.body.items[0] && qq.body.items[0].mid;
  if (qmid) {
    const imp = await j('/api/source/qqmusic/import', { method: 'POST', headers: H, body: JSON.stringify({ type: '未分类', songMid: qmid }) });
    ok('qqmusic import', imp.body.ok === true, { added: imp.body.added });
    await del(qmid);
  } else ok('qqmusic import', false, 'no search result');

  console.log('== 5. 本地文件夹导入 + 清理 ==');
  const srcMp3 = fs.readdirSync('data/media').find((f) => f.endsWith('.mp3'));
  const dir = path.join(os.tmpdir(), 'opencode', 'smoke7_local');
  fs.mkdirSync(dir, { recursive: true });
  if (srcMp3) fs.copyFileSync(path.join('data/media', srcMp3), path.join(dir, '慢三-种子测试-测试歌手.mp3'));
  const loc = await j('/api/source/local/import', { method: 'POST', headers: H, body: JSON.stringify({ dir }) });
  ok('local import', loc.body.ok === true && loc.body.added >= 1, { added: loc.body.added, scanned: loc.body.scanned });
  const locList = await j('/api/library/list?type=' + encodeURIComponent('慢三'));
  const locTrack = (locList.body.songs || []).find((x) => x.source === 'local');
  ok('  本地曲目来源=local', !!locTrack, locTrack && locTrack.name);
  if (locTrack) await del(locTrack.mid);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('== 6. 直链导入 + 清理 ==');
  let url = null;
  try { url = await require('../dist/sources/netease').songUrl('2652820720'); } catch { /* ignore */ }
  if (url) {
    const ht = await j('/api/source/http/import', { method: 'POST', headers: H, body: JSON.stringify({ type: '未分类', urls: [url] }) });
    ok('http import', ht.body.ok === true && ht.body.added === 1, { added: ht.body.added });
    const hl = await j('/api/library/list?type=' + encodeURIComponent('未分类'));
    const ht2 = (hl.body.songs || []).find((x) => x.source === 'http');
    ok('  直链曲目来源=http', !!ht2, ht2 && ht2.mid);
    const st = await fetch(B + '/api/song/stream?mid=' + encodeURIComponent(ht2.mid), { redirect: 'manual' });
    ok('  直链播放(302/200)', st.status === 302 || st.status === 200, st.status);
    try { await st.body.cancel(); } catch { /* ignore */ }
    if (ht2) await del(ht2.mid);
  } else ok('http import', false, 'no netease url');

  console.log('== 7. 网盘（无 Cookie 时应报错）==');
  const pan = await j('/api/source/pan/import', { method: 'POST', headers: H, body: JSON.stringify({ type: '未分类', shareUrl: 'https://pan.baidu.com/s/1abcdEFG' }) });
  ok('pan 需 Cookie（或成功）', pan.body.ok === true || pan.body.error === 'PAN_ERROR', { ok: pan.body.ok, error: pan.body.error });

  console.log('\n==== v7 结果：PASS ' + pass + ' / FAIL ' + fail + ' ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
