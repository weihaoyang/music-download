'use strict';

// 写操作可逆验证：create -> addSongs -> 校验 -> delete。finally 兜底清理。
const fs = require('fs');
const path = require('path');
const { createQQMusicClient, FileTokenStore } = require('../dist/index.js');

const root = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(root, '.qq-cookie.txt'), 'utf8').trim();
const PREFIX = 'HBDC-SDK-Test-';

(async () => {
  const qq = await createQQMusicClient({
    seedCookie: raw,
    tokenStore: new FileTokenStore(path.join(root, '.qq-cookie.json')),
  });

  // 先清理任何历史残留
  for (const p of (await qq.user.playlists()).filter((x) => x.name.startsWith(PREFIX))) {
    await qq.playlists.delete({ dirid: p.id }).catch(() => undefined);
  }

  const name = PREFIX + Date.now();
  let dirid = null;
  try {
    const pl = await qq.playlists.create({ name });
    dirid = pl.id;
    console.log('create       =', { dirid: pl.id, name: pl.name });

    const r = await qq.playlists.addSongs({ dirid, songmids: ['0039MnYb0qxYhV'] });
    console.log('addSongs     =', r);

    const found = (await qq.user.playlists()).find((x) => x.id === dirid);
    console.log('verify       =', found ? { name: found.name, songCount: found.songCount } : 'NOT FOUND');
  } catch (e) {
    console.log('write ERR    =', e.code, '|', e.message, dirid ? `(dirid=${dirid})` : '');
  } finally {
    // 清理所有测试歌单
    for (const p of (await qq.user.playlists()).filter((x) => x.name.startsWith(PREFIX))) {
      try {
        await qq.playlists.delete({ dirid: p.id });
        console.log('delete       = ok', p.id);
      } catch (e) {
        console.log('delete ERR   =', e.code, e.message, `(请手动删除 dirid=${p.id})`);
      }
    }
    const rest = (await qq.user.playlists()).filter((x) => x.name.startsWith(PREFIX));
    console.log('remaining    =', rest.length, 'test playlists');
  }

  qq.auth.stopAutoRefresh();
})();
