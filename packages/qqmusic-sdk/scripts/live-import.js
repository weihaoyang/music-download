'use strict';

// 外部歌单导入联调：resolve 链接 -> importPlaylist -> clone 到临时歌单 -> 校验 -> 清理。
const fs = require('fs');
const path = require('path');
const { createQQMusicClient, FileTokenStore } = require('../dist/index.js');

const root = path.join(__dirname, '..');
const cookie = fs.readFileSync(path.join(root, '.qq-cookie.txt'), 'utf8').trim();
const SRC = 'https://y.qq.com/n/ryqq/playlist/9756103868';
const PREFIX = 'HBDC-Import-Test-';

(async () => {
  const qq = await createQQMusicClient({ seedCookie: cookie, tokenStore: new FileTokenStore(path.join(root, '.qq-cookie.json')) });

  // 清理历史残留
  for (const p of (await qq.user.playlists()).filter((x) => x.name.startsWith(PREFIX))) {
    await qq.playlists.delete({ dirid: p.id }).catch(() => undefined);
  }

  // 1) 解析链接
  const resolved = await qq.playlists.resolve({ input: SRC });
  console.log('resolve      =', resolved);

  // 2) 导入（拉取并归一化）
  const detail = await qq.playlists.importPlaylist({ url: SRC, limit: 10 });
  console.log('import       =', {
    name: detail.name,
    songCount: detail.songCount,
    got: detail.songs.length,
    first: detail.songs[0] && detail.songs[0].name,
    firstMid: detail.songs[0] && detail.songs[0].mid,
  });

  // 3) 克隆到临时歌单（可逆）
  const temp = await qq.playlists.create({ name: PREFIX + Date.now() });
  try {
    const cloned = await qq.playlists.clone({ url: SRC, dirid: temp.id, limit: 5 });
    console.log('clone        =', cloned);
    const found = (await qq.user.playlists()).find((x) => x.id === temp.id);
    console.log('verify       =', found ? { name: found.name, songCount: found.songCount } : 'NOT FOUND');
  } finally {
    for (const p of (await qq.user.playlists()).filter((x) => x.name.startsWith(PREFIX))) {
      await qq.playlists.delete({ dirid: p.id }).catch(() => undefined);
    }
    console.log('remaining    =', (await qq.user.playlists()).filter((x) => x.name.startsWith(PREFIX)).length, 'test playlists');
  }

  qq.auth.stopAutoRefresh();
})();
