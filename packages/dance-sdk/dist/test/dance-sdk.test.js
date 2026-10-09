"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const classifier_1 = require("../classifier");
const localscan_1 = require("../localscan");
const netease_1 = require("../sources/netease");
/* ------------------------------ 舞种识别（classify） ------------------------------ */
(0, node_test_1.default)('classify：各舞种「中心速度 + 匹配拍号/曲风」命中自身', () => {
    strict_1.default.equal((0, classifier_1.classify)(67, '4/4', '舒缓').type, '慢四');
    strict_1.default.equal((0, classifier_1.classify)(87, '3/4', '舒缓').type, '慢三');
    strict_1.default.equal((0, classifier_1.classify)(115, '4/4', '舒缓').type, '伦巴');
    strict_1.default.equal((0, classifier_1.classify)(137, '4/4', '欢快').type, '平四');
    strict_1.default.equal((0, classifier_1.classify)(158, '4/4', '中').type, '并四');
    strict_1.default.equal((0, classifier_1.classify)(174, '3/4', '欢快').type, '快三');
    strict_1.default.equal((0, classifier_1.classify)(192, '4/4', '欢快').type, '吉特巴');
});
(0, node_test_1.default)('classify：区间外按到中心值的距离取最近（103 → 伦巴，而非被曲风带偏）', () => {
    strict_1.default.equal((0, classifier_1.classify)(103, '4/4', '中').type, '伦巴');
    strict_1.default.equal((0, classifier_1.classify)(100, '3/4', '舒缓').type, '慢三');
});
(0, node_test_1.default)('classify：非法/零速度返回空类型、置信度 0', () => {
    strict_1.default.deepEqual((0, classifier_1.classify)(0, '4/4'), { type: null, confidence: 0 });
    strict_1.default.deepEqual((0, classifier_1.classify)(-5, '4/4'), { type: null, confidence: 0 });
});
(0, node_test_1.default)('classify：置信度落在 0~1', () => {
    for (const bpm of [67, 87, 115, 137, 158, 174, 192, 103]) {
        const c = (0, classifier_1.classify)(bpm, '4/4', '中').confidence;
        strict_1.default.ok(c >= 0 && c <= 1, `confidence out of range at ${bpm}: ${c}`);
    }
});
(0, node_test_1.default)('DANCE_TYPES：区间有序且中心落在区间内', () => {
    strict_1.default.ok(classifier_1.DANCE_TYPES.length >= 7);
    for (const t of classifier_1.DANCE_TYPES) {
        strict_1.default.ok(t.min <= t.center && t.center <= t.max, `${t.type} 中心不在区间内`);
        strict_1.default.ok(t.min < t.max);
    }
    const mins = classifier_1.DANCE_TYPES.map((t) => t.min);
    strict_1.default.deepEqual(mins, [...mins].sort((a, b) => a - b), '区间未按速度升序');
});
/* ------------------------------ 节拍/能量（纯信号处理） ------------------------------ */
(0, node_test_1.default)('buildOnset：静音为全 0；能量阶跃处产生正起音', () => {
    const silence = new Float32Array(1024 * 3);
    strict_1.default.deepEqual((0, classifier_1.buildOnset)(silence), [0, 0, 0]);
    const pcm = new Float32Array(1024 * 3);
    for (let i = 1024; i < 2048; i++)
        pcm[i] = 1;
    const onset = (0, classifier_1.buildOnset)(pcm);
    strict_1.default.equal(onset[0], 0);
    strict_1.default.ok(onset[1] > 0, '第 2 帧应为正起音');
    strict_1.default.equal(onset[2], 0);
});
(0, node_test_1.default)('estimateEnergy：静音 → 能量 0、舒缓；高频交替信号 → 能量明显 > 0', () => {
    const silence = new Float32Array(44100);
    const es = (0, classifier_1.estimateEnergy)(silence, (0, classifier_1.buildOnset)(silence));
    strict_1.default.equal(es.energy, 0);
    strict_1.default.equal(es.mood, '舒缓');
    strict_1.default.equal(es.onsetStrength, 0);
    const alt = new Float32Array(44100);
    for (let i = 0; i < alt.length; i++)
        alt[i] = i % 2 ? 1 : -1;
    const ea = (0, classifier_1.estimateEnergy)(alt, (0, classifier_1.buildOnset)(alt));
    strict_1.default.ok(ea.energy > 0.4, `期望能量较高，实际 ${ea.energy}`);
});
(0, node_test_1.default)('pulseClarity：周期脉冲序列的节拍清晰度高于随机序列', () => {
    const bpm = (60 * 22050) / 1024 / 10; // 使节拍周期 ≈ 10 帧
    const periodic = Array.from({ length: 200 }, (_, i) => (i % 10 === 0 ? 1 : 0));
    const random = Array.from({ length: 200 }, (_, i) => ((i * 2654435761) % 1000) / 1000);
    const cp = (0, classifier_1.pulseClarity)(periodic, bpm);
    const cr = (0, classifier_1.pulseClarity)(random, bpm);
    strict_1.default.ok(cp > 0.5, `周期序列清晰度应较高，实际 ${cp}`);
    strict_1.default.ok(cp > cr, `周期序列应高于随机序列（${cp} vs ${cr}）`);
});
(0, node_test_1.default)('beatProminence：空/短/零速为 0，长序列返回有限非负值', () => {
    strict_1.default.equal((0, classifier_1.beatProminence)([], 120), 0);
    strict_1.default.equal((0, classifier_1.beatProminence)(new Array(10).fill(1), 120), 0);
    strict_1.default.equal((0, classifier_1.beatProminence)(new Array(100).fill(1), 0), 0);
    const long = Array.from({ length: 400 }, (_, i) => ((i * 2654435761) % 100) / 100);
    const p = (0, classifier_1.beatProminence)(long, 120);
    strict_1.default.ok(Number.isFinite(p) && p >= 0, `应为有限非负，实际 ${p}`);
});
/* ------------------------------ 文件名解析（localscan） ------------------------------ */
(0, node_test_1.default)('parseDanceFileName：舞种-歌名-歌手[-时长]', () => {
    const a = (0, localscan_1.parseDanceFileName)('/srv/music/慢三-夜来香-邓丽君.mp3');
    strict_1.default.equal(a?.type, '慢三');
    strict_1.default.equal(a?.name, '夜来香');
    strict_1.default.deepEqual(a?.artists, ['邓丽君']);
    strict_1.default.equal(a?.durationMs, null);
});
(0, node_test_1.default)('parseDanceFileName：多歌手分隔符与时长', () => {
    const b = (0, localscan_1.parseDanceFileName)('/x/平四-歌-A、B.mp3');
    strict_1.default.deepEqual(b?.artists, ['A', 'B']);
    const c = (0, localscan_1.parseDanceFileName)('/x/快三-春天里-汪峰-3′30.mp3');
    strict_1.default.equal(c?.durationMs, 210000);
});
(0, node_test_1.default)('parseDanceFileName：下划线 / 全角连字符 也可作为分隔符', () => {
    strict_1.default.equal((0, localscan_1.parseDanceFileName)('/x/伦巴_歌_歌手.mp3')?.type, '伦巴');
    strict_1.default.equal((0, localscan_1.parseDanceFileName)('/x/慢三－夜来香－邓丽君.mp3')?.name, '夜来香');
});
(0, node_test_1.default)('parseDanceFileName：不合规文件名返回 null', () => {
    strict_1.default.equal((0, localscan_1.parseDanceFileName)('/x/随便一首歌.mp3'), null);
    strict_1.default.equal((0, localscan_1.parseDanceFileName)('/x/未知舞种-歌.mp3'), null);
});
(0, node_test_1.default)('coreName：去括号内容并做归一化', () => {
    strict_1.default.equal((0, localscan_1.coreName)('晴天 (Live)'), '晴天');
    strict_1.default.equal((0, localscan_1.coreName)('夜来香（Live版）'), '夜来香');
    strict_1.default.equal((0, localscan_1.coreName)('A-B'), (0, localscan_1.coreName)('a b'));
});
(0, node_test_1.default)('localMid：稳定、带前缀、同路径一致', () => {
    const m1 = (0, localscan_1.localMid)('D:/音乐/慢三-夜来香-邓丽君.mp3');
    const m2 = (0, localscan_1.localMid)('D:/音乐/慢三-夜来香-邓丽君.mp3');
    strict_1.default.equal(m1, m2);
    strict_1.default.match(m1, /^local-[0-9a-f]{12}$/);
});
/* ------------------------------ 网易云 ID 解析（netease） ------------------------------ */
(0, node_test_1.default)('extractNeId：纯数字 / 歌曲 / 歌单链接', () => {
    strict_1.default.deepEqual((0, netease_1.extractNeId)('7707261125'), { kind: 'playlist', id: '7707261125' });
    strict_1.default.deepEqual((0, netease_1.extractNeId)('https://music.163.com/song?id=123456'), { kind: 'song', id: '123456' });
    strict_1.default.deepEqual((0, netease_1.extractNeId)('https://music.163.com/#/song?id=999999'), { kind: 'song', id: '999999' });
    strict_1.default.deepEqual((0, netease_1.extractNeId)('https://music.163.com/playlist?id=456789'), { kind: 'playlist', id: '456789' });
    strict_1.default.equal((0, netease_1.extractNeId)(''), null);
    strict_1.default.equal((0, netease_1.extractNeId)('随便一段文字'), null);
});
//# sourceMappingURL=dance-sdk.test.js.map