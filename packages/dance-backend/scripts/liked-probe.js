const { createQQMusicClient, HttpCookieProvider } = require('@hdbc/qqmusic-sdk');

(async () => {
  const qq = await createQQMusicClient({ cookieProvider: new HttpCookieProvider('http://127.0.0.1:8899/cookie') });
  const st = await qq.auth.status();
  console.log('status', st.state, st.uin, st.keyMasked);
  for (const [page, limit] of [[1, 5], [1, 1000], [2, 1000]]) {
    try {
      const d = await qq.user.liked({ page, limit });
      console.log('liked', 'page=' + page, 'limit=' + limit, '->', d.name, 'songCount=' + d.songCount, 'got=' + d.songs.length, 'trunc=' + d.songsTruncated, d.songs.slice(0, 3).map((s) => s.name));
    } catch (e) {
      console.log('liked', 'page=' + page, 'limit=' + limit, 'ERR', e.message);
    }
  }
})().catch((e) => console.error('FATAL', e));
