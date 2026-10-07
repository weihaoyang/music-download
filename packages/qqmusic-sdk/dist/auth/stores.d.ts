import type { Cookie, TokenStore } from '../types';
/** 参考实现：把 cookie 存成一个 JSON 文件 */
export declare class FileTokenStore implements TokenStore {
    private readonly filePath;
    constructor(filePath: string);
    load(): Promise<Cookie | null>;
    save(cookie: Cookie): Promise<void>;
    clear(): Promise<void>;
}
/** 内存实现，便于测试 */
export declare class MemoryTokenStore implements TokenStore {
    private cookie;
    constructor(cookie?: Cookie | null);
    load(): Promise<Cookie | null>;
    save(cookie: Cookie): Promise<void>;
    clear(): Promise<void>;
}
//# sourceMappingURL=stores.d.ts.map