'use strict';

// 登录链路实网验证：续期 / 直链 / 资料 / 歌单 / 歌单详情。
// cookie 从不回显，直链只打印 host + 长度。
const fs = require('fs');
const path = require('path');
const { createQQMusicClient, FileTokenStore } = require('../dist/index.js');

const root = path.join(__dirname, '..');
const cookie = fs.readFileSync(path.join(root, '.qq-cookie.txt'), 'utf8').trim();

(async () => {
  const qq = await createQQMusicClient({
    seedCookie: cookie,
    tokenStore: new FileTokenStore(path.join(root, '.qq-cookie.json')),
  });

  const st = await qq.auth.status();
  console.log('auth.status  =', { state: st.state, uin: st.uin, keyMasked: st.keyMasked });

  console.log('auth.health  =', await qq.auth.health());

  try {
    const u = await qq.songs.url({ songmid: '0039MnYb0qxYhV', quality: '320' });
    console.log('songs.url    =', { quality: u.quality, origin: new URL(u.url).origin, len: u.url.length });
  } catch (e) {
    console.log('songs.url    = ERR', e.code, '|', e.message);
  }

  try {
    const p = await qq.user.profile();
    console.log('user.profile =', { uin: p.uin, nickname: p.nickname, vip: p.vip });
  } catch (e) {
    console.log('user.profile = ERR', e.code, '|', e.message);
  }

  try {
    const list = await qq.user.playlists();
    console.log('user.plists  =', list.length, list.slice(0, 4).map((x) => `${x.name}(${x.id})`));
  } catch (e) {
    console.log('user.plists  = ERR', e.code, '|', e.message);
  }

  try {
    const d = await qq.playlists.detail({ disstid: '9756103868', limit: 5 });
    console.log('pl.detail    =', { name: d.name, songCount: d.songCount, got: d.songs.length, first: d.songs[0] && d.songs[0].name });
  } catch (e) {
    console.log('pl.detail    = ERR', e.code, '|', e.message);
  }

  // 续期：观察 key 是否换新
  const before = (await qq.auth.status()).keyMasked;
  try {
    const r = await qq.auth.refresh();
    console.log('auth.refresh =', { before, after: r.keyMasked, changed: before !== r.keyMasked, state: r.state });
  } catch (e) {
    console.log('auth.refresh = ERR', e.code, '|', e.message);
  }

  qq.auth.stopAutoRefresh();
})();
