'use strict';

// 多租户验证：多个每用户实例并发，互不干扰；一个坏 cookie 不影响别人。
const fs = require('fs');
const path = require('path');
const { createQQMusicClient } = require('../dist/index.js');

const good = fs.readFileSync(path.join(__dirname, '..', '.qq-cookie.txt'), 'utf8').trim();

(async () => {
  const clients = await Promise.all([0, 1, 2, 3, 4].map(() => createQQMusicClient({ seedCookie: good })));
  const bad = await createQQMusicClient({ seedCookie: 'uin=1; qqmusic_key=bogus; qm_keyst=bogus' });

  const jobs = clients.map(async (qq, i) => {
    const [u, p] = await Promise.all([qq.songs.url({ songmid: '0039MnYb0qxYhV', quality: '320' }), qq.user.profile()]);
    qq.auth.stopAutoRefresh();
    return { i, ok: true, uin: p.uin, origin: new URL(u.url).origin };
  });

  const badJob = (async () => {
    try {
      await bad.songs.url({ songmid: '0039MnYb0qxYhV', quality: '320' });
      return { i: 'bad', ok: 'UNEXPECTED_OK' };
    } catch (e) {
      return { i: 'bad', ok: false, code: e.code };
    } finally {
      bad.auth.stopAutoRefresh();
    }
  })();

  const results = await Promise.all([...jobs, badJob]);
  console.log(JSON.stringify(results, null, 2));
  const good5 = results.slice(0, 5).every((r) => r.ok === true);
  const badIsolated = results[5].ok === false || results[5].ok === 'UNEXPECTED_OK';
  console.log('\n5 个有效实例全部成功 =', good5);
  console.log('坏 cookie 独立失败        =', badIsolated, '| code =', results[5].code ?? results[5].ok);
})();
