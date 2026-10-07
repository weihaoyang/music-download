'use strict';

// 验证「客户端镜像」链路：SDK 通过 HttpCookieProvider 从本地 bridge 取 cookie 并使用。
const { createQQMusicClient, HttpCookieProvider } = require('../dist/index.js');

(async () => {
  const qq = await createQQMusicClient({
    cookieProvider: new HttpCookieProvider('http://127.0.0.1:8899/cookie'),
  });
  const health = await qq.auth.health();
  console.log('health  =', health);
  console.log('status  =', await qq.auth.status());

  try {
    const u = await qq.songs.url({ songmid: '0039MnYb0qxYhV', quality: '320' });
    console.log('url     =', { quality: u.quality, origin: new URL(u.url).origin, len: u.url.length });
  } catch (e) {
    console.log('url     = ERR', e.code, '|', e.message);
  }
  try {
    const p = await qq.user.profile();
    console.log('profile =', { uin: p.uin, nickname: p.nickname, vip: p.vip });
  } catch (e) {
    console.log('profile = ERR', e.code, '|', e.message);
  }
  qq.auth.stopAutoRefresh();
})();
