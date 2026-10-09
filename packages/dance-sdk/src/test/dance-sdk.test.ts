import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, DANCE_TYPES, buildOnset, estimateEnergy, pulseClarity, beatProminence } from '../classifier';
import { parseDanceFileName, coreName, localMid } from '../localscan';
import { extractNeId } from '../sources/netease';

/* ------------------------------ 舞种识别（classify） ------------------------------ */

test('classify：各舞种「中心速度 + 匹配拍号/曲风」命中自身', () => {
  assert.equal(classify(67, '4/4', '舒缓').type, '慢四');
  assert.equal(classify(87, '3/4', '舒缓').type, '慢三');
  assert.equal(classify(115, '4/4', '舒缓').type, '伦巴');
  assert.equal(classify(137, '4/4', '欢快').type, '平四');
  assert.equal(classify(158, '4/4', '中').type, '并四');
  assert.equal(classify(174, '3/4', '欢快').type, '快三');
  assert.equal(classify(192, '4/4', '欢快').type, '吉特巴');
});

test('classify：区间外按到中心值的距离取最近（103 → 伦巴，而非被曲风带偏）', () => {
  assert.equal(classify(103, '4/4', '中').type, '伦巴');
  assert.equal(classify(100, '3/4', '舒缓').type, '慢三');
});

test('classify：非法/零速度返回空类型、置信度 0', () => {
  assert.deepEqual(classify(0, '4/4'), { type: null, confidence: 0 });
  assert.deepEqual(classify(-5, '4/4'), { type: null, confidence: 0 });
});

test('classify：置信度落在 0~1', () => {
  for (const bpm of [67, 87, 115, 137, 158, 174, 192, 103]) {
    const c = classify(bpm, '4/4', '中').confidence;
    assert.ok(c >= 0 && c <= 1, `confidence out of range at ${bpm}: ${c}`);
  }
});

test('DANCE_TYPES：区间有序且中心落在区间内', () => {
  assert.ok(DANCE_TYPES.length >= 7);
  for (const t of DANCE_TYPES) {
    assert.ok(t.min <= t.center && t.center <= t.max, `${t.type} 中心不在区间内`);
    assert.ok(t.min < t.max);
  }
  const mins = DANCE_TYPES.map((t) => t.min);
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b), '区间未按速度升序');
});

/* ------------------------------ 节拍/能量（纯信号处理） ------------------------------ */

test('buildOnset：静音为全 0；能量阶跃处产生正起音', () => {
  const silence = new Float32Array(1024 * 3);
  assert.deepEqual(buildOnset(silence), [0, 0, 0]);

  const pcm = new Float32Array(1024 * 3);
  for (let i = 1024; i < 2048; i++) pcm[i] = 1;
  const onset = buildOnset(pcm);
  assert.equal(onset[0], 0);
  assert.ok(onset[1] > 0, '第 2 帧应为正起音');
  assert.equal(onset[2], 0);
});

test('estimateEnergy：静音 → 能量 0、舒缓；高频交替信号 → 能量明显 > 0', () => {
  const silence = new Float32Array(44100);
  const es = estimateEnergy(silence, buildOnset(silence));
  assert.equal(es.energy, 0);
  assert.equal(es.mood, '舒缓');
  assert.equal(es.onsetStrength, 0);

  const alt = new Float32Array(44100);
  for (let i = 0; i < alt.length; i++) alt[i] = i % 2 ? 1 : -1;
  const ea = estimateEnergy(alt, buildOnset(alt));
  assert.ok(ea.energy > 0.4, `期望能量较高，实际 ${ea.energy}`);
});

test('pulseClarity：周期脉冲序列的节拍清晰度高于随机序列', () => {
  const bpm = (60 * 22050) / 1024 / 10; // 使节拍周期 ≈ 10 帧
  const periodic = Array.from({ length: 200 }, (_, i) => (i % 10 === 0 ? 1 : 0));
  const random = Array.from({ length: 200 }, (_, i) => ((i * 2654435761) % 1000) / 1000);
  const cp = pulseClarity(periodic, bpm);
  const cr = pulseClarity(random, bpm);
  assert.ok(cp > 0.5, `周期序列清晰度应较高，实际 ${cp}`);
  assert.ok(cp > cr, `周期序列应高于随机序列（${cp} vs ${cr}）`);
});

test('beatProminence：空/短/零速为 0，长序列返回有限非负值', () => {
  assert.equal(beatProminence([], 120), 0);
  assert.equal(beatProminence(new Array(10).fill(1), 120), 0);
  assert.equal(beatProminence(new Array(100).fill(1), 0), 0);
  const long = Array.from({ length: 400 }, (_, i) => ((i * 2654435761) % 100) / 100);
  const p = beatProminence(long, 120);
  assert.ok(Number.isFinite(p) && p >= 0, `应为有限非负，实际 ${p}`);
});

/* ------------------------------ 文件名解析（localscan） ------------------------------ */

test('parseDanceFileName：舞种-歌名-歌手[-时长]', () => {
  const a = parseDanceFileName('/srv/music/慢三-夜来香-邓丽君.mp3');
  assert.equal(a?.type, '慢三');
  assert.equal(a?.name, '夜来香');
  assert.deepEqual(a?.artists, ['邓丽君']);
  assert.equal(a?.durationMs, null);
});

test('parseDanceFileName：多歌手分隔符与时长', () => {
  const b = parseDanceFileName('/x/平四-歌-A、B.mp3');
  assert.deepEqual(b?.artists, ['A', 'B']);

  const c = parseDanceFileName('/x/快三-春天里-汪峰-3′30.mp3');
  assert.equal(c?.durationMs, 210000);
});

test('parseDanceFileName：下划线 / 全角连字符 也可作为分隔符', () => {
  assert.equal(parseDanceFileName('/x/伦巴_歌_歌手.mp3')?.type, '伦巴');
  assert.equal(parseDanceFileName('/x/慢三－夜来香－邓丽君.mp3')?.name, '夜来香');
});

test('parseDanceFileName：不合规文件名返回 null', () => {
  assert.equal(parseDanceFileName('/x/随便一首歌.mp3'), null);
  assert.equal(parseDanceFileName('/x/未知舞种-歌.mp3'), null);
});

test('coreName：去括号内容并做归一化', () => {
  assert.equal(coreName('晴天 (Live)'), '晴天');
  assert.equal(coreName('夜来香（Live版）'), '夜来香');
  assert.equal(coreName('A-B'), coreName('a b'));
});

test('localMid：稳定、带前缀、同路径一致', () => {
  const m1 = localMid('D:/音乐/慢三-夜来香-邓丽君.mp3');
  const m2 = localMid('D:/音乐/慢三-夜来香-邓丽君.mp3');
  assert.equal(m1, m2);
  assert.match(m1, /^local-[0-9a-f]{12}$/);
});

/* ------------------------------ 网易云 ID 解析（netease） ------------------------------ */

test('extractNeId：纯数字 / 歌曲 / 歌单链接', () => {
  assert.deepEqual(extractNeId('7707261125'), { kind: 'playlist', id: '7707261125' });
  assert.deepEqual(extractNeId('https://music.163.com/song?id=123456'), { kind: 'song', id: '123456' });
  assert.deepEqual(extractNeId('https://music.163.com/#/song?id=999999'), { kind: 'song', id: '999999' });
  assert.deepEqual(extractNeId('https://music.163.com/playlist?id=456789'), { kind: 'playlist', id: '456789' });
  assert.equal(extractNeId(''), null);
  assert.equal(extractNeId('随便一段文字'), null);
});
