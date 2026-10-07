import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUpstreamError, isLoginRequired } from '../errors';
import { parseCookie } from '../config';
import { normalizeTrackInfo } from '../endpoints/song';
import { normalizeSearchItem } from '../endpoints/search';
import { normalizePlaylistBrief, normalizePlaylistSong, extractDissId } from '../endpoints/playlist';import { normalizeProfile, normalizeUserPlaylist } from '../endpoints/user';
import { hash33, getGtk, parseSetCookie, getGuid } from '../auth/qr-login';

test('错误映射：未登陆 -> QQ_AUTH_REQUIRED', () => {
  const e = normalizeUpstreamError({ message: '未登陆' });
  assert.equal(e.code, 'QQ_AUTH_REQUIRED');
  assert.equal(e.name, 'QQMusicError');
});

test('错误映射：获取播放链接出错 -> QQ_UNSUPPORTED', () => {
  assert.equal(normalizeUpstreamError({ message: '获取播放链接出错' }).code, 'QQ_UNSUPPORTED');
});

test('错误映射：HTTP 500 -> QQ_UPSTREAM 且可重试', () => {
  const e = normalizeUpstreamError({ message: 'Request failed with status code 500' });
  assert.equal(e.code, 'QQ_UPSTREAM');
  assert.equal(e.httpStatus, 500);
  assert.equal(e.retryable, true);
});

test('解析 cookie：支持 wxuin 派生 uin 并清理非数字', () => {
  const c = parseCookie('login_type=2; wxuin=o123456789; qqmusic_key=abc');
  assert.equal(c.uin, '123456789');
  assert.equal(c.qqmusic_key, 'abc');
});

test('详情归一化：media_mid / 音质 / 歌手', () => {
  const song = normalizeTrackInfo(
    {
      id: 97773,
      mid: '0039MnYb0qxYhV',
      title: '晴天',
      singer: [{ name: '周杰伦' }],
      album: { id: 8220, mid: '000MkMni19ClKG', name: '叶惠美' },
      interval: 269,
      file: { media_mid: '003Qui1q2u1Zho', size_128mp3: 4317292, size_320mp3: 10792943, size_flac: 55397039 },
    },
    false,
  );
  assert.equal(song.mid, '0039MnYb0qxYhV');
  assert.equal(song.mediaMid, '003Qui1q2u1Zho');
  assert.deepEqual(song.artists, ['周杰伦']);
  assert.equal(song.durationMs, 269000);
  assert.ok(song.qualities.includes('flac') && song.qualities.includes('320'));
  assert.equal(song.raw, undefined);
});

test('搜索项归一化：基础字段', () => {
  const song = normalizeSearchItem(
    {
      songid: 97773,
      songmid: '0039MnYb0qxYhV',
      songname: '晴天',
      singer: [{ name: '周杰伦' }],
      albumid: 8220,
      albummid: '000MkMni19ClKG',
      albumname: '叶惠美',
      interval: 269,
      size128: 4317292,
      size320: 10792943,
      pay: { payplay: 1 },
    },
    false,
  );
  assert.equal(song.id, '97773');
  assert.equal(song.artists[0], '周杰伦');
  assert.equal(song.pay.playable, false);
  assert.ok(song.coverUrl && song.coverUrl.includes('000MkMni19ClKG'));
});

test('登录检测：code 1000 / subcode 1000', () => {
  assert.equal(isLoginRequired({ code: 1000 }), true);
  assert.equal(isLoginRequired({ subcode: 1000 }), true);
  assert.equal(isLoginRequired({ code: 0, data: {} }), false);
  assert.equal(isLoginRequired(null), false);
});

test('歌单搜索项归一化', () => {
  const brief = normalizePlaylistBrief({ dissid: '9756103868', dissname: '舞曲', imgurl: 'http://x/y.jpg', songnum: 42, creator: { name: '土豪' } });
  assert.equal(brief.id, '9756103868');
  assert.equal(brief.name, '舞曲');
  assert.equal(brief.songCount, 42);
  assert.equal(brief.creator, '土豪');
});

test('歌单歌曲归一化：兼容新旧字段', () => {
  const neu = normalizePlaylistSong(
    { id: 1, mid: 'm1', title: '新格式', singer: [{ name: 'A' }], album: { mid: 'al1', name: '专辑' }, interval: 200, file: { media_mid: 'mm1', size_320mp3: 100 } },
    false,
  );
  assert.equal(neu.name, '新格式');
  assert.equal(neu.mediaMid, 'mm1');
  assert.ok(neu.qualities.includes('320'));

  const old = normalizePlaylistSong(
    { songid: 2, songmid: 'm2', songname: '旧格式', singer: [{ name: 'B' }], albummid: 'al2', interval: 100 },
    false,
  );
  assert.equal(old.name, '旧格式');
  assert.equal(old.album?.mid, 'al2');
});

test('用户资料 / 歌单归一化', () => {
  const profile = normalizeProfile({ data: { creator: { nick: '小明', headpic: 'http://a.jpg', isvip: 1 } } }, '12345');
  assert.equal(profile.nickname, '小明');
  assert.equal(profile.vip, true);
  assert.equal(profile.uin, '12345');

  const brief = normalizeUserPlaylist({ dirid: 201, diss_name: '我喜欢', diss_cover: 'http://c.jpg', song_cnt: 7 });
  assert.equal(brief.id, '201');
  assert.equal(brief.songCount, 7);
});

test('外部歌单：extractDissId 解析各种链接形态', () => {
  assert.equal(extractDissId('7707261125'), '7707261125');
  assert.equal(extractDissId('https://y.qq.com/n/ryqq/playlist/7011264340'), '7011264340');
  assert.equal(extractDissId('https://i.y.qq.com/n2/m/share/details/taoge.html?id=7011264340&hosteuin='), '7011264340');
  assert.equal(extractDissId('https://y.qq.com/n/ryqq/playlist/123?disstid=456789'), '456789');
  assert.equal(extractDissId('https://c6.y.qq.com/base/fcgi-bin/u?__=AbCdEf'), null); // 短链需跟随跳转
  assert.equal(extractDissId(''), null);
});

test('扫码登录辅助函数：hash33 / getGtk / parseSetCookie / getGuid', () => {
  assert.equal(hash33(''), 0);
  assert.equal(getGtk(''), 5381);
  assert.ok(hash33('abcdef') > 0);

  const cookies = parseSetCookie('qrsig=abc; Path=/; HttpOnly, p_skey=xyz; Path=/; Domain=.qq.com');
  assert.deepEqual(cookies, ['qrsig=abc', 'p_skey=xyz']);
  assert.equal(parseSetCookie(null).length, 0);

  assert.match(getGuid(), /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
});
