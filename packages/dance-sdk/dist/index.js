"use strict";
/**
 * @hdbc/dance-sdk
 * 舞曲工作台核心 SDK：
 *  - 舞种自动识别：`analyze` / `classify`（ffmpeg 解码 + aubio 测速 + 曲风/稳定性）
 *  - 多来源导入/下载：`createSourceRegistry`（QQ音乐 / 网易云 / 本地文件夹 / 直链·整库清单）
 *  - 本地缓存：`MediaCache`（统一下载 + 转 mp3）
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.netease = exports.createSourceRegistry = exports.clipAudio = exports.probeLoudness = exports.extractCover = exports.probeDurationMs = exports.MediaCache = void 0;
__exportStar(require("./classifier"), exports);
__exportStar(require("./localscan"), exports);
var media_1 = require("./media");
Object.defineProperty(exports, "MediaCache", { enumerable: true, get: function () { return media_1.MediaCache; } });
Object.defineProperty(exports, "probeDurationMs", { enumerable: true, get: function () { return media_1.probeDurationMs; } });
Object.defineProperty(exports, "extractCover", { enumerable: true, get: function () { return media_1.extractCover; } });
Object.defineProperty(exports, "probeLoudness", { enumerable: true, get: function () { return media_1.probeLoudness; } });
Object.defineProperty(exports, "clipAudio", { enumerable: true, get: function () { return media_1.clipAudio; } });
__exportStar(require("./sources/types"), exports);
var registry_1 = require("./sources/registry");
Object.defineProperty(exports, "createSourceRegistry", { enumerable: true, get: function () { return registry_1.createSourceRegistry; } });
exports.netease = __importStar(require("./sources/netease"));
//# sourceMappingURL=index.js.map