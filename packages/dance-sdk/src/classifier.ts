import { spawn } from 'child_process';

// 开源库：aubio（WASM 版 aubiojs）测速；ffmpeg 解码
// eslint-disable-next-line @typescript-eslint/no-var-requires
const aubioFactory = require('aubiojs') as () => Promise<{
  Tempo: new (bufSize: number, hopSize: number, sampleRate: number) => {
    do: (input: Float32Array) => number;
    getBpm: () => number;
    getConfidence: () => number;
  };
}>;
// 系统 ffmpeg（PATH）即可；可用 MF_FFMPEG 覆盖
const ffmpegPath = process.env.MF_FFMPEG || 'ffmpeg';

const SAMPLE_RATE = 22050;
const BUF_SIZE = 1024;

/** 曲风（表3 曲风列）：舒缓 / 干净利索 / 欢快 */
export type Mood = '舒缓' | '中' | '欢快';

/**
 * 舞种判定表（依据《HBDC 舞曲及排曲规则 20210508》表3「常见舞曲区别」）。
 * 文档「曲速」单位为「小节/分钟」，此处换算为实际 BPM 区间：
 * - 三拍（3/4）：BPM = 小节 × 3（慢三 28-30 → 84-90；快三 56-60 → 168-180）
 * - 四拍（4/4，按 2/4 计）：BPM = 小节 × 2
 *   慢四 30-37 → 60-74，伦巴 55-60 → 110-120，平四 66-71 → 132-142，
 *   并四 75-85 → 150-170，吉特巴 95 → ~190
 * mood 为表3 曲风：慢三/慢四/伦巴=舒缓，平四/吉特巴=欢快，并四=干净利索。
 * 只保留当前要用的 7 个舞种（华尔兹/探戈/狐步/快步先不做）。
 */
export interface DanceType {
  type: string;
  /** BPM 区间（含端点） */
  min: number;
  max: number;
  center: number;
  meter: '3/4' | '4/4';
  mood: Mood;
}

export const DANCE_TYPES: DanceType[] = [
  { type: '慢四', min: 58, max: 76, center: 67, meter: '4/4', mood: '舒缓' },
  { type: '慢三', min: 80, max: 94, center: 87, meter: '3/4', mood: '舒缓' },
  { type: '伦巴', min: 104, max: 126, center: 115, meter: '4/4', mood: '舒缓' },
  { type: '平四', min: 126, max: 148, center: 137, meter: '4/4', mood: '欢快' },
  { type: '并四', min: 148, max: 167, center: 158, meter: '4/4', mood: '中' },
  { type: '快三', min: 165, max: 184, center: 174, meter: '3/4', mood: '欢快' },
  { type: '吉特巴', min: 184, max: 205, center: 192, meter: '4/4', mood: '欢快' },
];

