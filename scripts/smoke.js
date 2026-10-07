'use strict';

// 冒烟测试：启动 HTTP 服务，检查 /health、首页、/search 路由是否正常。
const { loadConfig } = require('../src/config');
const { JobStore } = require('../src/jobs');
const { createServer } = require('../src/server');

async function main() {
  const cfg = loadConfig();
  const jobs = new JobStore(cfg);
  const server = createServer(cfg, jobs);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const health = await (await fetch(`${base}/health`)).json();
  console.log('HEALTH', JSON.stringify(health));

  const html = await (await fetch(`${base}/`)).text();
  console.log('HTML_OK', html.includes('补歌控制台'));

  try {
    const j = await (await fetch(`${base}/search?limit=2&q=${encodeURIComponent('晴天')}`)).json();
    console.log('SEARCH_RESULT', JSON.stringify(j).slice(0, 400));
  } catch (e) {
    console.log('SEARCH_ERR', e.message);
  }

  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
