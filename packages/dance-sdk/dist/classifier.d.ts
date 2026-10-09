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
export declare const DANCE_TYPES: DanceType[];
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
/** ffmpeg 解码为单声道 22050Hz f32le PCM（最多取前 90 秒足够测速） */
export declare function decode(file: string): Promise<Float32Array>;
/** aubio 逐帧测速：众数 BPM + 一致度/置信度/离散度；bpm=0 表示未测出 */
export declare function analyzeTempo(pcm: Float32Array, Tempo: new (b: number, h: number, s: number) => any): {
    bpm: number;
    stability: number;
    conf: number;
    spread: number;
    agreement: number;
};
/** 兼容旧签名：只要 BPM */
export declare function detectBpm(pcm: Float32Array, Tempo: new (b: number, h: number, s: number) => any): number;
/** 调试用：原始 bpm 序列 */
export declare function debugBpm(pcm: Float32Array, Tempo: new (b: number, h: number, s: number) => any): number[];
export declare function buildOnset(pcm: Float32Array): number[];
/** 节拍清晰度：节拍周期处的自相关 / 总能量，越接近规律强拍越高 */
export declare function pulseClarity(onset: number[], bpm: number): number;
/**
 * 节拍显著度：节拍周期附近自相关峰值 / 短时滞后基线。
 * 有明确鼓点的音乐 ≫ 1；纯音/白噪声等无节拍信号 ≈ 1。
 */
export declare function beatProminence(onset: number[], bpm: number): number;
/**
 * 曲风（能量）估计：0~1，越大越「欢快」。
 * 结合两个与「欢快/舒缓」最相关的代理特征：
 * - 亮度：一阶差分能量 / 总能量（近似谱质心，欢快曲高频/打击乐更亮）
 * - 起音密度：每秒显著起音数（越密集越欢快）
 */
export declare function estimateEnergy(pcm: Float32Array, onset: number[]): {
    energy: number;
    mood: Mood;
    brightness: number;
    onsetRate: number;
    onsetStrength: number;
};
/** BPM -> 舞种：命中区间优先（并用曲风破同分），否则取最近中心 */
export declare function classify(bpm: number, meter: '3/4' | '4/4', mood?: Mood, meterConfidence?: number): {
    type: string | null;
    confidence: number;
};
/** 分析一个本地音频文件 */
export declare function analyze(file: string): Promise<AnalyzeResult>;
//# sourceMappingURL=classifier.d.ts.map