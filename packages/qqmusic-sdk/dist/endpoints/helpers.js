"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.num = num;
exports.str = str;
exports.coverUrl = coverUrl;
exports.inferQualities = inferQualities;
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function str(v) {
    return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function coverUrl(albumMid, size = 300) {
    return albumMid ? `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg` : null;
}
/** 由各音质文件大小推断可用音质，按偏好从高到低 */
function inferQualities(s) {
    const out = [];
    if (num(s.flac) > 0)
        out.push('flac');
    if (num(s.ape) > 0)
        out.push('ape');
    if (num(s.s320) > 0)
        out.push('320');
    if (num(s.s128) > 0)
        out.push('128');
    if (num(s.m4a) > 0)
        out.push('m4a');
    // 兜底：至少给个 128
    if (out.length === 0)
        out.push('128');
    return out;
}
//# sourceMappingURL=helpers.js.map