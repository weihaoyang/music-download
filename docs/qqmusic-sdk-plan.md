# QQ Music Data SDK —— 设计计划（冻结契约）

> 目标：把「从 QQ 音乐拉取数据」做成一个**标准 SDK**：调用方式固定、边界契约清晰、可独立测试、可被排曲网站后端直接依赖。
> 本文是**实现前的计划**，先冻结范围、接口、错误模型、token 生命周期与验收标准，再动代码。

---

## 0. 一句话定义

**一个进程内的 Node.js 库**（不是服务、不是爬虫脚本），对外提供「搜索 / 歌曲元数据 / 播放直链 / 歌单解析 / token 生命周期」的稳定方法；对内把 QQ 音乐的原始、易变的接口和签名细节全部封死。

---

## 1. 范围与边界（最重要）

### 1.1 做什么（In scope）

| 能力 | 说明 |
|---|---|
| 搜索 | 歌曲搜索、歌单搜索、快速联想 |
| 歌曲 | 详情/元数据（含 `media_mid`、封面、时长、付费标记、可用音质） |
| 直链 | 取播放/下载直链（需登录态）；原始音频流；下载到文件 |
| 歌单 | 解析歌单详情（公开歌单）；用户自己的歌单列表 |
| 用户 | 个人资料、收藏/自建歌单（需登录态） |
| Token | 存储 / 续期 / 健康检查 / 单飞刷新 / 种子来源（cookie 粘贴、客户端镜像） |
| 运维 | 定时自动续期、失败降级、可观测事件 |

### 1.2 不做什么（Out of scope，明确拒绝）

| 不做 | 归属 |
|---|---|
| HTTP 路由 / Web 服务 | 调用方（排曲网站后端） |
| 曲库数据库 / 文件归档 | 调用方 |
| 登录页 / 二维码渲染 / UI | 调用方（SDK 只提供“设置 cookie / 拿登录态”） |
| 音频解密（TuneFree） | 独立的 acquisition 模块 |
| 音频转码（ffmpeg） | 独立的 acquisition 模块 |
| 排曲 / 生成歌单逻辑 | 调用方 |
| 扫码登录全流程 | 后续可选 `AuthProvider`，Phase 1 不做 |

> 结论：**SDK = 纯数据访问层**。`music-fetcher` 作为第一个消费者（dogfood），用它替换现在的 `src/qqmusic.js`。

### 1.3 合法性

仅供调用方在个人/授权范围内使用；README 必须写明，不提供绕过付费的承诺。

---

## 2. 分层与依赖方向

```
调用方后端
   │  只依赖 L4 公开 API 与 L0 的 DTO/错误类型
   ▼
L4 resources     search / songs / playlists / user      ← 稳定公开接口，返回 DTO
   │
L3 auth          TokenManager（存储/续期/健康/单飞）      ← 正交，可注入
   │
L2 endpoints     QQ 各接口适配 + 原始→DTO 归一化          ← 易变，集中在此
   │
L1 transport     统一请求：headers/sign/cookie/超时/重试   ← 不含业务
   ▼
QQ 音乐 HTTP 接口
```

**契约原则**
- 依赖只能向下，禁止下层 import 上层。
- L4 返回的 DTO **不含** QQ 原始字段名（`raw` 仅在 `includeRaw=true` 时附带）。
- L2 的归一化函数是**纯函数**，用固定 fixture 单测，不联网。
- auth 通过注入的接口与 transport 交互，不反向依赖 resources。

---

## 3. 传输层契约（L1）

```ts
interface RequestOptions {
  method?: 'GET' | 'POST';
  url: string;
  query?: Record<string, string | number | boolean | undefined>;
  form?: Record<string, string>;          // x-www-form-urlencoded
  json?: unknown;                         // JSON body
  headers?: Record<string, string>;
  auth?: 'none' | 'required' | 'optional'; // 默认 none
  sign?: boolean;                          // 是否需要 QQ 签名
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  responseType?: 'json' | 'stream';
}

interface RawResponse {
  status: number;
  headers: Headers;
  json: any;          // responseType=json
  stream?: ReadableStream; // responseType=stream
}
```

契约细节：
- 默认 headers：`User-Agent`（桌面 Chrome），`Referer` 按接口给（`)https://y.qq.com`）。
- `auth: 'required'` → 取 `TokenManager.ensureValid()` 注入 cookie；无有效 token 直接抛 `QQ_AUTH_REQUIRED`（不发起请求）。
- `auth: 'optional'` → 有 token 就带，没有也照发。
- 401/104009 → 触发一次“刷新后重试”，只重试一次，避免风暴。
- 网络错误/5xx → 指数退避重试（默认 2 次）。
- 超时默认 10s。
- **日志与错误中一律脱敏 cookie/key**。

---

## 4. 鉴权与 Token 生命周期（核心）

### 4.1 数据契约

```ts
interface Cookie {
  uin: string;                       // 必填
  qqmusic_key: string;               // 必填（或 qm_keyst）
  qm_keyst?: string;
  [k: string]: string | undefined;
}

interface TokenStore {               // 由调用方实现（文件/DB）；SDK 只定义接口
  load(): Promise<Cookie | null>;
  save(cookie: Cookie): Promise<void>;
  clear(): Promise<void>;
}

interface CookieProvider {           // 可选：种子来源，如常驻 PC 客户端镜像
  getCookie(): Promise<Cookie | null>;
}
```

### 4.2 状态机

```
unauthenticated ──setCookie/seed──▶ valid ──接近过期──▶ expiring ──refresh──▶ valid
       ▲                               │                                          │
       └────────── refresh 失败/鉴权失败 ─┴────────────── expired ◀───────────────┘
```

