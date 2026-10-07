'use strict';

// 扫码登录实网冒烟：生成二维码 + 轮询一次（未扫描应为 pending）。不需要扫码。
const { createQQMusicClient } = require('../dist/index.js');

(async () => {
  const qq = await createQQMusicClient();
  for (const type of ['wx', 'qq']) {
    try {
      const s = await qq.auth.login.start(type);
      console.log(`[${type}] start  -> token=${String(s.token).slice(0, 8)}… image=${s.image.slice(0, 22)}… (${s.image.length} chars)`);
      const c = await qq.auth.login.check(type, s.token);
      console.log(`[${type}] check  ->`, c.state, c.message ?? '');
    } catch (e) {
      console.log(`[${type}] ERR`, e.code, '|', e.message);
    }
  }
  qq.auth.stopAutoRefresh();
})();
