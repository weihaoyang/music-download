"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sign = sign;
// QQ 请求签名：仅保留 sign（写操作 / 续期需要），其余 qq-music-api 能力已由自研实现替代。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const signFn = require('qq-music-api/util/sign');
function sign(obj) {
    return signFn(obj);
}
//# sourceMappingURL=upstream.js.map