- `valid`：距上次刷新 < `intervalMs`。
- `expiring`：距上次刷新 ∈ [`intervalMs` - `expiringThresholdMs`, `intervalMs`）。
- `expired`：收到鉴权失败（`104009`）或刷新失败超过阈值。

### 4.3 续期机制（已确认）

QQ 音乐支持「拿旧 key 换新 key」的续期接口，形成永续链：

```
POST https://u6.y.qq.com/cgi-bin/musics.fcg?sign=<sig>&format=json
{
  "req1": {
    "module": "QQConnectLogin.LoginServer",
    "method": "QQLogin",
    "param": { "expired_in": 7776000, "musicid": "<uin>", "musickey": "<qm_keyst||qqmusic_key>" }
  }
}
→ resp.req1.data.musickey  // 新的 key，写回 qqmusic_key / qm_keyst
```

策略：
- **自动续期**：`startAutoRefresh()` 启动定时器；默认 `intervalMs = 30 天`（远小于 90 天），每次成功刷新后重置计时。
- **单飞（single-flight）**：并发刷新只发一次，其余共享同一 Promise。
- **错误驱动刷新**：任意鉴权接口失败 → `markExpired()` → 刷新 → 重试一次。
- **健康探针**：`health()` 打一个需要鉴权的便宜接口（如取一首已知可播放歌曲的 128k 直链），返回 `{ok,state,latencyMs}`。
- **种子优先级**：`seedCookie` → `TokenStore.load()` → `cookieProvider.getCookie()`（客户端镜像，兜底）。
- **失败处理**：刷新失败按指数退避重试（默认 3 次），最终失败抛 `QQ_REFRESH_FAILED` 并带“请重新设置 cookie / 检查客户端”指引；调用方可订阅 `onTokenRefreshed` / `onTokenExpired`。

### 4.4 客户端镜像（Phase 4，可选但关键）

```ts
interface CookieProvider { getCookie(): Promise<Cookie | null> }
// 实现：Frida 注入常驻 QQMusic.exe，读出内存里的 qqmusic_key/uin。
// 作用：作为“种子/兜底”，即使续期链断了也能恢复。
```

---

## 5. 公开 API 契约（L4）

### 5.1 工厂与配置

```ts
function createQQMusicClient(config?: QQMusicClientConfig): QQMusicClient;

interface QQMusicClientConfig {
  tokenStore?: TokenStore;
  seedCookie?: string | Cookie;
  cookieProvider?: CookieProvider;
  refresh?: {
    intervalMs?: number;            // 默认 30d
    expiringThresholdMs?: number;   // 默认 7d
    onAuthErrorRefresh?: boolean;   // 默认 true
    maxAttempts?: number;           // 默认 3
  };
  http?: {
    timeoutMs?: number;             // 默认 10000
    retries?: number;               // 默认 2
    throttleMs?: number;            // 默认 0
    headers?: Record<string, string>;
  };
  includeRaw?: boolean;             // 默认 false
  fetchImpl?: typeof fetch;         // 注入测试
  now?: () => number;               // 注入时钟
  logger?: Logger;
  onTokenRefreshed?: (s: AuthStatus) => void;
  onTokenExpired?: (e: QQMusicError) => void;
}
```

### 5.2 方法表

| 方法 | 鉴权 | 参数 | 返回 | 主要错误 |
|---|---|---|---|---|
| `search.songs` | 无 | `{keyword, page?, limit?}` | `Page<Song>` | QQ_UPSTREAM/QQ_NETWORK |
| `search.playlists` | 无 | `{keyword, page?, limit?}` | `Page<PlaylistBrief>` | 同上 |
| `search.quick` | 无 | `{keyword}` | `{songs,artists,albums,playlists}` | 同上 |
| `songs.detail` | 无 | `{songmid}` | `Song` | QQ_NOT_FOUND |
| `songs.details` | 无 | `{songmids[]}` | `Song[]` | — |
| `songs.url` | 需要 | `{songmid, mediaId?, quality?}` | `SongUrl` | QQ_AUTH_REQUIRED/QQ_UNSUPPORTED |
| `songs.stream` | 需要 | `{songmid, quality?}` | `ReadableStream` | 同上 |
| `songs.downloadToFile` | 需要 | `{songmid, quality?, destPath}` | `{path,bytes,url}` | 同上 |
| `playlists.detail` | 可选 | `{disstid, page?, limit?}` | `PlaylistDetail` | QQ_NOT_FOUND |
| `playlists.addSongs` | 需要 | `{dirid, songmids[]}` | `{added,failed}` | QQ_AUTH_REQUIRED |
| `playlists.create` | 需要 | `{name, songmids?}` | `PlaylistBrief` | QQ_AUTH_REQUIRED |
| `user.profile` | 需要 | — | `Profile` | QQ_AUTH_REQUIRED |
| `user.playlists` | 需要 | — | `PlaylistBrief[]` | QQ_AUTH_REQUIRED |
| `auth.status` | — | — | `AuthStatus` | — |
| `auth.setCookie` | — | `string\|Cookie` | `AuthStatus` | QQ_CONFIG |
| `auth.refresh` | — | — | `AuthStatus` | QQ_REFRESH_FAILED |
| `auth.health` | — | — | `HealthResult` | — |
| `auth.seedFromProvider` | — | — | `AuthStatus` | QQ_AUTH_REQUIRED |
| `auth.startAutoRefresh` / `stopAutoRefresh` | — | — | `void` | — |
| `raw.request` | 可选 | `RequestOptions` | `RawResponse` | 透传（逃生舱） |

### 5.3 分页契约

```ts
interface Page<T> { items: T[]; page: number; limit: number; total: number | null; hasMore: boolean; }
```
- `page` 从 1 开始；`limit` 有上限（搜索默认 20，最大 50）。
- `total` 拿不到时为 `null`；`hasMore` 由 `items.length === limit` 推断。

---

## 6. 数据模型（DTO）

```ts
type Quality = 'm4a' | '128' | '320' | 'flac' | 'ape';

interface Song {
  source: 'qqmusic';
  id: string;                 // songid
  mid: string;                // songmid
  mediaMid: string;           // 付费歌曲 media_mid（拼直链文件名用）
  name: string;
  artists: string[];
  album: { id: string; mid: string; name: string } | null;
  durationMs: number;
  coverUrl: string | null;
  pay: { playable: boolean; downloadable: boolean; priceTrack: number | null };
  qualities: Quality[];       // 由 size128/size320/sizeape/sizeflac 推断
  raw?: unknown;              // 仅 includeRaw=true
}

interface PlaylistBrief { source:'qqmusic'; id:string; name:string; coverUrl:string|null; songCount:number; creator?:string; }
interface PlaylistDetail extends PlaylistBrief { songs: Song[]; songsTruncated: boolean; }
interface SongUrl { songmid:string; quality:Quality; url:string; expiresAt:number|null; }
interface Profile { source:'qqmusic'; uin:string; nickname:string|null; avatarUrl:string|null; vip:boolean; }

interface AuthStatus {
  state: 'unauthenticated'|'valid'|'expiring'|'expired';
  uin: string | null;
  keyMasked: string | null;     // 例：abcd****wxyz，绝不返回完整 key
  lastRefreshedAt: number | null;
  nextRefreshAt: number | null;
}
interface HealthResult { ok:boolean; state:AuthStatus['state']; checkedAt:number; latencyMs:number; detail?:string; }
```

---

## 7. 错误模型

```ts
type QQErrorCode =
  | 'QQ_CONFIG'          // 配置缺失（如需要鉴权却没 TokenStore）
  | 'QQ_NETWORK'         // 连接失败/DNS
  | 'QQ_TIMEOUT'
  | 'QQ_UPSTREAM'        // QQ 返回非预期 code（500001 / -3003 等）
  | 'QQ_PARSE'           // 响应结构变化，无法归一化
  | 'QQ_AUTH_REQUIRED'   // 需要登录却没有有效 token
  | 'QQ_TOKEN_EXPIRED'   // token 失效（104009）
  | 'QQ_REFRESH_FAILED'  // 续期失败
  | 'QQ_NOT_FOUND'
  | 'QQ_RATE_LIMITED'
  | 'QQ_UNSUPPORTED';    // 音质不可用/VIP 限制（purl 为空）

class QQMusicError extends Error {
  code: QQErrorCode;
  retryable: boolean;
  httpStatus?: number;
  upstreamCode?: number | string;
  cause?: unknown;
  // 约束：message/detail 中不得出现 cookie/key
}
```

映射表（已实测）：

| QQ 现象 | 归一化 |
|---|---|
| `retcode=104009`, `msg=invalidq`, purl 空 | `QQ_TOKEN_EXPIRED` / `QQ_AUTH_REQUIRED` |
| `code=500001` | `QQ_UPSTREAM` |
| `-3003 system error` | `QQ_UPSTREAM` |
| `purl=''` 但已登录（VIP/版权） | `QQ_UNSUPPORTED` |
| HTTP 5xx / 网络异常 | `QQ_UPSTREAM` / `QQ_NETWORK`，`retryable=true` |

---

## 8. 目录与包结构

建议独立成包，可发布、可复用：

```
D:\music-download\
  packages\
    qqmusic-sdk\
      package.json            # name: @hdbc/qqmusic-sdk, main/module/types
      src\
        index.ts              # createQQMusicClient + 导出类型
        client.ts             # 组装 resources + auth
        config.ts             # 默认值与校验
        errors.ts
        types.ts              # DTO + Page + Quality
        transport.ts          # L1
        sign.ts               # QQ 签名（待定，见风险）
        auth\
          token-manager.ts    # 状态机 + 单飞 + 定时
          refresh.ts          # QQLogin 续期
          stores.ts           # FileTokenStore 参考实现
          providers.ts        # CookieProvider 接口 + 占位
        endpoints\
          search.ts
          song.ts
          playlist.ts
          user.ts
        resources\
          search.ts           # 原始→DTO，公开方法
          songs.ts
          playlists.ts
          user.ts
      test\
        fixtures\*.json       # 录制的原始响应
        *.spec.ts
      README.md               # 契约文档
      CONTRACT.md             # 方法表 + 错误码 + 语义
  src\ (music-fetcher)        # 第一个消费者：改为依赖该 SDK
```

> 若不想拆包，也可放 `D:\music-download\src\qqmusic-sdk\`；结构不变。见“决策点”。

---

## 9. 测试与验收

| 层级 | 方式 | 验收标准 |
|---|---|---|
| 归一化 | 固定 fixture 纯函数单测 | 覆盖搜索/详情/直链/歌单各 3+ 样例 |
| 传输 | `fetchImpl` 注入 + mock | 超时、重试、脱敏、auth 注入正确 |
| token | 注入 `now()` + mock refresh | 单飞生效；expiring→valid；失败→QQ_REFRESH_FAILED |
| 契约 | 断言 DTO 形状稳定 | 字段缺失时有默认值，不抛 QQ_PARSE |
| 匿名/鉴权边界 | mock | 匿名方法**绝不**触发刷新 |
| 实网冒烟（可选，需 cookie） | 脚本 | 搜索/详情/直链/续期各返回成功 |
| 安全 | 全量日志捕获 | 输出中不含完整 key/cookie |

---

## 10. 里程碑

- **M0（本文）**：冻结契约。
- **M1 只读匿名**：transport + errors + search.songs / songs.detail / playlists.detail（公开）。可在无 token 下用。
- **M2 鉴权与续期**：TokenManager + `QQLogin` 续期 + health + songs.url/stream/downloadToFile。
- **M3 用户与写操作**：user.*、playlists.addSongs/create（需 sign）。
- **M4 种子镜像**：CookieProvider + Frida 客户端桥（独立小工具）+ 可选 cookie 池。
- **M5 文档/发布**：CONTRACT.md、README、类型导出、可选 npm publish + CI。

---

## 11. 风险与待决

| 风险 | 影响 | 缓解 |
|---|---|---|
| 签名算法与 QQMusicApi 的 GPL 许可 | 直接抄代码可能传染 GPL | 优先自研最小 sign；或把依赖隔离在可选适配器；或接受 GPL（见决策点） |
| 续期接口需有效 key 作种子 | 无种子无法启动 | 首次 cookie 粘贴 / 客户端镜像；文档给获取步骤 |
| 微信登录的 key 兼容性 | 续期失败 | 明确支持 QQ 登录优先；微信走单独分支验证 |
| 端点易变（已见 `-3003`） | 部分功能不可用 | 集中在 L2；契约测试 + 监控告警 |
| 音质/VIP | 直链为空 | `preferFallback`：320→128 逐级降级；仍无则 QQ_UNSUPPORTED |
| 频控/风控 | 被限流 | 节流参数、退避、cookie 池 |
| 待实测端点 | addSongs/create 等 | M3 才实现，逐条联调后再固化契约 |

---

## 12. 决策结果（已拍板）

| # | 决策 | 结果 |
|---|---|---|
| 1 | 语言 | **TypeScript**（编译 CJS + 类型声明） |
| 2 | 形态 | **独立包 `packages/qqmusic-sdk`** |
| 3 | 依赖 / 签名 | **依赖 `qq-music-api`（npm，GPL-3.0）** |
| 4 | 登录态种子 | **cookie 粘贴 + TokenStore，且同步做客户端 Frida 镜像** |
| 5 | 写操作 | **首版包含**（addSongs / create / sync） |
| 6 | 下载 | **含 `stream` + `downloadToFile`** |

### 12.1 依赖决策的注意点（重要）

- `qq-music-api` 为 **GPL-3.0** → 本 SDK 包 `license` 设为 `GPL-3.0`，README 注明。
- 实测该库 `/search` 内部走 `client_search_cp`，该端点**现已返回 HTTP 500**；因此**不能盲用它的 search**。本项目自研 search（`search_for_qq_cp`，已实测可用）。
- 依赖定位：把 `qq-music-api` 当作 **sign / 部分端点的适配器**，而非全部照搬。优先 `require('qq-music-api/util/sign')`；不可用则回退到它的 `api('user/refresh')`。
- 用它的第一件事：程序化验证 `qqMusic.setCookie()` + `qqMusic.api('user/refresh')` 是否真的能换到新 `musickey`。

### 12.2 Frida 客户端镜像（Phase 1 同步做）

- 新增子工具 `tools/qqclient-bridge`：attach 常驻 `QQMusic.exe`，读出 `qqmusic_key / uin`，以本地 HTTP `GET /cookie` 暴露。
- SDK 通过 `CookieProvider` 消费它。具体抠取方式（hook cookie 获取函数 / hook 网络层捕获 `Set-Cookie`）需在目标机联调；**手动粘贴始终作为保底**。

### 12.3 实施顺序

1. 脚手架：`package.json` / `tsconfig.json` / 目录结构。
2. L0/L1：`types`、`errors`、`config`、`transport`（含 sign 接入点）。
3. **M1**：`search.songs`、`songs.detail`、`playlists.detail`（匿名）。
4. **M2**：`TokenManager` + `refresh` + `health` + `songs.url/stream/downloadToFile`。
5. **M3**：`user.*` + `playlists.addSongs/create`。
6. **M4**：`qqclient-bridge` + `CookieProvider`。
7. **M5**：`CONTRACT.md` / `README.md` / 测试 / 类型导出。

---

## 13. 实现进度

### ✅ 已完成（M1 + M2 + M3；构建通过、10 条单测通过、实网冒烟通过）

包位置：`packages/qqmusic-sdk`（TypeScript → `dist/` + `.d.ts`）

| 层 | 文件 | 内容 |
|---|---|---|
| L0 | `src/types.ts` `src/errors.ts` `src/config.ts` | DTO、错误码、配置与 cookie 解析 |
| L1 | `src/transport.ts` | `HttpClient`（超时/重试/脱敏）+ `Upstream`（鉴权注入 + 鉴权失败自动刷新重试一次）+ `AuthContext` |
| auth | `src/auth/token-manager.ts` `refresh.ts` `stores.ts` | 状态机 / 单飞续期 / 定时 / 健康 / 种子兜底；`QQLogin` 续期；File/Memory TokenStore |
| endpoints | `src/endpoints/search.ts` `song.ts` `helpers.ts` | 自研 `search_for_qq_cp` 搜索；`track_info` 归一化 |
| resources | `src/resources/search.ts` `songs.ts` `playlists.ts` `user.ts` | `songs` 全套已实现；`playlists/user` 为 M3 占位（抛 `QQ_UNSUPPORTED`） |
| client | `src/client.ts` `src/index.ts` | `createQQMusicClient` 工厂 + 导出 |
| 测试 | `src/test/contracts.test.ts`、`scripts/live-smoke.js` | 契约单测 + 实网匿名冒烟 |

**实测结果**
- `search.songs({keyword:'晴天'})` → total=600，返回真实 `mid`；
- `songs.detail` → `mediaMid=003Qui1q2u1Zho`、`qualities=[flac,320,128]`、`durationMs=269000`；
- 无 cookie 调 `songs.url` → 正确抛 `QQ_AUTH_REQUIRED`（边界契约生效）；
- `npm test` → 6/6 通过。

### ✅ 已完成（M4 + M5 + 扫码登录）
- **M4 客户端镜像**：`tools/qqclient-bridge`（Frida）已实装并实测；SDK `HttpCookieProvider` 已接入，`CookieProvider` 兜底生效。
- **M5**：独立 `CONTRACT.md` 已完成；发布配置补齐（`exports` / `files` / `sideEffects` / `publishConfig` / `prepublishOnly` / `keywords`）。
- **扫码登录**：QQ / 微信二维码登录均已实现（见 §14）。

### ⏳ 仍受限（非代码可解）
- **服务端自续期**：`QQLogin` 对浏览器 cookie 与扫码 cookie 均返回 `10006`；SDK **不保证自续期**，长期有效依赖客户端镜像或各用户重新扫码。

### 登录链路实网验证结果（2026-10-05，使用真实 cookie）

| 能力 | 结果 |
|---|---|
| `auth.status` / `auth.health` | ✅ valid；`user/detail` 探针 OK |
| `songs.url`（付费歌 320k） | ✅ 返回直链 |
| `user.profile` | ✅ 昵称、vip 字段 |
| `user.playlists` | ✅ 7 个歌单（含"我喜欢"） |
| `playlists.detail` | ✅ 登录后返回歌单名 + 全部歌曲（匿名时正确抛 `QQ_AUTH_REQUIRED`） |
| `playlists.create` / `addSongs` / `delete` | ✅ 可逆验证：建 → 加歌(songCount=1) → 删，无残留 |
| `auth.refresh` | ❌ `r1.code=10006`（浏览器 cookie 无 refresh token） |

**结论**：除「自续期」外，全部登录链路已跑通；自续期需上述二选一方案。

---

## 14. M6：多用户扫码登录 + 多租户

**需求变更**：不用单一服务器账号，改为「每个用户在自己的浏览器扫码登录自己的 QQ 音乐」。

### ✅ 已实现：扫码登录（`src/auth/qr-login.ts`）

- **微信流程**（推荐，更简）：`open.weixin.qq.com/connect/qrconnect` 拿 `uuid` → 拉二维码图 → 轮询 `lp.open.weixin.qq.com/connect/l/qrconnect`（`wx_errcode`）→ `405` 时 `musicu.fcg` `music.login.LoginServer/Login` 换 `musickey` → 组 Cookie。
- **QQ 流程**：`ssl.ptlogin2.qq.com/ptqrshow` 拿 `qrsig` → `ptqrlogin`（`ptqrtoken=hash33(qrsig)`）→ 跟随跳转拿 `p_skey` → `graph.qq.com/oauth2.0/authorize` 换 `code` → `musicu.fcg` `QQConnectLogin.LoginServer/QQLogin` 换 `musickey` → 组 Cookie。
- 公开 API：`auth.login.start(type)` → `{ token, image }`；`auth.login.check(type, token)` → `{ state, cookie? }`（`pending|scanned|confirmed|expired`）。
- **实测**：**QQ 扫码全链路通过**（生成二维码 → 手机扫码 → `confirmed` → 拿到可用 cookie：status/health/直链/资料/歌单均正常）；微信二维码生成 + 轮询通过。
- 续期结论：扫码得到的 cookie 调 `QQLogin` 仍返回 `10006`，**不能自续**；「不过期」目前只能靠常驻客户端镜像，或多用户各自重扫。

### ✅ 已完成：多租户改造（2026-10-05）

- 删除 `qq-music-api` 进程级单例：`songs.detail` / `songs.url` / `auth.health` / `auth.refresh` 全部改为自研、cookie 按实例传入；`qq-music-api` 仅保留 `util/sign`。
- `createQQMusicClient({ cookie })` **每用户一个实例、无全局可变状态**。
- **并发实测**：5 个独立实例同时 `songs.url + user.profile` 全部成功；一个坏 cookie 实例独立失败，不影响他人。

### M3 实测补充（已加入）
- ✅ `search.playlists`（`client_music_search_songlist` + `remoteplace=txt.yqq.playlist`、`page_no` 从 0 起）匿名可用；`search.quick`（smartbox）匿名可用。
- 新增自研 CGI 层 `Cgi`（cookie 注入 + 登录失效刷新重试 + `isLoginRequired` 判定），playlist/user/mutation 不再走会崩溃的 `qq-music-api` 路由。
- `playlists.detail` 走 `musicu.fcg GetDetail`，匿名返回 `500003`/privacy → 归一化为 `QQ_AUTH_REQUIRED`（边界正确）。
- 新增测试：登录检测、歌单项/歌曲归一化（新旧字段）、用户资料/歌单归一化。

---

## 15. M4：客户端镜像（✅ 已完成并实测）

服务端纯 Python + Frida：从运行中的 `QQMusic.exe` 内存里抠出 live cookie，本地 HTTP 暴露；SDK 用 `HttpCookieProvider` 消费。

- 工具：`tools/qqclient-bridge/`（`agent.js` + `bridge.py`）。
- 实测：注入 QQMusic.exe（pid 18052）→ 扫内存 `qqmusic_key=` → 抽出该账号 cookie → SDK `health / 直链 / 资料` 全部通过。
- 关键价值：**客户端自己刷新 key，bridge 定期重扫 → 只要客户端开着就不用重扫、不会过期**，解决「纯服务端无法续期」的问题。
- 账号模型：**会员账号**登录客户端供全站补歌/下载（镜像）；**用户账号**各自扫码供个人歌单（每用户实例）。
- 排错记录：
  - Node 版 frida 缺 VS 工具链装不上 → 改用 **Python `frida`**（pip abi3 wheel 可用）。
  - Frida qjs 运行时里 `NativePointer.toNumber()` / `readUtf8()` 不存在 → 改用 `.toInt32()` + `readByteArray()` 手动解码。
  - `RangeDetails.size` 是 number（不是指针）。
  - provider 来的新鲜 cookie **不能**再走 `refresh`（会 10006 失败）→ TokenManager 已修正为直接使用。

---

## 16. 外部歌单导入（✅ 已完成并实测）

- `playlists.resolve({input})`：把「ID / 完整链接 / 分享短链」解析成 `disstid`（短链自动跟随跳转，从最终 URL 或页面文本里找 id）。
- `playlists.importPlaylist({url?|disstid?, limit?})`：拉取并归一化为 `PlaylistDetail`（`songs[].mid` 可直接用于写库 / 写歌单）。
- `playlists.clone({url?|disstid?, name, dirid?})`：一键克隆到「我的歌单」（给了 `dirid` 就加入，否则新建）。需登录态。
- **实测**（用真实歌单）：`resolve` 完整链接 → `9756103868`；`importPlaylist` → 歌单名 + 191 首（取 10 首，首曲 `Every Time We Touch (DJ版)`）；`clone` → 新建临时歌单并加入 5 首 → 校验 `songCount=5` → 清理，无残留。
- 单测：`extractDissId` 覆盖 纯 ID / 完整链接 / `taoge.html` / 带 `disstid` 参数 / 短链（返回 null 待跳转）。

---

## 17. 数据后端（✅ 已完成并实测）

`packages/dance-backend`：把 SDK 拼成排曲网站可直接用的数据后端。

- 默认曲库（按舞种，JSON 缓存）→ 浏览/编排零 token。
- 搜索/详情匿名；播放直链与外部歌单导入走**客户端镜像的会员账号**（不过期）。
- 每用户扫码登录（QQ/微信）→ `sid` cookie → 每用户一个 SDK 实例。
- 外部歌单：`resolve` / `import` / `clone`。
- 实测（`scripts/smoke.js`）：health / search(600) / library import(慢三, 8 首) / library list / song-url(320，经客户端镜像) / resolve / qr-start 全部通过。

---

## 18. 音频本地缓存 + 前端 + 批量构建（✅ 已完成并实测）

- **音频本地缓存**：`data/media/<mid>.<ext>`；导入/首次播放后台下载（受限并发）；`/api/song/url` 命中本地即返回 `/media/<file>`（`local:true`）；`/media/<file>` 支持 Range；`POST /api/library/download` 批量补齐。
- **前端页面**（Semi Design 浅色，CDN + htm，无需打包）：`public/`，后端托管在 `/`；含曲库/搜索/歌单导入/二维码登录/播放器。
- **批量离线构建**：`scripts/build-library.js` + `library.config.json`（舞种→歌单链接），导元数据 + 下载音频。
- 实测：`scripts/smoke-media.js` → 导入 8 首、全部缓存（8 个 mp3，4–14MB）、`song/url` 返回 `local:true`、`/media` 返回 206 + `audio/mpeg`、前端 `/`/`app.js`/`styles.css` 均 200。
- 排错：并发 `setFile` 写同一 `.tmp` 触发 ENOENT 并因未处理拒绝把进程搞崩 → `store.writeJson` 改为**按文件串行化 + 唯一临时名**，回调加 `.catch`。

---

## 19. 任务进度 + 排曲 + Vite 前端 + 自定义缓存位置（✅ 已完成并实测）

- **下载任务进度（类 Celery）**：`TaskStore`（queued/downloading/done/failed 计数）+ `GET /api/tasks`、`GET /api/tasks/:id`；`/api/library/import|download` 返回 `taskId`；前端顶部进度条轮询显示。
- **排曲逻辑**：`generateSetlist`（按舞种权重分配时长 + 舞种间轮转交错，`weighted`/`sequential`，`fill` 补足）+ `SetlistStore`；接口 `POST /api/setlist/generate`、`POST /api/setlist`、`GET /api/setlists`、`GET|DELETE /api/setlist/:id`。
- **Vite 前端（可部署静态产物，去 CDN）**：`packages/dance-frontend`（React+TS+Semi），`vite build` → `dist/`；后端按 `webDir` 托管；`index.html` 不缓存、指纹资源长缓存。坑：semi 的 `exports` 未导出 `dist/css` → vite `resolve.alias` 指向真实 CSS。
- **自定义缓存位置**：`data/settings.json` + `GET|PUT /api/settings`（admin）；`mediaDir` 改动**即时生效**（重建 MediaCache、新建目录、`/media` 指向新目录）；前端「设置」弹窗可改。
- 实测（`scripts/smoke-v2.js`）：`/` 无 CDN 且加载打包资源 200；`GET/PUT /api/settings` 改 `mediaDir` 到 `D:\music-cache-test` 再改回均成功；`/api/library/download` → `taskId` → task `done`；`/api/setlist/generate` 生成 8 首（1615000ms）；保存/列出排曲成功。浏览器截图确认 4 个 Tab（曲库/搜索/歌单导入/排曲）+ 设置按钮正常渲染。

---

## 20. 元数据编辑 + APlayer 播放页（✅ 已完成并实测）

- **元数据编辑**：`LibraryStore.updateSong` + `PUT /api/library/song`（admin）→ 改歌名/歌手/**舞种**，改舞种即移动到对应列表；前端曲库每行「编辑」弹窗。
- **播放页（开源方案）**：接入 **[APlayer](https://github.com/DIYgod/APlayer)**（MIT，封面/曲名/进度/完整列表/主题色）；新增 `GET /api/song/stream?mid=` **302** 到本地缓存或 QQ 直链给 `<audio>` 用；前端新增「播放」Tab，任意「播放」按钮把当前列表灌进 APlayer。
- 实测（`scripts/smoke-v3.js`）：`PUT /api/library/song` 把一首从「慢三」改到「慢四」→ 四里有、三里无；改回成功；`/api/song/stream` 返回 `302 → /media/<file>.mp3`。浏览器截图确认 APlayer 播放页（封面+标题+进度+8 首列表）。

---

## 21. 全屏播放路由 + 排曲 playback + 歌词（✅ 已完成并实测）

- **独立全屏播放路由**：前端 `main.tsx` 按 `pathname === '/play'` 渲染 `PlayerApp`（浅色渐变全屏 + `← 返回控制台`）；队列经 `localStorage('dance.queue')` 跨页传递。
- **排曲 playback**：排曲页「播放全部」、已保存排曲每项「播放」→ `openPlayer(songs)` 打开 `/play` 播整份排曲。
- **歌词**：SDK 新增 `songs.lyric({songmid})`（`endpoints/lyric.ts`，`fcg_query_lyric_new.fcg`，兼容 base64）→ 后端 `GET /api/song/lyric`（默认 text/plain LRC、`?json=1` JSON）→ APlayer `lrcType:3` 按需拉取。
- 实测（`scripts/smoke-v4.js`）：歌词 text/plain 592 字符（`[ti:...]`）、`?json=1` 正常、`/play` 返回 200；浏览器截图确认全屏播放页正常（含列表与 Loading→歌词 区域）。

---

## 22. 自动舞种分类 + 排曲编辑 + 统一播放（✅ 已完成并实测）

- **自动舞种分类**（开源 MIR）：`classifier.ts` = ffmpeg 解码 → **aubio（aubiojs）测 BPM**（含倍频修正）→ 节拍能量自相关判 3/4 vs 4/4 → 映射到 7 个舞种。接口 `POST /api/library/classify`（admin）→ task 进度 → 回写 `type/bpm/meter/confidence`。
- **排曲编辑**：后端 `SetlistSong.playMs` + `POST /api/setlist {songs:[{mid,playMs}]}`（totalMs 按裁剪计算）；前端**原生拖拽排序 / 一键乱序 / 按舞种归组 / 单曲「秒」裁剪**。
- **统一播放**：`/api/song/stream` 本地→`/media`、否则→QQ 直链（302）；全屏播放页据此同时支持本地 MP3 与 QQ 歌，并按 `playMs` 到点自动切下一首。
- 实测：
  - 分类 8/8 成功，结果如 `{bpm:134, meter:'4/4', type:'并四', confidence:0.78}`，且**自动移动**到对应舞种。
  - 裁剪保存 `totalMs=280000`（首曲 132s 裁到 60s + 次曲 220s）。
  - 统一播放：`QQ stream=302 http://aqqmusic.tc.qq.com/...`、`local stream=302 /media/...`。
  - 浏览器截图确认排曲编辑器（拖拽手柄 / 秒裁剪 / 一键乱序·按舞种归组 / 保存）。

---

## 23. 自动排列规则（按类型顺序，集体舞开场）（✅ 已完成并实测）

- 需求：**集体舞放开场**，其后按 `慢四 → 吉特巴 → 慢三 → 平四 → 并四 → 伦巴 → 快三`（再循环回集体舞）排，避免快慢扎堆。**优先满足此规则**。
- 实现：`setlist.ts` 新增 `DEFAULT_DANCE_ORDER = ['集体舞','慢四','吉特巴','慢三','平四','并四','伦巴','快三']`；`generateSetlist` 选歌按权重/时长，**排列改为按该类型顺序循环出队**（未知类型排最后）；`POST /api/setlist/generate` 接受 `order:[...]` 覆盖；前端「类型顺序」输入框 + 「按舞种归组」复用。
- 实测：把一首设为「集体舞」后生成 → `集体舞 → 平四 → 并四 → 并四…`（集体舞开场、随后按顺序；数据里只有这三种时后续为同类型补足）。
- 注：权重默认值已在前端随类型列表初始化，首次点「生成排曲」不再提示未设权重。

---

## 24. 大屏播放模式 `/wall`（✅ 已完成并实测）

- 独立全屏路由，供舞会现场大屏投放。基于开源 **howler.js**（音频，MIT）+ **anime.js**（动画，MIT）；配色象牙白/香槟金（沿用活动海报）。
- 展示：模糊封面背景、大封面、舞种标签、大字曲名、歌手、进度条+时间、**歌词（当前行/下一行）**、右侧「接下来」列表、时钟；底部控制（上一首/播放/下一首/全屏，悬停淡入）+ 快捷键（空格 / ←→ / F）。
- 队列与 `/play` 共用 `localStorage('dance.queue')`（含 `type`/`playMs`/`durationMs`）；音频统一走 `/api/song/stream`（本地/QQ 透明）；支持裁剪时长到点切歌。
- 控制台「排曲」页新增「**大屏播放**」按钮（`openWall`）。
- 实测：`/wall` 返回 200；浏览器截图确认渲染（封面/「平四」标签/《关中王进行曲(DJ戏腔版)》/AKirac/进度 0:18-3:40/歌词行/控制栏）。

---

## 25. 排曲传递文件 + 导出长图（✅ 已完成并实测）

- **舞会信息**：Setlist 增加 `event:{name,time,location,host,note}`；`POST /api/setlist` 保存。
- **传递文件**：`GET /api/setlist/:id/export` → 下载 `hdbc-setlist` JSON（`format/version/name/event/targetMin/totalMs/songs`）；`POST /api/setlist/import` → 按文件生成新排曲。前端「导出文件 / 导入文件」。
- **导出长图**：前端用开源 **html2canvas** 渲染离屏海报（`.poster-wrap`，象牙白/香槟金、Playfair 标题、曲目行含序号/舞种/时长、总时长与备注）→ 下载 PNG。
- 实测：保存带 `event` 的排曲（`totalMs=355000`）；`export` 返回 200 attachment、`format=hdbc-setlist`、3 首、`event.name=江风入曲·斜阳成诗`；`import` 还原成功；浏览器点「导出长图」弹出「长图已导出」并生成下载 `江风入曲·斜阳成诗.png`（image/png）。

---

## 26. 前端界面彻底重做（✅ 已完成并实测渲染）

- 建立统一设计系统（`styles.css` CSS 变量）：象牙白/香槟金/墨蓝 + 圆角/投影/字体 token；控制台、`/play`、`/wall`、海报统一观感。
- 控制台：顶栏（品牌 + 分段导航 + 用户胶囊）、内容卡片面板、曲目行带**封面缩略图** + 舞种/缓存/BPM 标签 + **SVG 图标按钮**、精致空状态、进度条、拖拽排曲行（金色序号徽章）；移除大量内联样式。
- `/play`、`/wall` 改用同一套 token（金色、字体、投影）。
- 实测：`/?v=` 渲染无 console 报错；DOM 校验 `.brand`/`.panel`/`.tabs` 结构正常；默认选中**首个非空舞种**。
- 注：本次想截图，但桌面窗口对该环境的截图工具不可见，未能截取；页面已确认正常渲染。

---

## 27. 大屏自动淡入淡出切歌（✅ 已完成并实测渲染）

- 切歌统一走 `goTo(target)`：当前音频 `fade(vol→0, 700ms)` → `setIdx` → 新曲 `volume(0)`+`play()`+`fade(0→1, 900ms)`；`busyRef` 防重入，`onend`/裁剪到点/←→/控制栏都走同一路径。
- 视觉同步淡入：`anime` 对 `.wall-cover/.wall-info`（透明度+位移）与 `.wall-bg`（0.12→0.35 透明度）做过渡。
- 实测：`/wall` 注入 6 首队列后渲染正常（标题/4 控制/5 首「接下来」/背景层），无 console 报错。播放/暂停恢复播放也带淡入。

---

## 28. 舞种自动识别按《HBDC 规则 20210508》重做，并加入曲风（✅ 已完成并实测）

- 问题：旧分类器把曲速单位换算错（把「小节/分钟」当 BPM），又用一个不可靠的 3/4 检测把结果硬塞进三拍家族，导致大量曲目误判/停留在「慢三」。
- 依据文档表3「常见舞曲区别」重新换算实际 BPM 区间（三拍 ×3，四拍按 2/4 计 ×2）：
  - 慢四 58–76、慢三 80–94、伦巴 104–126、平四 126–148、并四 148–167、快三 165–184、吉特巴 184–205；核心中心值 67/87/115/137/158/174/192。
- 新增**曲风（能量）**估计：亮度（一阶差分能量比）+ 起音密度 → 0~1，映射为 舒缓/中/欢快；表3 曲风列（慢三/慢四/伦巴=舒缓，平四/吉特巴=欢快，并四=干净利索）用于：
  1. aubio 半速八度误差的纠正（欢快更易升八度，舒缓要求更强的倍频证据）；
  2. 区间交界处破同分与置信度修正。
- 数据链路：`LibrarySong` 增加 `energy`/`mood` 并回写；`/api/library/classify` 只识别 7 个可分类舞种，**跳过「集体舞」等人工类型**；前端曲目行显示 舞种 + 曲风 + BPM 标签，编辑弹窗显示「BPM · 拍号 · 曲风（能量）」。
- 实测（本地 8 首缓存，均为抖音热歌 DJ 版）：6 首 132–134 BPM → 平四（欢快）；1 首 118 BPM → 伦巴；1 首人工「集体舞」被正确跳过（queued=7）。前端渲染 平四/欢快/BPM 标签正常，无报错。
- 待用户确认：118 BPM 的《关中王进行曲》被判为伦巴（表3 伦巴=舒缓），但其能量估为欢快——需人工核对 伦巴 vs 平四。（用户已确认：伦巴，正确。）

---

## 29. 曲风/节奏稳定性 + 按文件名校准 + 歌单导入修复（✅ 已完成并实测）

- **曲风（能量）**：亮度（一阶差分能量比）+ 起音密度 → 0~1 → 舒缓/中/欢快；表3 曲风列用于 aubio 半速八度纠错（欢快更易升八度，舒缓要求更强证据）与区间交界破同分/置信度。
- **节奏稳定性 / 「不适合舞曲」提示**：新增 `stability`（逐帧 BPM 一致度 + 置信度 + 离散度 + 节拍清晰度 + 节拍显著度）、`prominence`、`onsetStrength`；`suitable` 判定 + `warning` 文案。实测：8 首真实 DJ 曲全部 `suitable`（onsetStrength 0.06~0.16、prominence 8~27）；合成正弦/白噪声/纯音变调全部判为**不适合**（onsetStrength < 0.02、prominence ≤ 2.3）。前端曲目行显示「不适合舞曲」红色警示标签。
- **按文件名校准**：新增 `src/localscan.ts` 解析《规则表1》命名「舞种-歌曲名-歌手[-时长]」（全/半角连字符、下划线，支持「、、&//」多歌手与 4′20″ 时长）；`POST /api/library/calibrate`（admin）扫描目录或传 entries，按归一化歌名+歌手匹配默认曲库并改舞种（`confidence=1`），可选把未匹配的**加入曲库为本地文件**，支持 `dryRun`。本地文件以绝对路径入库，`/api/song/stream` 对绝对路径直接串流（带 Range）。
- **歌单导入修复**：
  - `LibraryStore.addSongs` 之前只按**目标舞种**去重，导致同一 mid 被导入到多个舞种形成重复；改为**全库去重**。实测：重复导入同一歌单 → `added 0 / skipped 3`，曲库计数不变。
  - 前端「歌单导入」此前只有「解析预览」+「克隆到我的歌单」（后者需 QQ 登录，且未登录时用户无路可走 → 表现为“无法正常使用”）。新增 **目标舞种选择 + 「导入到曲库」** 按钮：调用 `/api/library/import`，加入默认曲库并后台缓存音频，随后可浏览/排曲/离线播放。实测渲染正常，无 console 报错。
- 待办：把「不适合舞曲」阈值在真实“弱节奏/散拍”曲目上再校准（目前只用合成负样本验证过）。

---

## 30. 收尾：删除歌曲 + 手动校正 + 明暗主题 + 大屏升级 + SDK M5（✅ 已完成并实测）

- **曲库删除（真实缺口）**：此前只有改没有删（README 却写了“删除”）。新增 `LibraryStore.removeSong` + `DELETE /api/library/song?mid=`（admin，只删曲库记录不删音频）；前端曲目行新增红色「移除」按钮（Semi `Modal.confirm` 二次确认）。实测：加入本地曲 → 并四 1 → 删除 → 0；删不存在 mid → 404。
- **「不适合舞曲」手动校正**：`PUT /api/library/song` 支持 `suitable` / `warning`；编辑弹窗新增「适合当舞曲」单选（适合/不适合），手动标记为适合时自动清掉旧提示。用于给阈值缺真实样本兜底。
- **明/暗主题**：`api.ts` 新增 `getTheme/applyTheme/setTheme`（localStorage `dance.theme`），`main.tsx` 渲染前应用避免闪白；`styles.css` 加 `:root[data-theme='dark']` token 覆盖 + 深色 body/topbar/player 背景；同时切 `body[theme-mode=dark]` 让 Semi 组件走暗色。顶栏「☾ 深色 / ☀ 浅色」切换。实测：切换后 `data-theme=dark`、`theme-mode=dark`、`--ink=#e8ecf3`，按钮文案翻转。
- **大屏 `/wall` 升级**：封面与模糊背景改为**双图层交叉溶解**（改 `background-image` 无法过渡，改为两层 + CSS opacity 过渡）；封面加 **Ken Burns**（20s 缓慢缩放平移）+ **金色光晕脉冲**（`coverglow` box-shadow）；文字保留 anime 淡入。实测：2 个 `.wall-bg`（1 个 `.front`）、2 张封面图（1 张 `.front` 带 `kenburns`）、`.wall-cover` 带 `coverglow`，无 console 报错。
- **`/play` 入场**：`.player-page` 加 `pagefade`（淡入+上移），并补深色背景。
- **SDK M5**：新增独立 `packages/qqmusic-sdk/CONTRACT.md`（鉴权等级 / 方法表 / DTO / 错误模型 / 不变量 / 边界 / 配置）；`package.json` 补 `exports` / `sideEffects:false` / `files`(含 README+CONTRACT) / `publishConfig` / `prepublishOnly` / `keywords`。`npm test` 12/12 通过。
- **文档**：更新 §13 过期的「⏳ 待办」；本 §30 记录本轮收尾。

---

## 31. 「我喜欢」导入 + 播放即缓存 + 20GB 上限 + HQ 统一 mp3（✅ 已完成并实测）

- **SDK**：新增 `user.liked({page,limit})`，走 `music.srfDissInfo.DissInfo/CgiGetDiss`（`dirid=201`，需登录态）。实测 1005 首、分页正确（page1→1000、page2→5）。`CONTRACT.md` / README 已同步。
- **导入「我喜欢」**：`POST /api/library/import-liked`（admin）分页拉全，**默认只导元数据**（不下载），入「未分类」。实测 `added=1005 / queued=0`。
- **点击播放即缓存**：`/api/song/stream`、`/api/song/url` 未命中缓存时后台 enqueue 下载；实测点播后 `file/sizeBytes/playedAt` 写入。
- **20GB 上限 + LRU**：新增 `cacheLimitBytes`（config / `PUT /api/settings`，默认 20GiB，`0`=不限）；超限按 `playedAt` 升序淘汰到 90% 水位；改设置时立即执行。**只删缓存目录内的文件**。实测：limit=10,720,032 时最久未播放的《奢香夫人》被淘汰、《野心》保留。
- **统一转 mp3**：`MediaCache` 下载后 `ffprobe` 探 codec，非 mp3（flac/ape/m4a）用 `ffmpeg` 转 mp3；缓存统一命名 `<mid>.mp3`；HQ/320 本即 mp3，**无需解密**。
- **自动分类过滤修正**：由「白名单」改为**只跳过人工类型（集体舞）**，使「未分类」也能自动识别（仅对已缓存音频逐一分析）。
- **缓存目录校正**：`POST /api/library/scan`（admin）把缓存目录实际存在的文件重新挂回曲库、清掉缺失的 `file` 标记。实测 `linked=9 / cleared=1`。
- **关于「解密开源项目」**：本项目走 QQ API 直链，**HQ=320 直接就是标准 mp3**（`ffprobe` 实测 `codec_name=mp3`），所以**不需要解密**；Unlock Music / qmc-decode 等只针对 QQ **客户端**下载的加密文件（`.mflac/.mgg/.qmc*`）。已在转码失败分支给出「疑似加密，请用解密工具」告警；若确要处理客户端加密文件可再接外部解密工具。
- 排错：eviction 初版有两个 bug——未 `await setFile`、且把「不在当前缓存目录里的 `file`」也当候选（size 减 0）导致误清标记；已修（只处理实际存在的文件 + 先 await setFile + 实删实减）。

---

## 32. 批量「缓存 + 分类」（✅ 已完成并实测）

- 新增任务类型 `cacheClassify` + `POST /api/library/cache-classify` `{type?, limit?}`（admin）：对某舞种（默认「未分类」）逐首**先确保缓存（HQ）再分析舞种**；已缓存的直接分析，未缓存的 `media.ensure` 下载；并发取 `downloadConcurrency`（≤4），每首下载后 `enforceCacheLimit()` 受 20GB 上限约束。
- 前端曲库页新增「**缓存并分类**」按钮；任务进度条/完成提示识别该类型（`kindLabel`）。
- 实测：对「未分类」跑 limit=3 → `done 3 / failed 0`，结果 `124→伦巴、138→平四、172→快三`；曲库计数 `未分类 1005→1002`，`平四 6→7`、`伦巴 1→2`、`快三 0→1`。
- 说明：整库 1005 首若全跑，约需下载 ~7GB（<20GB 上限）、后台数十分钟；可分批（带 `limit`）或等播放时自动缓存后再点「自动分类」。

---

## 33. 「我喜欢」改为稳定合集 + 播放即识别（✅ 已完成并实测）

- **需求修正**：不按舞种把歌搬走，而是把「我喜欢」做成**稳定合集**——先列出全部曲目，点开播放时才缓存并识别舞种（舞种作为每首的**标签**）。
- **数据**：`LibrarySong.liked` 标记；`LibraryStore.likedSongs()` / `setLiked(mids)`；导入时对拉到的全部 mid 打标（含已存在/已归类的）。
- **接口**：`GET /api/library/list?liked=1` → 合集；`GET /api/library/types` 追加 `__liked__`（前端显示「我喜欢（N）」）。
- **自动识别只改 `type`（舞种标签），不会把歌移出合集**（`liked` 保留）。缓存后自动识别（`autoClassify`，仅对「未分类」）也已接入 `onDownloaded`。
- **前端**：曲库筛选新增「我喜欢」；导入成功后自动切到该视图；支持深链 `/?liked=1`、`/?type=xxx`。
- **导入健壮性**：`import-liked` **优先用当前登录用户的账号**，其次客户端镜像（bridge）。
- **实测**：`/api/library/list?liked=1` = 1005；`/?liked=1` 前端渲染 **1005 行**、Select 显示「我喜欢（1005）」、无 console 报错；已归类为《野心(平四)/橄榄树(伦巴)/乌兰巴托的夜(伦巴)》仍在合集中。
- **注意**：导入「我喜欢」需要有效登录态（用户扫码 **或** 客户端镜像 bridge 在线）；bridge 不在时返回 `401`（`QQ_AUTH_REQUIRED`）。

---

## 34. 全量冒烟 + 两处修复（✅ 27/27 通过）

- 新增 `packages/dance-backend/scripts/smoke-v6.js`：health / 曲库类型+列表+我喜欢合集 / 搜索+详情 / 播放直链（本地命中 + QQ 直链）/ stream / 歌词 / 设置 / 缓存用量 / scan / 歌曲编辑 / 排曲生成+保存+导出+导入+删除 / 歌单解析 / 校准 dryRun / **批量缓存并分类（实网）** / 前端三路由（`/`、`/play`、`/wall`）→ **PASS 27 / FAIL 0**。
- **修复 1（分类）**：BPM 落在所有区间之外时，曲风/拍号的**加性奖励会盖过距离**，导致如 `103 → 快三`。改为**以到各舞种中心值的 BPM 距离为主项**（命中区间 +20；曲风 ±3、拍号 +1.5 仅作微调）。复测：`100→慢三`、`103→伦巴`、`快三` 仅剩 `172/176`。
- **修复 2（缓存并发）**：同一 mid 的并发下载会写同一个 `.part` 互相覆盖（冒烟里 `song/url` 与 `cache-classify` 同时命中同一首 → 1 个失败）。`MediaCache.ensure` 增加 **in-flight 合并**；复测 `cache-classify` **2/2 成功**。
- **清理**：删除历史遗留的空舞种 `???`（早期 mojibake 请求产生），并在重启后确认不再出现。

---

## 35. 自动识别舞曲种类：实现方式（说明）

- **依据**：《HBDC 舞曲及排曲规则 20210508》表3「常见舞曲区别」——先听拍子（三拍/四拍），再按**曲速**（文档单位为「小节/分钟」）判断。
- **单位换算**：三拍 `BPM = 小节/分 × 3`；四拍 `BPM = 小节/分 × 2`（文档对四拍按 2/4 记）。得到各舞种的 BPM 区间：

  | 舞种 | 拍号 | 文档曲速(小节/分) | BPM 区间 | 中心 |
  |---|---|---|---|---|
  | 慢四 | 4/4 | 30–37 | 58–76 | 67 |
  | 慢三 | 3/4 | 28–30 | 80–94 | 87 |
  | 伦巴 | 4/4 | 55–60 | 104–126 | 115 |
  | 平四 | 4/4 | 66–71 | 126–148 | 137 |
  | 并四 | 4/4,2/4 | 75–85 | 148–167 | 158 |
  | 快三 | 3/4 | 56–60 | 165–184 | 174 |
  | 吉特巴 | 4/4 | 95 | 184–205 | 192 |

- **处理流水线**（`packages/dance-backend/src/classifier.ts`）：
  1. **解码**：`ffmpeg -t 90 -ac 1 -ar 22050 -f f32le` → 单声道 22.05kHz PCM（取前 90 秒足够测速）。
  2. **节拍包络**：1024 采样/帧求平均幅度 → env；`onset = max(0, env[i]-env[i-1])`（半波整流）。
  3. **测速**：开源 **aubio**（WASM 版 `aubiojs`）逐 hop(512) 输出 BPM 序列；取后半段**众数**为 BPM，并统计一致度/置信度/离散度。
  4. **八度纠错**：aubio 常把 132 报成 66（半速）。比较 `autoAt(周期)` 与 `autoAt(周期/2)` 的自相关比，超过阈值则升八度；阈值受**曲风**影响（欢快 0.5 / 中 0.7 / 舒缓 0.95 —— 欢快曲更容易有密集倍速脉冲）。
  5. **曲风（能量）**：亮度（一阶差分能量/总能量）+ 起音密度 → 0~1 → 舒缓/中/欢快。
  6. **拍号**：`autoAt(3×拍周期)` vs `autoAt(4×拍周期)` → 3/4 或 4/4（仅作微调权重）。
  7. **归类**：`score = -|BPM-中心|`（主项）`+ 命中区间 ? 20`（区间优先）`+ 3×曲风匹配`（同=1/中性=0.6/冲突=0）`+ 拍号匹配 ? 1.5`；取最高分。
  8. **置信度**：`(1 - 距离/(半宽×1.6)) × (0.75+0.25×曲风匹配) × (拍号不符 ? 0.9)`，再取整。
- **「是否适合作为舞曲」**：另算 `pulseClarity`（拍周自相关/总能量）、`beatProminence`（拍周峰值/短滞后基线）、`onsetStrength`（起音能量占比）、`stability`（BPM 一致度+置信度+离散度+清晰度+显著度）。判定 `suitable = onsetStrength≥0.03 && prominence≥1.6 && clarity≥0.12`，否则给 `warning`（前端显示红色「不适合舞曲」）。实测：纯音/白噪声/无节拍信号 `onsetStrength<0.02` 会被判不适合；真实 DJ 曲全部通过。
- **触发方式**：`POST /api/library/classify`（只处理已缓存音频）/ `POST /api/library/cache-classify`（先下载 HQ 再识别）/ 播放缓存后自动识别（仅「未分类」，可用设置关闭）。
- **依赖**：`ffmpeg`/`ffprobe`（系统 PATH，可用 `MF_FFMPEG`/`MF_FFPROBE` 覆盖）+ `aubiojs`。**纯本地计算，不联网。**
- **局限**：本质是「按速度+曲风」推断，无法真正识别鼓点型（如伦巴 3-3-2、平四蹦擦），边界速度与散拍/自由节奏会不准；已提供**手动改舞种**与「不适合舞曲」标记兜底。

---

## 36. 抽出标准 SDK `@hdbc/dance-sdk` + 自建服务器「整库清单」（✅ 已完成并实测）

- **新包 `packages/dance-sdk`**（license GPL-3.0-or-later）：把工作台的两大核心能力做成可复用标准 SDK：
  - **舞种识别**：`analyze` / `classify` / `DANCE_TYPES`（从 `dance-backend/src/classifier.ts` 迁入）。
  - **多来源导入**：`createSourceRegistry({qqAnonymous,qqLibrary})` —— `qqmusic` / `netease` / `local` / `http`（`TrackSource` 接口：`search? / build / streamUrl? / authed`）。
  - **本地缓存**：`MediaCache`（下载 + 统一转 mp3）。
  - 另含 `localscan`（文件名解析）、`netease`（网易云适配器，含 Cookie）。
- **后端瘦身**：`dance-backend` 改为依赖 `@hdbc/dance-sdk`（`file:../dance-sdk`）；删除内联的 `classifier.ts / localscan.ts / media.ts / sources/`；`server.ts` 通过 SDK 调用（`createSourceRegistry({ qqAnonymous: () => pool.anonymous(), qqLibrary: () => pool.libraryClient() })`）。脚本改为从 SDK `require`。
- **自建服务器「整库清单」**：`http` 来源新增 `{ manifestUrl }`，一次**收编服务器上的全部音频为完整曲库**：清单支持 `{base, files[]}` / `string[]` / `{urls[]}`；相对 `url` 按 `base`（或清单所在目录）解析；`name` 按《HBDC 规则》命名即可自动归舞种。示例：`packages/dance-backend/public/manifest.example.json`。
- **实测**：SDK 构建 OK；backend 构建 OK；`smoke-v6` **27/27**、`smoke-v7` **13/13**；`manifestUrl` 导入 2 项 → 自动归入「平四/慢三」→ 清理成功。

## 37. 播放历史 + 播放次数 + SQLite 单曲增量写（✅ 已完成并实测）

- **单曲增量写（性能）**：曲库改用 SQLite 后，`markPlayed` / `setFile` / `updateSong` / `removeSong` 原本都会触发**全表重写**；其中 `markPlayed` 在每次 `/api/song/stream`（本地播放会发多次 Range 请求）都被调用，代价被放大。新增 `saveSong()`（`INSERT ... ON CONFLICT(mid) DO UPDATE`，只写一行）与 `deleteSongRow()`，并把上述路径切过去；JSON 回退时仍全量写。
- **播放次数 + 去抖**：`LibrarySong.playCount`；`markPlayed` 在 8 秒内重复调用自动忽略，返回是否真正记了一次，避免同一首播放期间反复写库。
- **播放历史**：新增 `HistoryStore`（`data/history.json`，新在前，最多 500 条）。`/api/song/stream` 命中曲目即记录一次 `{mid,name,artists,type,coverUrl,at}`（去抖后）。接口：`GET /api/history?limit=`（公开）、`DELETE /api/history`（admin）。
- **前端**：曲库行新增「已播 N」标签；「状态」Tab 新增「最近播放」列表（舞种 / 歌名 / 歌手 / 时间 + 刷新 / 清空）。
- **实测**：对已缓存曲连续两次取流 → 历史仅 1 条、`playCount=1`（去抖生效）；重启后历史与 `playCount` 均持久（SQLite）；editor 清空历史 403、admin 可清；`smoke-v6` **27/27**、`smoke-v7` **14/14**；状态页渲染「最近播放（N）」，无 console 报错。
