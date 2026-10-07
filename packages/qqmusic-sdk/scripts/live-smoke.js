'use strict';

// 实网冒烟：验证 SDN 的匿名路径与鉴权边界（无需 cookie）。
const { createQQMusicClient } = require('../dist/index.js');

(async () => {
  const qq = await createQQMusicClient();
  console.log('auth status =', await qq.auth.status());

  // M1：歌曲搜索 + 详情
  const page = await qq.search.songs({ keyword: '晴天', limit: 3 });
  console.log('\n[songs] page =', { total: page.total, count: page.items.length });
  page.items.forEach((s) => console.log(`  - ${s.name} / ${s.artists.join('/')} [${s.mid}]`));
  const detail = await qq.songs.detail({ songmid: page.items[0].mid });
  console.log('[detail]', { mediaMid: detail.mediaMid, qualities: detail.qualities });

  // M3：歌单搜索（匿名）
  const plPage = await qq.search.playlists({ keyword: '舞曲', limit: 3 });
  console.log('\n[playlists] total =', plPage.total);
  plPage.items.forEach((p) => console.log(`  - ${p.name} @${p.creator ?? '?'} [${p.id}] songs=${p.songCount}`));

  // M3：快速联想（匿名）
  const quick = await qq.search.quick({ keyword: '晴天' });
  console.log('\n[quick] songs =', quick.songs.length, '| albums =', quick.albums.length, '| mvs =', quick.mvs.length);
  console.log('  first song =', quick.songs[0]);

  // M3：歌单详情（匿名应被拒 → QQ_AUTH_REQUIRED）
  try {
    await qq.playlists.detail({ disstid: plPage.items[0].id });
    console.log('\n[playlist detail] UNEXPECTED OK');
  } catch (e) {
    console.log('\n[playlist detail] expected error =', e.code, '|', e.message);
  }

  // 鉴权边界：无 cookie 取直链
  try {
    await qq.songs.url({ songmid: page.items[0].mid });
    console.log('[songs.url] UNEXPECTED OK');
  } catch (e) {
    console.log('[songs.url] expected error =', e.code);
  }

  qq.auth.stopAutoRefresh();
})();
