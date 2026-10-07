# @hdbc/qqmusic-sdk

QQ 音乐数据拉取 SDK：**搜索 / 元数据 / 播放直链 / 歌单 / token 续期**。
进程内 Node 库（CommonJS + 类型声明），供排曲网站后端依赖。

> License: GPL-3.0（因为依赖 `qq-music-api`）。仅供个人/授权范围内使用。

---

## 安装与构建

```bash
cd packages/qqmusic-sdk
npm install
npm run build      # 产出 dist/ + .d.ts
npm test           # 契约单测
node scripts/live-smoke.js   # 实网匿名冒烟（无需 cookie）
```

---

## 快速开始（匿名只读）

```ts
import { createQQMusicClient } from '@hdbc/qqmusic-sdk';

const qq = await createQQMusicClient();

const page = await qq.search.songs({ keyword: '晴天', limit: 10 });
// page.items[].mid / mediaMid / artists / qualities ...

const song = await qq.songs.detail({ songmid: page.items[0].mid });
```

## 带登录态（播放直链 / 续期 / 写操作）

```ts
import { createQQMusicClient, FileTokenStore } from '@hdbc/qqmusic-sdk';

const qq = await createQQMusicClient({
  tokenStore: new FileTokenStore('./.qq-cookie.json'),
  seedCookie: 'uin=...; qqmusic_key=...; qm_keyst=...', // 首次
  cookieProvider: myFridaClientBridge,                  // 可选兜底
  onTokenRefreshed: (s) => console.log('token 已续期', s.uin),
});

console.log(await qq.auth.status());     // { state, uin, keyMasked, ... }
console.log(await qq.auth.health());     // { ok, state, latencyMs }
const { url } = await qq.songs.url({ songmid: '0039MnYb0qxYhV', quality: '320' });
await qq.songs.downloadToFile({ songmid: '...', quality: 'flac', destPath: './x.flac' });
```

---

## 扫码登录（每用户）

每个用户在自己的浏览器里扫码，拿到**自己的** QQ 音乐登录态；后端为每个用户建一个 client 实例。

```ts
const qq = await createQQMusicClient();          // 无需预置 cookie

// 1) 取二维码：image 是 data URL，可直接 <img src>
const qr = await qq.auth.login.start('wx');       // 或 'qq'
// qr.token, qr.image

// 2) 轮询（建议 1~2s 一次，二维码约 2 分钟失效）
const r = await qq.auth.login.check('wx', qr.token);
// r.state: 'pending' | 'scanned' | 'confirmed' | 'expired'；confirmed 时带 r.cookie

// 3) confirmed 后把 r.cookie 存进你自己的用户表；下次为该用户建实例：
const userClient = await createQQMusicClient({ cookie: r.cookie });
```

> 两种都可用：QQ 流程步骤更多（含 `graph.qq.com` 握手）但**已实测扫码登录成功**；微信流程更短。建议默认 **QQ**，微信作为备选。

## 客户端镜像（长期不过期）

服务端跑一个 QQ 音乐客户端（登录**会员账号**），用 `tools/qqclient-bridge` 把它的 live cookie 暴露给 SDK：

```ts
import { createQQMusicClient, HttpCookieProvider } from '@hdbc/qqmusic-sdk';

const qq = await createQQMusicClient({
  cookieProvider: new HttpCookieProvider('http://127.0.0.1:8899/cookie'),
});
```

- 客户端会自己刷新 `qqmusic_key`，bridge 每 20s 重扫 → **只要客户端开着就不用重扫、不会过期**。
- 适合「补歌 / 下载用的会员账号」；用户个人歌单用各自的扫码 cookie（每用户一个实例）。
- 详见 `tools/qqclient-bridge/README.md`。

## 外部歌单导入

```ts
// 1) 解析分享链接 / ID（短链会自动跟随跳转）
const { disstid } = await qq.playlists.resolve({ input: 'https://c6.y.qq.com/base/fcgi-bin/u?__=xxxx' });

// 2) 拉取并归一化（需登录态）
const detail = await qq.playlists.importPlaylist({ url: 'https://y.qq.com/n/ryqq/playlist/9756103868', limit: 1000 });
// detail.songs -> Song[]，用 songs[].mid 即可写进自己的库 / 歌单

// 3) 一键克隆到「我的歌单」（新建，或加入已有）
await qq.playlists.clone({ url: '...', name: '我的舞曲' });                 // 新建
await qq.playlists.clone({ disstid: '9756103868', dirid: 201, name: '' });  // 加入指定歌单
```

