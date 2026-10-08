'use strict';
// 网易云来源适配器 实网探针：搜索 / 详情 / 直链 / 歌词 / 歌单
const ne = require('@hdbc/dance-sdk').netease;

(async () => {
  console.log('== search 歌曲「晴天」==');
  const s = await ne.searchSongs('晴天', 3);
  console.log(s.map((x) => ({ id: x.id, name: x.name, ar: x.artists.join('/'), al: x.album, fee: x.fee, cover: !!x.coverUrl })));
  if (s[0]) {
    const d = await ne.songDetail([s[0].id]);
    console.log('== detail ==', d[0]);
    const u = await ne.songUrl(s[0].id);
    console.log('== url ==', u ? u.slice(0, 70) + '...' : null);
    const lyr = await ne.lyric(s[0].id);
    console.log('== lyric len ==', lyr.lyric.length);
  }

  console.log('== search 歌单「华语」==');
  const pls = await ne.searchPlaylists('华语', 2);
  console.log(pls);
  if (pls[0]) {
    const pd = await ne.playlistDetail(pls[0].id, 200);
    console.log('== playlist ==', pd.name, 'songs=', pd.songs.length, pd.songs.slice(0, 2).map((x) => x.name + ' - ' + x.artists.join('/')));
  }

  console.log('== extractNeId ==');
  console.log(ne.extractNeId('https://music.163.com/#/playlist?id=3778678'));
  console.log(ne.extractNeId('分享歌单 https://y.music.163.com/m/playlist?id=1234567'));
  console.log(ne.extractNeId('https://music.163.com/song?id=186016'));
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
