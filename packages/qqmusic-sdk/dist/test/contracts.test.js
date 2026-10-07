"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const errors_1 = require("../errors");
const config_1 = require("../config");
const song_1 = require("../endpoints/song");
const search_1 = require("../endpoints/search");
const playlist_1 = require("../endpoints/playlist");
const user_1 = require("../endpoints/user");
const qr_login_1 = require("../auth/qr-login");
(0, node_test_1.default)('错误映射：未登陆 -> QQ_AUTH_REQUIRED', () => {
    const e = (0, errors_1.normalizeUpstreamError)({ message: '未登陆' });
    strict_1.default.equal(e.code, 'QQ_AUTH_REQUIRED');
    strict_1.default.equal(e.name, 'QQMusicError');
});
(0, node_test_1.default)('错误映射：获取播放链接出错 -> QQ_UNSUPPORTED', () => {
    strict_1.default.equal((0, errors_1.normalizeUpstreamError)({ message: '获取播放链接出错' }).code, 'QQ_UNSUPPORTED');
});
(0, node_test_1.default)('错误映射：HTTP 500 -> QQ_UPSTREAM 且可重试', () => {
    const e = (0, errors_1.normalizeUpstreamError)({ message: 'Request failed with status code 500' });
    strict_1.default.equal(e.code, 'QQ_UPSTREAM');
    strict_1.default.equal(e.httpStatus, 500);
    strict_1.default.equal(e.retryable, true);
});
(0, node_test_1.default)('解析 cookie：支持 wxuin 派生 uin 并清理非数字', () => {
    const c = (0, config_1.parseCookie)('login_type=2; wxuin=o123456789; qqmusic_key=abc');
    strict_1.default.equal(c.uin, '123456789');
    strict_1.default.equal(c.qqmusic_key, 'abc');
});
(0, node_test_1.default)('详情归一化：media_mid / 音质 / 歌手', () => {
    const song = (0, song_1.normalizeTrackInfo)({
        id: 97773,
        mid: '0039MnYb0qxYhV',
        title: '晴天',
        singer: [{ name: '周杰伦' }],
        album: { id: 8220, mid: '000MkMni19ClKG', name: '叶惠美' },
        interval: 269,
        file: { media_mid: '003Qui1q2u1Zho', size_128mp3: 4317292, size_320mp3: 10792943, size_flac: 55397039 },
    }, false);
    strict_1.default.equal(song.mid, '0039MnYb0qxYhV');
    strict_1.default.equal(song.mediaMid, '003Qui1q2u1Zho');
    strict_1.default.deepEqual(song.artists, ['周杰伦']);
    strict_1.default.equal(song.durationMs, 269000);
    strict_1.default.ok(song.qualities.includes('flac') && song.qualities.includes('320'));
    strict_1.default.equal(song.raw, undefined);
});
(0, node_test_1.default)('搜索项归一化：基础字段', () => {
    const song = (0, search_1.normalizeSearchItem)({
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
    }, false);
    strict_1.default.equal(song.id, '97773');
    strict_1.default.equal(song.artists[0], '周杰伦');
    strict_1.default.equal(song.pay.playable, false);
    strict_1.default.ok(song.coverUrl && song.coverUrl.includes('000MkMni19ClKG'));
});
(0, node_test_1.default)('登录检测：code 1000 / subcode 1000', () => {
    strict_1.default.equal((0, errors_1.isLoginRequired)({ code: 1000 }), true);
    strict_1.default.equal((0, errors_1.isLoginRequired)({ subcode: 1000 }), true);
    strict_1.default.equal((0, errors_1.isLoginRequired)({ code: 0, data: {} }), false);
    strict_1.default.equal((0, errors_1.isLoginRequired)(null), false);
});
(0, node_test_1.default)('歌单搜索项归一化', () => {
    const brief = (0, playlist_1.normalizePlaylistBrief)({ dissid: '9756103868', dissname: '舞曲', imgurl: 'http://x/y.jpg', songnum: 42, creator: { name: '土豪' } });
    strict_1.default.equal(brief.id, '9756103868');
    strict_1.default.equal(brief.name, '舞曲');
    strict_1.default.equal(brief.songCount, 42);
    strict_1.default.equal(brief.creator, '土豪');
});
(0, node_test_1.default)('歌单歌曲归一化：兼容新旧字段', () => {
    const neu = (0, playlist_1.normalizePlaylistSong)({ id: 1, mid: 'm1', title: '新格式', singer: [{ name: 'A' }], album: { mid: 'al1', name: '专辑' }, interval: 200, file: { media_mid: 'mm1', size_320mp3: 100 } }, false);
    strict_1.default.equal(neu.name, '新格式');
    strict_1.default.equal(neu.mediaMid, 'mm1');
    strict_1.default.ok(neu.qualities.includes('320'));
    const old = (0, playlist_1.normalizePlaylistSong)({ songid: 2, songmid: 'm2', songname: '旧格式', singer: [{ name: 'B' }], albummid: 'al2', interval: 100 }, false);
    strict_1.default.equal(old.name, '旧格式');
    strict_1.default.equal(old.album?.mid, 'al2');
});
(0, node_test_1.default)('用户资料 / 歌单归一化', () => {
    const profile = (0, user_1.normalizeProfile)({ data: { creator: { nick: '小明', headpic: 'http://a.jpg', isvip: 1 } } }, '12345');
    strict_1.default.equal(profile.nickname, '小明');
    strict_1.default.equal(profile.vip, true);
    strict_1.default.equal(profile.uin, '12345');
    const brief = (0, user_1.normalizeUserPlaylist)({ dirid: 201, diss_name: '我喜欢', diss_cover: 'http://c.jpg', song_cnt: 7 });
    strict_1.default.equal(brief.id, '201');
    strict_1.default.equal(brief.songCount, 7);
});
(0, node_test_1.default)('外部歌单：extractDissId 解析各种链接形态', () => {
    strict_1.default.equal((0, playlist_1.extractDissId)('7707261125'), '7707261125');
    strict_1.default.equal((0, playlist_1.extractDissId)('https://y.qq.com/n/ryqq/playlist/7011264340'), '7011264340');
    strict_1.default.equal((0, playlist_1.extractDissId)('https://i.y.qq.com/n2/m/share/details/taoge.html?id=7011264340&hosteuin='), '7011264340');
    strict_1.default.equal((0, playlist_1.extractDissId)('https://y.qq.com/n/ryqq/playlist/123?disstid=456789'), '456789');
    strict_1.default.equal((0, playlist_1.extractDissId)('https://c6.y.qq.com/base/fcgi-bin/u?__=AbCdEf'), null); // 短链需跟随跳转
    strict_1.default.equal((0, playlist_1.extractDissId)(''), null);
});
(0, node_test_1.default)('扫码登录辅助函数：hash33 / getGtk / parseSetCookie / getGuid', () => {
    strict_1.default.equal((0, qr_login_1.hash33)(''), 0);
    strict_1.default.equal((0, qr_login_1.getGtk)(''), 5381);
    strict_1.default.ok((0, qr_login_1.hash33)('abcdef') > 0);
    const cookies = (0, qr_login_1.parseSetCookie)('qrsig=abc; Path=/; HttpOnly, p_skey=xyz; Path=/; Domain=.qq.com');
    strict_1.default.deepEqual(cookies, ['qrsig=abc', 'p_skey=xyz']);
    strict_1.default.equal((0, qr_login_1.parseSetCookie)(null).length, 0);
    strict_1.default.match((0, qr_login_1.getGuid)(), /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
});
//# sourceMappingURL=contracts.test.js.map