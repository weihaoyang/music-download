'use strict';

// QQ 扫码联调：start 生成二维码并落盘；poll 轮询直到 confirmed/expired/timeout。
const fs = require('fs');
const path = require('path');
const { createQQMusicClient } = require('../dist/index.js');

const out = path.join(__dirname, '..', '.work');
fs.mkdirSync(out, { recursive: true });
const tokenFile = path.join(out, 'qq.token');
const statusFile = path.join(out, 'qq.status');
const cookieFile = path.join(out, 'qq-user.json');

(async () => {
  const mode = process.argv[2] || 'start';

  if (mode === 'start') {
    const qq = await createQQMusicClient();
    const s = await qq.auth.login.start('qq');
    fs.writeFileSync(path.join(out, 'qr-qq.png'), Buffer.from(s.image.split(',')[1], 'base64'));
    fs.writeFileSync(tokenFile, s.token);
    fs.writeFileSync(statusFile, '');
    console.log('QR_SAVED', path.join(out, 'qr-qq.png'));
    qq.auth.stopAutoRefresh();
    return;
  }

  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const qq = await createQQMusicClient();
  const deadline = Date.now() + 110000;
  let last = '';
  while (Date.now() < deadline) {
    let r;
    try {
      r = await qq.auth.login.check('qq', token);
    } catch (e) {
      r = { state: 'error', message: e.message };
    }
    const line = r.state + (r.message ? ' | ' + r.message : '');
    if (line !== last) {
      fs.appendFileSync(statusFile, line + '\n');
      console.log('STATE', line);
      last = line;
    }
    if (r.state === 'confirmed') {
      fs.writeFileSync(cookieFile, JSON.stringify(r.cookie, null, 2));
      console.log('CONFIRMED');
      qq.auth.stopAutoRefresh();
      process.exit(0);
    }
    if (r.state === 'expired') {
      console.log('EXPIRED');
      qq.auth.stopAutoRefresh();
      process.exit(0);
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  console.log('TIMEOUT');
  qq.auth.stopAutoRefresh();
  process.exit(0);
})();
