'use strict';

// 用扫码得到的 fresh QQ 登录态试一次续期。不打印 key。
const fs = require('fs');
const path = require('path');
const { createQQMusicClient } = require('../dist/index.js');

const cookie = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.work', 'qq-user.json'), 'utf8'));

(async () => {
  const qq = await createQQMusicClient({ seedCookie: cookie });
  const before = (await qq.auth.status()).keyMasked;
  try {
    const s = await qq.auth.refresh();
    console.log('refresh = OK', { before, after: s.keyMasked, changed: before !== s.keyMasked });
  } catch (e) {
    console.log('refresh = ERR', e.code, '|', e.message);
  }
  qq.auth.stopAutoRefresh();
})();
