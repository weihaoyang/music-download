'use strict';

const http = require('http');
const log = require('./log');
const qq = require('./qqmusic');
const { fetchSong } = require('./fetcher');

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (_) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createServer(cfg, jobs) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (cfg.server.token) {
        const token = req.headers['x-token'] || url.searchParams.get('token');
        if (token !== cfg.server.token) return sendJson(res, 401, { error: 'unauthorized' });
      }

      const p = url.pathname;

      if (p === '/health') {
        return sendJson(res, 200, {
          ok: true,
          musicApiBase: qq.baseInfo(cfg),
          engine: cfg.engine.default,
          mock: cfg.converter.mock,
        });
      }

      if (p === '/search' && req.method === 'GET') {
        const q = url.searchParams.get('q') || url.searchParams.get('keyword') || '';
        const limit = Number(url.searchParams.get('limit') || 10);
        const data = await qq.search(q, { limit });
        return sendJson(res, 200, { result: 100, data });
      }

      if (p === '/fetch' && req.method === 'POST') {
        const body = await readBody(req);
        const job = await fetchSong(cfg, jobs, body);
        return sendJson(res, 200, { result: 100, data: job });
      }

      if (p === '/jobs' && req.method === 'GET') {
        return sendJson(res, 200, { result: 100, data: jobs.list(Number(url.searchParams.get('limit') || 50)) });
      }

      const m = p.match(/^\/jobs\/([^/]+)$/);
      if (m && req.method === 'GET') {
        const job = jobs.get(m[1]);
        if (!job) return sendJson(res, 404, { error: 'job not found' });
        return sendJson(res, 200, { result: 100, data: job });
      }

      if (p === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(INDEX_HTML);
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      log.error('请求处理失败：', e.message);
      return sendJson(res, 500, { error: e.message });
    }
  });
}

const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>补歌控制台</title>
<style>
  body { font-family: system-ui, "Microsoft YaHei", sans-serif; margin: 24px; color: #222; }
  h1 { font-size: 20px; }
  input, button { padding: 6px 10px; font-size: 14px; }
  #results div.row { padding: 8px; border-bottom: 1px solid #eee; display: flex; gap: 10px; align-items: center; }
  #results .meta { flex: 1; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 13px; }
  td, th { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
  .ok { color: #1a7f37; } .bad { color: #b42318; } .run { color: #9a6700; }
</style>
</head>
<body>
  <h1>补歌控制台</h1>
  <div>
    <input id="token" placeholder="token（可空）" size="18">
    <input id="q" placeholder="歌名 / 歌手，回车搜索" size="30">
    <button onclick="doSearch()">搜索 QQ 音乐</button>
  </div>
  <div id="results"></div>
  <h2 style="font-size:16px">任务 <button onclick="loadJobs()">刷新</button></h2>
  <table id="jobs"><thead><tr><th>状态</th><th>歌名</th><th>歌手</th><th>引擎</th><th>结果</th></tr></thead><tbody></tbody></table>
<script>
const $ = (id) => document.getElementById(id);
const tk = () => encodeURIComponent($('token').value || '');
async function doSearch() {
  const q = $('q').value.trim(); if (!q) return;
  $('results').textContent = '搜索中...';
  const r = await fetch('/search?limit=10&q=' + encodeURIComponent(q) + '&token=' + tk());
  const j = await r.json();
  if (!j.data) { $('results').textContent = JSON.stringify(j); return; }
  $('results').innerHTML = j.data.map((s, i) => \`<div class="row">
    <div class="meta"><b>\${s.title}</b> — \${s.artist} <small>[\${s.album}] \${s.pay ? '付费' : ''}</small></div>
    <button onclick="doFetch('\${s.mid}','\${(s.mediaId||'').replace(/'/g,'')}','\${s.title.replace(/'/g,'')}','\${s.artist.replace(/'/g,'')}')">补这首歌</button>
  </div>\`).join('');
}
async function doFetch(mid, mediaId, title, artist) {
  const r = await fetch('/fetch?token=' + tk(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mid, mediaId, title, artist })
  });
  const j = await r.json();
  alert(j.data ? '已创建任务：' + j.data.id : JSON.stringify(j));
  loadJobs();
}
async function loadJobs() {
  const r = await fetch('/jobs?limit=30&token=' + tk());
  const j = await r.json();
  const cls = (s) => (s === 'imported' ? 'ok' : s === 'failed' ? 'bad' : 'run');
  $('jobs').querySelector('tbody').innerHTML = (j.data || []).map((x) => \`<tr>
    <td class="\${cls(x.status)}">\${x.status}</td><td>\${x.title || ''}</td><td>\${x.artist || ''}</td>
    <td>\${x.engine || ''}</td><td>\${x.path || x.error || ''}</td></tr>\`).join('');
}
loadJobs(); setInterval(loadJobs, 5000);
</script>
</body>
</html>`;

module.exports = { createServer };
