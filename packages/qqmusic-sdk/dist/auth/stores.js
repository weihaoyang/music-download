"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryTokenStore = exports.FileTokenStore = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
/** 参考实现：把 cookie 存成一个 JSON 文件 */
class FileTokenStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    async load() {
        try {
            const raw = await fs_1.promises.readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            return parsed && parsed.uin ? parsed : null;
        }
        catch {
            return null;
        }
    }
    async save(cookie) {
        await fs_1.promises.mkdir((0, path_1.dirname)(this.filePath), { recursive: true });
        await fs_1.promises.writeFile(this.filePath, JSON.stringify(cookie, null, 2), 'utf8');
    }
    async clear() {
        await fs_1.promises.rm(this.filePath, { force: true });
    }
}
exports.FileTokenStore = FileTokenStore;
/** 内存实现，便于测试 */
class MemoryTokenStore {
    constructor(cookie = null) {
        this.cookie = cookie;
    }
    async load() {
        return this.cookie;
    }
    async save(cookie) {
        this.cookie = cookie;
    }
    async clear() {
        this.cookie = null;
    }
}
exports.MemoryTokenStore = MemoryTokenStore;
//# sourceMappingURL=stores.js.map