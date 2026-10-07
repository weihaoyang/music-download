'use strict';

// 验证扫码得到的登录态：status/health/直链/资料/歌单。不打印任何 key。
const fs = require('fs');
const path = require('path');
const { createQQMusicClient } = require('../dist/index.js');

const cookie = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.work', 'qq-user.json'), 'utf8'));

(async () => {
  console.log('scanned cookie keys =', Object.keys(cookie).join(','));

  const qq = await createQQMusicClient({ seedCookie: cookie });
  console.log('status  =', await qq.auth.status());
  console.log('health  =', await qq.auth.health());

  try {
    const u = await qq.songs.url({ songmid: '0039MnYb0qxYhV', quality: '320' });
    console.log('url     =', { quality: u.quality, origin: new URL(u.url).origin, len: u.url.length });
  } catch (e) {
    console.log('url     = ERR', e.code, e.message);
  }
  try {
    const p = await qq.user.profile();
    console.log('profile =', { uin: p.uin, nickname: p.nickname, vip: p.vip });
  } catch (e) {
    console.log('profile = ERR', e.code, e.message);
  }
  try {
    const l = await qq.user.playlists();
    console.log('lists   =', l.length, l.slice(0, 4).map((x) => x.name));
  } catch (e) {
    console.log('lists   = ERR', e.code, e.message);
  }

  qq.auth.stopAutoRefresh();
})();
