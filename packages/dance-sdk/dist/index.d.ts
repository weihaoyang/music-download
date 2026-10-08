/**
 * @hdbc/dance-sdk
 * 舞曲工作台核心 SDK：
 *  - 舞种自动识别：`analyze` / `classify`（ffmpeg 解码 + aubio 测速 + 曲风/稳定性）
 *  - 多来源导入/下载：`createSourceRegistry`（QQ音乐 / 网易云 / 本地文件夹 / 直链·整库清单）
 *  - 本地缓存：`MediaCache`（统一下载 + 转 mp3）
 */
export * from './classifier';
export * from './localscan';
export { MediaCache } from './media';
export * from './sources/types';
export { createSourceRegistry } from './sources/registry';
export * as netease from './sources/netease';
//# sourceMappingURL=index.d.ts.map