- 支持输入形态：纯 ID、`y.qq.com/n/ryqq/playlist/<id>`、`taoge.html?id=<id>`、以及**分享短链**（自动跟随跳转解析）。
- `importPlaylist` / `clone` 需要登录态。

## 我喜欢（dirid=201）

```ts
const liked = await qq.user.liked({ page: 1, limit: 1000 });
// liked.name === '我喜欢'；liked.songCount = 总数；liked.songs = Song[]
// liked.songsTruncated === true 时 page+1 继续翻页
```

> 「我喜欢」与普通歌单不同，走 `music.srfDissInfo.DissInfo/CgiGetDiss`（`dirid=201`），需登录态。

## API 契约

### 鉴权等级

| 等级 | 含义 |
|---|---|
| `none` | 匿名可用，**绝不触发刷新** |
| `optional` | 有登录态就带，没有也照发 |
| `required` | 无有效登录态直接抛 `QQ_AUTH_REQUIRED`，不发请求 |

### 方法表

| 方法 | 鉴权 | 返回 | 状态 |
|---|---|---|---|
| `search.songs({keyword,page?,limit?})` | none | `Page<Song>` | ✅ |
| `search.playlists({keyword,page?,limit?})` | none | `Page<PlaylistBrief>` | ✅ |
| `search.quick({keyword})` | none | `QuickResult` | ✅ |
| `songs.detail({songmid})` | none | `Song` | ✅ |
| `songs.details([{songmid}])` | none | `Song[]` | ✅ |
| `songs.url({songmid,mediaId?,quality?,preferFallback?})` | required | `SongUrl` | ✅ |
| `songs.stream({...})` | required | `Readable` | ✅ |
| `songs.downloadToFile({...,destPath})` | required | `{path,bytes,url}` | ✅ |
| `playlists.detail({disstid,page?,limit?})` | optional（实测需登录） | `PlaylistDetail` | ✅ |
| `playlists.resolve({input})` | none | `{disstid}` | ✅ |
| `playlists.importPlaylist({url?,disstid?,limit?})` | optional（需登录） | `PlaylistDetail` | ✅ |
| `playlists.clone({url?,disstid?,name,dirid?})` | required | `PlaylistBrief` | ✅ |
| `playlists.addSongs({dirid,songmids})` | required | `AddSongsResult` | ✅ |
| `playlists.create({name,songmids?})` | required | `PlaylistBrief` | ✅ |
| `playlists.delete({dirid})` | required | `void` | ✅ |
| `user.profile()` | required | `Profile` | ✅ |
| `user.playlists()` | required | `PlaylistBrief[]` | ✅ |
| `user.liked({page?,limit?})` | required | `PlaylistDetail` | ✅ |
| `auth.status()` | — | `AuthStatus` | ✅ |
| `auth.setCookie(string\|Cookie)` | — | `AuthStatus` | ✅ |
| `auth.refresh()` | — | `AuthStatus` | ✅ |
| `auth.health()` | — | `HealthResult` | ✅ |
| `auth.seedFromProvider()` | — | `AuthStatus` | ✅ |
| `auth.startAutoRefresh()` / `stopAutoRefresh()` | — | `void` | ✅ |
| `auth.login.start(type)` | — | `QrLoginStart` | ✅ |
| `auth.login.check(type, token)` | — | `QrLoginResult` | ✅ |

### 数据模型（DTO，稳定）

```ts
interface Song {
  source: 'qqmusic';
  id: string; mid: string; mediaMid: string;
  name: string; artists: string[];
  album: { id: string; mid: string; name: string } | null;
  durationMs: number; coverUrl: string | null;
  pay: { playable: boolean; downloadable: boolean; priceTrack: number | null };
  qualities: ('m4a'|'128'|'320'|'flac'|'ape')[];
  raw?: unknown; // 仅 includeRaw=true
}
interface Page<T> { items: T[]; page: number; limit: number; total: number | null; hasMore: boolean; }
interface SongUrl { songmid: string; quality: Quality; url: string; expiresAt: number | null; }
interface AuthStatus { state: 'unauthenticated'|'valid'|'expiring'|'expired'; uin: string|null; keyMasked: string|null; lastRefreshedAt: number|null; nextRefreshAt: number|null; }
interface HealthResult { ok: boolean; state: AuthState; checkedAt: number; latencyMs: number; detail?: string; }
```