export interface AnalyzeResult {
  bpm: number;
  meter: '3/4' | '4/4';
  type: string | null;
  confidence: number;
  /** 曲风能量 0~1（0 舒缓 → 1 欢快） */
  energy: number;
  mood: Mood;
  /** 节奏稳定性 0~1（BPM 一致度 + 节拍清晰度） */
  stability: number;
  /** 节拍显著度（有明确鼓点的音乐 ≫1） */
  prominence: number;
  /** 每秒起音数 */
  onsetRate: number;
  /** 起音能量占比（纯音/静音≈0） */
  onsetStrength: number;
  /** 是否适合当舞曲（节奏不稳/无明显节拍时为 false） */
  suitable: boolean;
  /** 不适合时的提示语 */
  warning: string | null;
  /** 拍号判断置信度 0~1 */
  meterConfidence: number;
  /** 建议人工复核（低置信 / 贴近速度边界 / 拍号不明确） */
  needsReview: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** ffmpeg 解码为单声道 22050Hz f32le PCM（最多取前 90 秒足够测速） */
export function decode(file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-t', '90', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'];
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg 退出码 ${code}: ${err.slice(0, 200)}`));
      const buf = Buffer.concat(chunks);
      const arr = new Float32Array(buf.length / 4);
      for (let i = 0; i < arr.length; i++) arr[i] = buf.readFloatLE(i * 4);
      resolve(arr);
    });
  });
}

/** aubio 逐帧测速：众数 BPM + 一致度/置信度/离散度；bpm=0 表示未测出 */
export function analyzeTempo(
  pcm: Float32Array,
  Tempo: new (b: number, h: number, s: number) => any,
): { bpm: number; stability: number; conf: number; spread: number; agreement: number } {
  const hop = BUF_SIZE / 2;
  const tempo = new Tempo(BUF_SIZE, hop, SAMPLE_RATE);
  const bpms: number[] = [];
  const confs: number[] = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    tempo.do(pcm.subarray(i, i + hop));
    const bpm = tempo.getBpm();
    if (bpm > 0) {
      bpms.push(bpm);
      confs.push(tempo.getConfidence());
    }
  }
  if (!bpms.length) return { bpm: 0, stability: 0, conf: 0, spread: 0, agreement: 0 };
  const half = Math.floor(bpms.length / 2);
  const tail = bpms.slice(half);
  const tailConf = confs.slice(half);
  const counts = new Map<number, number>();
  for (const b of tail) {
    const r = Math.round(b);
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  let best = tail[tail.length - 1];
  let bestN = 0;
  for (const [b, n] of counts) if (n > bestN) ((bestN = n), (best = b));
  const tol = Math.max(3, best * 0.06);
  const within = tail.filter((b) => Math.abs(b - best) <= tol).length;
  const agreement = within / tail.length;
  const sorted = [...tail].sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? sorted[0];
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? sorted[sorted.length - 1];
  const spread = (p90 - p10) / Math.max(1, best);
  const conf = tailConf.reduce((a, b) => a + b, 0) / Math.max(1, tailConf.length);
  // 综合：一致度权重最大，其次置信度，离散度越小越好
  const stability = clamp01(0.55 * agreement + 0.3 * Math.min(1, conf) + 0.15 * (1 - Math.min(1, spread / 0.12)));
  return { bpm: best, stability, conf, spread, agreement };
}

/** 兼容旧签名：只要 BPM */
export function detectBpm(pcm: Float32Array, Tempo: new (b: number, h: number, s: number) => any): number {
  return analyzeTempo(pcm, Tempo).bpm;
}

/** 调试用：原始 bpm 序列 */
export function debugBpm(pcm: Float32Array, Tempo: new (b: number, h: number, s: number) => any): number[] {
  const hop = BUF_SIZE / 2;
  const tempo = new Tempo(BUF_SIZE, hop, SAMPLE_RATE);
  const out: number[] = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    tempo.do(pcm.subarray(i, i + hop));
    out.push(Math.round(tempo.getBpm() * 10) / 10);
  }
  return out;
}

export function buildOnset(pcm: Float32Array): number[] {
  const env: number[] = [];
  for (let i = 0; i + BUF_SIZE <= pcm.length; i += BUF_SIZE) {
    let s = 0;
    for (let j = 0; j < BUF_SIZE; j++) s += Math.abs(pcm[i + j]);
    env.push(s / BUF_SIZE);
  }
  return env.map((v, i) => (i === 0 ? 0 : Math.max(0, v - env[i - 1])));
}

function autoAt(onset: number[], lag: number): number {
  const L = Math.round(lag);
  if (L <= 0) return 0;
  let s = 0;
  for (let i = 0; i + L < onset.length; i++) s += onset[i] * onset[i + L];
  return s / Math.max(1, onset.length - L);
}

/** 节拍清晰度：节拍周期处的自相关 / 总能量，越接近规律强拍越高 */
export function pulseClarity(onset: number[], bpm: number): number {
  if (bpm <= 0 || !onset.length) return 0;
  let e0 = 0;
  for (const o of onset) e0 += o * o;
  e0 /= onset.length;
  if (e0 <= 0) return 0;
  const period = (60 / bpm) * (SAMPLE_RATE / BUF_SIZE);
  return Math.max(0, autoAt(onset, period) / e0);
}

/**
 * 节拍显著度：节拍周期附近自相关峰值 / 短时滞后基线。
 * 有明确鼓点的音乐 ≫ 1；纯音/白噪声等无节拍信号 ≈ 1。
 */
export function beatProminence(onset: number[], bpm: number): number {
  if (bpm <= 0 || onset.length < 64) return 0;
  const envRate = SAMPLE_RATE / BUF_SIZE;
  const period = (60 / bpm) * envRate;
  if (period < 3) return 0;
  let peak = 0;
  for (let k = 0.7; k <= 1.45; k += 0.03) {
    const v = autoAt(onset, period * k);
    if (v > peak) peak = v;
  }
  let base = 0;
  let n = 0;
  const maxLag = Math.min(50, Math.floor(period * 0.5));
  for (let L = 4; L <= maxLag; L++) {
    base += autoAt(onset, L);
    n++;
  }
  if (!n) return 0;
  base /= n;
  return base > 0 ? peak / base : 0;
}

/** 用节拍能量自相关判断 3/4 还是 4/4，并给出置信度（按节拍级基线归一化） */
function detectMeter(onset: number[], bpm: number): { meter: '3/4' | '4/4'; confidence: number } {
  if (bpm <= 0) return { meter: '4/4', confidence: 0 };
  const envRate = SAMPLE_RATE / BUF_SIZE;
  const beat = (60 / bpm) * envRate;
  const base = autoAt(onset, Math.max(1, Math.round(beat))) || 1e-9; // 节拍级基线
  const r3 = autoAt(onset, 3 * beat) / base;
  const r4 = autoAt(onset, 4 * beat) / base;
  const confidence = Math.abs(r3 - r4) / Math.max(r3, r4, 1e-9);
  return { meter: r3 > r4 * 1.05 ? '3/4' : '4/4', confidence: Math.round(confidence * 100) / 100 };
}

/**
 * 解决 aubio 常见的「半速」八度误差，并用曲风把关：
 * - 欢快：密集倍速脉冲很常见 → 较容易升八度
 * - 舒缓：慢曲本就不该有密集脉冲 → 要求很强的倍频证据才升八度
 */
function resolveOctave(onset: number[], bpm: number, mood: Mood): number {
  if (bpm <= 0) return bpm;
  const envRate = SAMPLE_RATE / BUF_SIZE;
  const period = (60 / bpm) * envRate; // 采样点数
  const s1 = autoAt(onset, period);
  const s2 = autoAt(onset, period / 2);
  const ratio = s2 / Math.max(1e-9, s1);
  const need = mood === '欢快' ? 0.5 : mood === '舒缓' ? 0.95 : 0.7;
  if (bpm * 2 <= 205 && ratio > need) return bpm * 2;
  return bpm;
}

/**
 * 曲风（能量）估计：0~1，越大越「欢快」。
 * 结合两个与「欢快/舒缓」最相关的代理特征：
 * - 亮度：一阶差分能量 / 总能量（近似谱质心，欢快曲高频/打击乐更亮）
 * - 起音密度：每秒显著起音数（越密集越欢快）
 */
export function estimateEnergy(
  pcm: Float32Array,
  onset: number[],
): { energy: number; mood: Mood; brightness: number; onsetRate: number; onsetStrength: number } {
  let d2 = 0;
  for (let i = 1; i < pcm.length; i++) {
    const d = pcm[i] - pcm[i - 1];
    d2 += d * d;
  }
  let x2 = 0;
  let sumAbs = 0;
  for (let i = 0; i < pcm.length; i++) {
    x2 += pcm[i] * pcm[i];
    sumAbs += Math.abs(pcm[i]);
  }
  const brightness = Math.sqrt(d2 / Math.max(1e-9, x2));

  const mean = onset.reduce((a, b) => a + b, 0) / Math.max(1, onset.length);
  const thr = mean * 1.6;
  let onsets = 0;
  for (const o of onset) if (o > thr) onsets++;
  const dur = pcm.length / SAMPLE_RATE;
  const onsetRate = onsets / Math.max(1, dur);
  // 起音能量占信号能量的比例：纯音/静音≈0，有鼓点的音乐明显 >0
  const onsetStrength = mean / Math.max(1e-6, sumAbs / Math.max(1, pcm.length));

  const energy = clamp01(0.45 * clamp01(brightness / 0.2) + 0.55 * clamp01(onsetRate / 4.5));
  const mood: Mood = energy >= 0.6 ? '欢快' : energy <= 0.36 ? '舒缓' : '中';
  return {
    energy: Math.round(energy * 100) / 100,
    mood,
    brightness: Math.round(brightness * 1000) / 1000,
    onsetRate: Math.round(onsetRate * 100) / 100,
    onsetStrength: Math.round(onsetStrength * 10000) / 10000,
  };
}

/** 曲风匹配度：完全一致 1，中性 0.6，冲突 0 */
function moodMatch(mood: Mood, expected: Mood): number {
  if (mood === expected) return 1;
  if (mood === '中' || expected === '中') return 0.6;
  return 0;
}

/** BPM -> 舞种：命中区间优先（并用曲风破同分），否则取最近中心 */
export function classify(
  bpm: number,
  meter: '3/4' | '4/4',
  mood: Mood = '中',
  meterConfidence = 1,
): { type: string | null; confidence: number } {
  if (!bpm || bpm <= 0) return { type: null, confidence: 0 };
  // 以「到各舞种中心值的距离（BPM 单位）」为主项；命中区间大幅优先；
  // 曲风/拍号只做约 ±3BPM 的微调 —— 避免 BPM 落在所有区间之外时被曲风带偏。
  const trustMeter = meterConfidence >= 0.15;
  const score = (t: DanceType): number => {
    const inR = bpm >= t.min && bpm <= t.max;
    let s = -Math.abs(bpm - t.center);
    if (inR) s += 20;
    s += 3 * moodMatch(mood, t.mood);
    if (trustMeter && meter === t.meter) s += 1.5;
    return s;
  };
  const inRange = DANCE_TYPES.filter((t) => bpm >= t.min && bpm <= t.max);
  const pool = inRange.length ? inRange : DANCE_TYPES;
  const best = pool.reduce((a, b) => (score(b) > score(a) ? b : a));

  const half = Math.max(1, (best.max - best.min) / 2);
  let confidence = Math.max(0.05, Math.min(1, 1 - Math.abs(bpm - best.center) / (half * 1.6)));
  confidence *= 0.75 + 0.25 * moodMatch(mood, best.mood); // 曲风不符时降信度
  if (meterConfidence >= 0.15 && meter !== best.meter) confidence *= 0.9;
  return { type: best.type, confidence: Math.round(confidence * 100) / 100 };
}

let aubioReady: Promise<{ Tempo: any }> | null = null;
function getAubio() {
  if (!aubioReady) aubioReady = aubioFactory();
  return aubioReady;
}

/** 分析一个本地音频文件 */
export async function analyze(file: string): Promise<AnalyzeResult> {
  const { Tempo } = await getAubio();
  const pcm = await decode(file);
  const onset = buildOnset(pcm);
  const { energy, mood, onsetRate, onsetStrength } = estimateEnergy(pcm, onset);
  const { bpm: rawBpm, stability: tempoStability } = analyzeTempo(pcm, Tempo);
  let bpm = resolveOctave(onset, rawBpm, mood);
  // 拉进 58~205 常规舞曲区间
  while (bpm > 0 && bpm < 58) bpm *= 2;
  while (bpm > 205) bpm /= 2;
  bpm = Math.round(bpm);
  const { meter, confidence: meterConfidence } = detectMeter(onset, bpm);
  const { type, confidence } = classify(bpm, meter, mood, meterConfidence);

  // 节奏稳定性：BPM 一致度 + 节拍清晰度 + 节拍显著度
  const clarity = pulseClarity(onset, bpm);
  const prominence = beatProminence(onset, bpm);
  const stability =
    Math.round(
      (0.5 * tempoStability + 0.3 * Math.min(1, clarity / 0.35) + 0.2 * Math.min(1, prominence / 3)) * 100,
    ) / 100;
  const suitable = bpm > 0 && onsetStrength >= 0.03 && prominence >= 1.6 && clarity >= 0.12;
  const warning = !bpm
    ? '未能测出稳定节拍'
    : !suitable
      ? '节奏不稳或节拍不清晰，可能不适合作为舞曲'
      : null;
  // 需人工复核：置信度低 / BPM 贴近区间边界 / 拍号不明确
  const nearBoundary = DANCE_TYPES.some((t) => Math.abs(bpm - t.min) <= 4 || Math.abs(bpm - t.max) <= 4);
  const needsReview = suitable && (confidence < 0.45 || nearBoundary || meterConfidence < 0.1);
  return {
    bpm,
    meter,
    type,
    confidence,
    energy,
    mood,
    stability,
    prominence: Math.round(prominence * 100) / 100,
    onsetRate,
    onsetStrength,
    suitable,
    warning,
    meterConfidence,
    needsReview,
  };
}
