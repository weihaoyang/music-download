# @hdbc/qqmusic-sdk · API 契约（CONTRACT）

> 版本：`0.1.0`（与 `package.json` 保持一致）
> 本文件是**对外稳定契约**。DTO 字段与方法签名按此为准；README 只作使用说明。
> 破坏性变更遵循：**新增字段/方法 = 次版本**；**删改字段/方法 = 主版本**。

---

## 1. 鉴权等级

| 等级 | 含义 |
|---|---|
| `none` | 匿名可用，**绝不触发 token 刷新** |
| `optional` | 有登录态就带上，没有也照常发送 |
| `required` | 无有效登录态直接抛 `QQ_AUTH_REQUIRED`，**不发请求** |

## 2. 方法表（冻结）

| 方法 | 鉴权 | 返回 |
|---|---|---|
| `search.songs({ keyword, page?, limit? })` | none | `Page<Song>` |
| `search.playlists({ keyword, page?, limit? })` | none | `Page<PlaylistBrief>` |
| `search.quick({ keyword })` | none | `QuickResult` |
| `songs.detail({ songmid })` | none | `Song` |
| `songs.details([{ songmid }])` | none | `Song[]` |
| `songs.url({ songmid, mediaId?, quality?, preferFallback? })` | required | `SongUrl` |
| `songs.stream({ songmid, ... })` | required | `Readable` |
| `songs.downloadToFile({ songmid, quality?, destPath })` | required | `{ path, bytes, url }` |
| `songs.lyric({ songmid })` | none | `LyricResult` |
| `playlists.detail({ disstid, page?, limit? })` | optional（实名需登录） | `PlaylistDetail` |
| `playlists.resolve({ input })` | none | `{ disstid }` |
| `playlists.importPlaylist({ url?, disstid?, limit? })` | optional（需登录） | `PlaylistDetail` |
| `playlists.clone({ url?, disstid?, name, dirid? })` | required | `PlaylistBrief` |
| `playlists.addSongs({ dirid, songmids })` | required | `AddSongsResult` |
| `playlists.create({ name, songmids? })` | required | `PlaylistBrief` |
| `playlists.delete({ dirid })` | required | `void` |
| `user.profile()` | required | `Profile` |
| `user.playlists()` | required | `PlaylistBrief[]` |
| `user.liked({ page?, limit? })` | required | `PlaylistDetail` |
| `auth.status()` | — | `AuthStatus` |
| `auth.setCookie(string \| Cookie)` | — | `AuthStatus` |
| `auth.refresh()` | — | `AuthStatus` |
| `auth.health()` | — | `HealthResult` |
| `auth.seedFromProvider()` | — | `AuthStatus` |
| `auth.startAutoRefresh()` / `auth.stopAutoRefresh()` | — | `void` |
| `auth.login.start(type)` | — | `QrLoginStart` |
| `auth.login.check(type, token)` | — | `QrLoginResult` |

## 3. 数据模型（DTO）

```ts
interface Song {
  source: 'qqmusic';
  id: string; mid: string; mediaMid: string;
  name: string; artists: string[];
  album: { id: string; mid: string; name: string } | null;
  durationMs: number; coverUrl: string | null;
  pay: { playable: boolean; downloadable: boolean; priceTrack: number | null };
  qualities: ('m4a' | '128' | '320' | 'flac' | 'ape')[];
  raw?: unknown; // 仅 includeRaw=true
}

interface Page<T> {
  items: T[];
  page: number; limit: number;
  total: number | null;
  hasMore: boolean;
}

interface SongUrl {
  songmid: string;
  quality: Quality;
  url: string;
  expiresAt: number | null;
}

interface AuthStatus {
  state: 'unauthenticated' | 'valid' | 'expiring' | 'expired';
  uin: string | null;
  keyMasked: string | null;
  lastRefreshedAt: number | null;
  nextRefreshAt: number | null;
}

interface HealthResult {
  ok: boolean;
  state: AuthState;
  checkedAt: number;
  latencyMs: number;
  detail?: string;
}
```

`PlaylistBrief`、`PlaylistDetail`、`Profile`、`QuickResult`、`AddSongsResult` 等完整定义见 `src/types.ts`（`dist/types.d.ts`）。

## 4. 错误模型

```ts
class QQMusicError extends Error {
  code: QQErrorCode;
  retryable: boolean;
  httpStatus?: number;
  upstreamCode?: number | string;
}
```

| code | 触发 | retryable |
|---|---|---|
| `QQ_AUTH_REQUIRED` | 需要登录态但没有 / 未登录 | 否 |
| `QQ_TOKEN_EXPIRED` | 登录态失效（104009 / invalidq） | 否 |
| `QQ_REFRESH_FAILED` | 续期失败 | 否 |
| `QQ_UNSUPPORTED` | 直链拿不到（VIP / 版权 / 音质不可用） | 否 |
| `QQ_UPSTREAM` | 上游非预期响应 / 5xx | 5xx 时 true |
| `QQ_NETWORK` / `QQ_TIMEOUT` | 网络问题 | 是 |
| `QQ_RATE_LIMITED` | 429 | 是 |
| `QQ_PARSE` / `QQ_NOT_FOUND` / `QQ_CONFIG` | 结构变化 / 找不到 / 配置错 | 否 |

## 5. 不变量（Invariants）

1. **无全局可变状态**：`createQQMusicClient({ cookie })` 每次返回独立实例，可安全并发；同一 cookie 不复用全局会话。
2. **不泄露凭据**：`message` 与日志中**不出现完整 cookie / key**，一律用 `keyMasked`。
3. **鉴权边界**：`required` 在无登录态时**不发请求**，直接抛错；`none` **绝不**触发刷新。
4. **单飞刷新**：同一实例的并发刷新会被合并为一次。
5. **超时与重试**：默认 `timeoutMs=10000`、`retries=2`（仅网络/5xx）；鉴权失败自动刷新并**重试一次**。
6. **续期限制**：`QQLogin` 续期对浏览器 cookie 与扫码 cookie 均返回 `10006`，**SDK 不保证自续期**；长期有效依赖客户端镜像（`HttpCookieProvider`）或重新扫码。

## 6. 边界（明确不做）

- 不做 HTTP 服务 / 路由、曲库存储、文件归档、登录 UI、解密 / 转码、排曲与歌单生成。
- `qq-music-api` 仅用于 `util/sign`；其余端点自研。

## 7. 配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `tokenStore` | — | `TokenStore` 实现（`FileTokenStore` / `MemoryTokenStore`） |
| `seedCookie` | — | 首次登录态（string 或对象） |
| `cookieProvider` | — | 兜底种子来源（客户端镜像） |
| `refresh.intervalMs` | 30d | 续期间隔 |
| `refresh.expiringThresholdMs` | 7d | 提前刷新窗口 |
| `refresh.onAuthErrorRefresh` | true | 鉴权失败自动刷新重试一次 |
| `refresh.maxAttempts` | 3 | 刷新重试次数（指数退避） |
| `http.timeoutMs` | 10000 | |
| `http.retries` | 2 | 网络 / 5xx 重试 |
| `includeRaw` | false | DTO 是否带原始对象 |
| `fetchImpl` / `now` / `logger` | — | 可注入（测试） |