### 错误模型

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
| `QQ_UNSUPPORTED` | 直链拿不到（VIP/版权/音质不可用） | 否 |
| `QQ_UPSTREAM` | 上游非预期响应 / 5xx | 5xx 时 true |
| `QQ_NETWORK` / `QQ_TIMEOUT` | 网络问题 | 是 |
| `QQ_RATE_LIMITED` | 429 | 是 |
| `QQ_PARSE` / `QQ_NOT_FOUND` / `QQ_CONFIG` | 结构变化 / 找不到 / 配置错 | 否 |

> 约束：`message` / 日志中**不出现完整 cookie 或 key**（用 `keyMasked`）。

---

## Token 生命周期

- 状态机：`unauthenticated → valid → expiring → expired`。
- 续期：`QQConnectLogin.LoginServer / QQLogin`（旧 `musicKey` 换新，`expired_in≈90天`）。
- 策略：`required` 调用前自动 `ensureValid()`；到达 `expiring` 非阻塞刷新；收到鉴权错误自动刷新并重试一次；**单飞（single-flight）**避免并发刷新。
- 自动续期：`init()` 后启动，周期 `min(refresh.intervalMs, 1天)`，仅在 `expiring/expired` 时真正刷新；默认 `intervalMs=30天`、`expiringThresholdMs=7天`、`maxAttempts=3`。
- 种子优先级：`seedCookie` → `TokenStore.load()` → `CookieProvider.getCookie()`（客户端镜像兜底）。

> ⚠️ **续期现状（实测）**：无论「浏览器复制的 cookie」还是「扫码登录得到的 cookie」，调 `QQLogin` 续期都返回 `r1.code=10006`，**无法自续**。
> 目前「不过期」的唯一可靠方案是 **常驻客户端镜像（M4）**：从运行中的 `QQMusic.exe` 读它自动刷新后的 `qqmusic_key`。
> 多用户场景下，也可让每用户 cookie 失效后**各自重新扫码**（互不影响）。

### 配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `tokenStore` | — | `TokenStore` 接口实现（如 `FileTokenStore`） |
| `seedCookie` | — | 首次登录态（string 或对象） |
| `cookieProvider` | — | 兜底种子来源（Frida 客户端镜像） |
| `refresh.intervalMs` | 30d | 续期间隔 |
| `refresh.expiringThresholdMs` | 7d | 提前刷新窗口 |
| `refresh.onAuthErrorRefresh` | true | 鉴权失败自动刷新重试一次 |
| `refresh.maxAttempts` | 3 | 刷新重试次数（指数退避） |
| `http.timeoutMs` | 10000 | |
| `http.retries` | 2 | 网络/5xx 重试 |
| `includeRaw` | false | DTO 是否带原始对象 |
| `fetchImpl` / `now` / `logger` | — | 可注入（测试） |

---

## 边界（明确不做）

- 不做 HTTP 服务 / 路由（调用方负责）。
- 不做曲库存储、文件归档。
- 不做登录页 / 二维码 UI。
- 不做解密（TuneFree）/ 转码（ffmpeg）。
- 不做排曲与歌单生成逻辑。

## 实现说明

- **多租户**：SDK **无任何全局可变状态**。`createQQMusicClient({ cookie })` 每用户一个实例，可安全并发；`songs.detail / songs.url / auth.health / auth.refresh` 以及 search/playlist/user/mutation 全部按实例传入 cookie。
- `qq-music-api` **仅用于** `util/sign`（写操作 / 续期签名），不再持有任何会话。
- 自研部分：search（`search_for_qq_cp`）、歌曲详情（`get_song_detail_yqq`）、直链（`vkey.GetVkeyServer`）、歌单详情（`fcg_ucc_getcdinfo_byids_cp`）、写操作（`music.musicasset.*`）、扫码登录。
- 写操作（`create` / `addSongs` / `delete`）走现代**签名接口** `musicu.fcg`（`music.musicasset.PlaylistBaseWrite/AddPlaylist`、`PlaylistDetailWrite/AddSonglist`、`PlaylistBaseWrite/DelPlaylist`），已实测可用；`addSongs` 会先把 `mid` 解析成数字 `songId`。
- 歌单详情走旧 CGI `fcg_ucc_getcdinfo_byids_cp`（匿名 `privacy error`，登录后可用）。
