'use strict';

// v4 冒烟：歌词接口 + /play 路由。
const BASE = 'http://127.0.0.1:8790';
(async () => {
  const l = await (await fetch(BASE + '/api/library/list?type=' + encodeURIComponent('慢三'))).json();
  const mid = (l.songs || [])[0] && l.songs[0].mid;
  if (!mid) return console.log('曲库为空');

  const r1 = await fetch(BASE + '/api/song/lyric?mid=' + mid);
  const text = await r1.text();
  console.log('lyric    =', { status: r1.status, type: r1.headers.get('content-type'), length: text.length, head: JSON.stringify(text.slice(0, 60)) });

  const j = await (await fetch(BASE + '/api/song/lyric?mid=' + mid + '&json=1')).json();
  console.log('lyricjson=', { ok: j.ok, length: j.data && j.data.lyric && j.data.lyric.length, hasTrans: !!(j.data && j.data.trans) });

  const play = await fetch(BASE + '/play');
  console.log('/play    =', { status: play.status, type: play.headers.get('content-type') });
})();
