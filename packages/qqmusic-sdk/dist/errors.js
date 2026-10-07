"use strict";
/**
 * 统一错误模型。
 * 约束：任何 message / detail 中不得出现 cookie 或 key 明文。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QQMusicError = void 0;
exports.isQQMusicError = isQQMusicError;
exports.isAuthError = isAuthError;
exports.normalizeUpstreamError = normalizeUpstreamError;
exports.detectAuthFailure = detectAuthFailure;
exports.isLoginRequired = isLoginRequired;
class QQMusicError extends Error {
    constructor(code, message, opts = {}) {
        super(message);
        this.name = 'QQMusicError';
        this.code = code;
        this.retryable = opts.retryable ?? false;
        this.httpStatus = opts.httpStatus;
        this.upstreamCode = opts.upstreamCode;
        this.cause = opts.cause;
        Object.setPrototypeOf(this, QQMusicError.prototype);
    }
}
exports.QQMusicError = QQMusicError;
function isQQMusicError(e) {
    return e instanceof QQMusicError;
}
function isAuthError(code) {
    return code === 'QQ_AUTH_REQUIRED' || code === 'QQ_TOKEN_EXPIRED';
}
/** 把 qq-music-api / axios / fetch 抛出的各种错误归一化成 QQMusicError */
function normalizeUpstreamError(e) {
    if (isQQMusicError(e))
        return e;
    const raw = e && typeof e === 'object' && 'message' in e
        ? String(e.message)
        : e instanceof Error
            ? e.message
            : String(e);
    const lower = raw.toLowerCase();
    // qq-music-api 的错误文案
    if (raw.includes('未登陆') || raw.includes('未登录') || lower.includes('not login')) {
        return new QQMusicError('QQ_AUTH_REQUIRED', '未登录或登录态已失效', { upstreamCode: raw });
    }
    if (raw.includes('建议检查是否携带 cookie') || raw.includes('建议检查是否登录')) {
        return new QQMusicError('QQ_AUTH_REQUIRED', raw, { upstreamCode: raw });
    }
    if (raw.includes('刷新失败')) {
        return new QQMusicError('QQ_REFRESH_FAILED', raw, { upstreamCode: raw });
    }
    if (raw.includes('获取播放链接出错') || raw.includes('获取链接出错')) {
        return new QQMusicError('QQ_UNSUPPORTED', '该歌曲无法获取播放链接（可能为 VIP/版权限制或登录态失效）', {
            upstreamCode: raw,
        });
    }
    if (raw.includes('wrong path')) {
        return new QQMusicError('QQ_CONFIG', `上游路径不存在：${raw}`, { upstreamCode: raw });
    }
    const httpMatch = raw.match(/status code (\d{3})/i);
    if (httpMatch) {
        const status = Number(httpMatch[1]);
        if (status === 429)
            return new QQMusicError('QQ_RATE_LIMITED', '请求过于频繁', { httpStatus: status, retryable: true });
        return new QQMusicError('QQ_UPSTREAM', raw, { httpStatus: status, retryable: status >= 500 });
    }
    if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('aborted')) {
        return new QQMusicError('QQ_TIMEOUT', raw, { retryable: true, cause: e });
    }
    if (lower.includes('econn') || lower.includes('enotfound') || lower.includes('network') || lower.includes('fetch failed')) {
        return new QQMusicError('QQ_NETWORK', raw, { retryable: true, cause: e });
    }
    return new QQMusicError('QQ_UPSTREAM', raw || '未知上游错误', { upstreamCode: raw, cause: e });
}
/** 判断一个上游响应体是否表示需要鉴权（QQ 的 104009 / invalidq） */
function detectAuthFailure(payload) {
    const s = JSON.stringify(payload ?? {});
    return s.includes('104009') || s.includes('invalidq');
}
/** 判断 CGI 响应是否表示「需要登录」（QQ 常见 code/subcode） */
function isLoginRequired(payload) {
    if (!payload || typeof payload !== 'object')
        return false;
    const p = payload;
    const code = Number(p.code);
    const subcode = Number(p.subcode);
    const retcode = Number(p.retcode);
    if (code === 1000 || code === 1001 || code === 301)
        return true;
    if (subcode === 1000)
        return true;
    if (retcode === 100009 || retcode === 104009)
        return true;
    return false;
}
//# sourceMappingURL=errors.js.map