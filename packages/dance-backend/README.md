# dance-backend —— 排曲网站数据后端

把 `@hdbc/qqmusic-sdk` 与 `@hdbc/dance-sdk`（舞种识别 + 多来源导入 + 缓存）拼成一个可直接给排曲网站用的数据后端：

- **默认曲库缓存**（按舞种）→ 浏览/编排零外部依赖
- **搜索 / 详情 / 播放直链**（匿名 + 客户端镜像的会员账号）
- **每用户扫码登录**（QQ / 微信）+ cookie 存储
- **外部歌单导入 / 克隆**（分享链接解析）
- 多用户隔离（每用户一个 SDK 实例）

## 前置

1. `packages/qqmusic-sdk` 已构建：`cd ../qqmusic-sdk && npm install && npm run build`
2. `packages/dance-sdk` 已构建：`cd ../dance-sdk && npm install && npm run build`（舞种识别 + 多来源导入 + 缓存）
3. （推荐）`tools/qqclient-bridge` 正在运行：服务器用**会员账号**登录 QQ 客户端并跑 `python bridge.py`，
   提供**不会过期**的播放/导入凭证。

## 配置

复制 `config.example.json` → `config.json`：

```json
{
  "host": "127.0.0.1",
  "port": 8790,
  "dataDir": "data",
  "mediaDir": "data/media",
  "bridgeUrl": "http://127.0.0.1:8899/cookie",
  "adminToken": "change-me",
  "mediaQuality": "320",
  "autoDownload": true,
  "downloadConcurrency": 3
}
```

- `bridgeUrl`：客户端镜像地址（没有也能跑，但只有匿名能力：搜索/详情；播放/导入会失败）。
- `adminToken`：管理接口口令（`x-admin-token` 头）。
- `editorToken`（可选）：**编辑员**口令——可编辑曲库/导入/分类/排曲/点歌管理，但**不能**改设置（缓存目录/音质/Cookie）、不能「清空来源」等破坏性操作。

## 运行

```bash
npm install
npm run build
npm start        # http://127.0.0.1:8790
node scripts/smoke.js   # 冒烟
```

## API

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| GET | `/api/health` | 健康检查 | — |
| GET | `/api/library/types` | 曲库有哪些舞种 | — |
| GET | `/api/library/list?type=慢三` | 某舞种曲库（零 token） | — |
| POST | `/api/library/import` | 从外部歌单导入到某舞种 | admin |
| GET | `/api/search?keywords=&limit=` | 搜索歌曲（匿名） | — |
| GET | `/api/search/playlists?keywords=` | 搜索歌单（匿名） | — |
| GET | `/api/song/detail?mid=` | 歌曲详情（匿名） | — |
| GET | `/api/song/url?mid=&quality=` | 播放直链（优先用户登录态，否则客户端镜像） | 见说明 |
| POST | `/api/auth/qr/start` | 取登录二维码 `{type:'qq'|'wx'}` → `{token,image}` | — |
| GET | `/api/auth/qr/check?type=&token=` | 轮询登录状态；confirmed 时下发 `sid` cookie | — |
| GET | `/api/auth/me` | 当前登录用户 | — |
| POST | `/api/auth/logout` | 退出 | — |
| GET | `/api/user/playlists` | 我的歌单 | 用户 |
| POST | `/api/playlist/resolve` | 分享链接/ID → disstid | — |
| GET | `/api/playlist/import?url=&limit=` | 拉取外部歌单（归一化歌曲） | 客户端镜像 |
| POST | `/api/playlist/clone` | 克隆外部歌单到我的歌单 | 用户 |
| POST | `/api/library/download` | 补齐缺失音频 `{type?, source?}` → `taskId` | admin |
| POST | `/api/library/download-song` | 单曲下载到本地 `{mid}` → `taskId` | admin |
| POST | `/api/library/classify` | 自动识别舞种（只处理已缓存音频，跳过人工类型）→ `taskId` | admin |
| POST | `/api/library/cache-classify` | 批量「缓存 + 分类」：未缓存的先下载 HQ 再识别 → `taskId` | admin |
| PUT | `/api/library/song` | 改 `name/artists/album/type/suitable/warning/rights/edited` | admin |
| DELETE | `/api/library/song?mid=` | 从曲库移除（不删磁盘音频） | admin |
| POST | `/api/library/delete-by-source` | 清空某来源 `{source, purgeFiles?}`（本地文件不删） | admin |
| POST | `/api/library/calibrate` | 按文件名校准舞种（见下） | admin |
| POST | `/api/library/import-liked` | 导入「我喜欢」(dirid=201) 到某舞种（默认只导元数据，不下载） | admin |
| GET | `/api/sources` | 可用下载来源与登录状态（来自来源注册表） | — |
| GET | `/api/source/:id/search?keywords=&type=song\|playlist` | 来源搜索（如 `netease`） | — |
| POST | `/api/source/:id/import` | 来源通用导入（`qqmusic`/`netease`/`local`/`http`/`pan`），`{type,download?,...}` | admin |
| POST | `/api/library/scan` | 重新扫描缓存目录，校正 `file` 标记（换目录/手工删文件后） | admin |
| GET | `/api/tasks/:id` | 任务进度（下载/分类） | — |

## 账号模型

| 用途 | 用谁的 cookie |
|---|---|
| 搜索 / 详情 | 匿名（无需登录） |
| 播放直链 / 歌单导入 | **客户端镜像的会员账号**（`bridgeUrl`）→ 只要客户端开着就不过期 |
| 我的歌单 / 克隆到我的账号 | **用户各自扫码**（`sid` cookie → 每用户一个实例） |

## 默认曲库怎么建

```bash
curl -X POST http://127.0.0.1:8790/api/library/import \
  -H "Content-Type: application/json" -H "x-admin-token: change-me" \
  -d '{"url":"https://y.qq.com/n/ryqq/playlist/9756103868","type":"慢三","limit":1000}'
```

把外部歌单的歌曲元数据缓存进某舞种；前端 `GET /api/library/list?type=慢三` 直接用，**不碰 QQ**。

## 前端接入示例

```js
// 浏览默认曲库
const lib = await fetch('/api/library/list?type=' + encodeURIComponent('慢三')).then(r => r.json());

// 搜新歌
const res = await fetch('/api/search?keywords=' + encodeURIComponent('晴天')).then(r => r.json());

// 播放
const { data } = await fetch('/api/song/url?mid=' + mid).then(r => r.json());
audio.src = data.url;

// 登录（二维码）
const qr = await fetch('/api/auth/qr/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'qq' }) }).then(r => r.json());
img.src = qr.image;
const poll = setInterval(async () => {
  const st = await fetch(`/api/auth/qr/check?type=qq&token=${qr.token}`, { credentials: 'include' }).then(r => r.json());
  if (st.state === 'confirmed' || st.state === 'expired') clearInterval(poll);
}, 2000);
```

## 数据文件

- `data/tracks.json`：默认曲库（schema v2：`{schemaVersion:2, collections}`；每首含 `provenance`/`assets`；首次启动自动从旧 `library.json` 迁移）
- `data/media/`：**本地音频缓存**（`<songmid>.mp3` 等）
- `data/sessions.json`：用户登录态（含 cookie，注意权限，**勿入库/勿外泄**）

---

## 音频本地缓存（彻底不依赖 QQ 播放）

- `mediaQuality` 决定缓存音质（`320`=mp3 / `flac` / `128` …），`mediaDir` 是缓存目录。
- 导入歌单或首次播放曲库内歌曲时，后台按 `downloadConcurrency` 下载到 `data/media/`。
- `GET /api/song/url?mid=`：**命中本地缓存直接返回 `/media/<file>`**（`local:true`），否则回退 QQ 直链并顺手后台缓存。
- `GET /media/<file>`：支持 HTTP Range，浏览器可拖进度条。
- 手动批量：`POST /api/library/download` `{type?}`（admin）→ 补齐该舞种/全部缺失音频。
- **点击播放即缓存**：`/api/song/stream`（以及 `/api/song/url`）未命中缓存时，一边用 QQ 直链播放，一边后台下载到本地，下次即离线。
- **缓存上限（默认 20GiB）**：`cacheLimitBytes`（`config.json` / `PUT /api/settings` 可改，`0`=不限）；超限后按 **LRU**（`playedAt` 最近播放时间）淘汰最久未播放的，清到 90% 水位；**只删缓存目录内的文件，绝不动用户本地文件**。
- **统一转 MP3**：下载后用 `ffprobe` 探格式，非 mp3（flac/ape/m4a 等）用 `ffmpeg` 转成 mp3（**HQ/320 本身即 mp3**，无需解密）；缓存文件统一命名 `<mid>.mp3`。若遇加密文件（客户端 `.mflac/.mgg` 等）会告警并保留原文件。
- **「我喜欢」导入**：`POST /api/library/import-liked`（admin）走 `music.srfDissInfo.DissInfo/CgiGetDiss`（dirid=201），默认**只导元数据**（`download:false`），配合「点击播放即缓存」避免一次性下载整库。**优先用当前登录用户账号，其次客户端镜像**（bridge 不在线会 401）。
- **「我喜欢」是稳定合集**：导入时给歌曲打 `liked` 标记；`GET /api/library/list?liked=1` 返回合集（跨舞种、不因识别而移出）；`/api/library/types` 追加 `__liked__`。自动识别只改舞种标签，不移出合集。
- **批量「缓存 + 分类」**：`POST /api/library/cache-classify` `{type?, limit?}`（admin）——把某舞种（默认「未分类」）的曲子**逐首下载 HQ 并自动识别舞种**，未缓存的先下载、已缓存的直接分析，受缓存上限约束；返回 `taskId` 看进度。
- **缓存目录校正**：`POST /api/library/scan`（admin）把缓存目录里实际存在的文件重新挂回曲库、清掉缺失的 `file` 标记。

> 缓存完成后，浏览、播放、编排**全部走本地**，只在「搜新歌 / 补歌」时才用 QQ（且由客户端镜像的会员账号提供，不失效）。

## 前端页面（Semi Design 浅色 · Vite 打包）

- 独立工程 `packages/dance-frontend`（React + TS + Semi），`npm run build` 产出 `dist/`。
- 后端按 `webDir`（默认 `../dance-frontend/dist`）托管；访问 **http://127.0.0.1:8790/** 。
- **无 CDN 依赖**（React/Semi 全部打包进 `assets/`）；HTML 不缓存，指纹资源长缓存。
- 功能：曲库（已缓存标记 + 缓存进度条）/ 搜索 / 歌单导入（解析→预览→克隆）/ 排曲（权重生成+保存）/ 二维码登录 / 底部播放器 / 设置（管理端：自定义缓存目录）。

```bash
cd packages/dance-frontend && npm install && npm run build   # 产出 dist
# 改了前端后重新 build，后端会直接托管新产物（无需重启）
```

## 运行时设置（可自定义缓存位置）

管理端可改，落盘 `data/settings.json`，**保存即生效**：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/settings` | 读取当前设置（需 `x-admin-token`） |
| PUT | `/api/settings` | 修改 `{mediaDir, mediaQuality, autoDownload, downloadConcurrency, cacheLimitBytes}` |

前端右上角「设置」里填管理员口令 + 缓存目录即可。

## 默认曲库批量离线构建

```bash
cp library.config.example.json library.config.json   # 填 舞种 -> 歌单链接
npm run build-library                                 # 导入元数据 + 下载音频
node scripts/build-library.js --no-download           # 只导元数据
node scripts/build-library.js --type=慢三             # 只构建某舞种
```

`library.config.json` 形态：

```json
{ "types": { "慢三": ["https://y.qq.com/n/ryqq/playlist/xxxx"], "快三": ["..."] } }
```

---

## 元数据编辑 & 播放页

- `PUT /api/library/song` `{mid, name?, artists?, album?, type?}`（admin）：改歌名 / 歌手 / **舞种**；改舞种会**移动到对应曲库列表**。
- `GET /api/song/stream?mid=`：**302** 到本地缓存或 QQ 直链，供播放器 `<audio>` 直接用。
- 前端「播放」页基于开源 **[APlayer](https://github.com/DIYgod/APlayer)**（封面 / 曲名 / 进度 / 完整列表 / 歌词），曲库每行有「编辑」按钮改元数据。
- `GET /api/song/lyric?mid=`：返回 **text/plain LRC**（给 APlayer 用）；`?json=1` 返回 `{lyric, trans}`。
- **独立全屏播放路由 `/play`**：控制台点「播放 / 播放全部 / 已保存排曲→播放」会把队列写入 localStorage 并打开 `/play`；该页读取队列构建 APlayer。

---

## 自动舞种分类 + 排曲编辑

- **自动舞种分类**：`POST /api/library/classify`（admin）`{type?}`；核心算法在 **`@hdbc/dance-sdk`**（`analyze`/`classify`）：依据《HBDC 舞曲及排曲规则 20210508》表3：ffmpeg 解码 → 开源 **aubio**（WASM 版 `aubiojs`）测 BPM → 按文档换算的 BPM 区间映射到 **慢三 / 平四 / 伦巴 / 并四 / 快三 / 慢四 / 吉特巴**（华尔兹/探戈/狐步/快步先不做）。**曲风（能量）**（欢快/舒缓/干净利索）用于纠正 aubio 半速八度误差与边界破同分。逐首回写 `type / bpm / meter / confidence / energy / mood / stability / suitable / warning`；节奏不稳的标记 `suitable=false` + `warning`（前端显示「不适合舞曲」，可在编辑里手动改）。只处理可分类舞种，跳过「集体舞」等人工类型；返回 `taskId` 用 `/api/tasks/:id` 看进度。
- **按文件名校准**：`POST /api/library/calibrate`（admin）`{dir?, recursive?, addMissing?, dryRun?, entries?}`。解析《规则表1》命名 `舞种-歌曲名-歌手[-时长]`（支持全/半角连字符、下划线、多歌手），按归一化歌名+歌手匹配默认曲库并改舞种（`confidence=1`）；`addMissing` 时把未匹配的作为**本地文件**加入曲库（绝对路径，`/api/song/stream` 直接串流、支持 Range）。返回 `{scanned,audio,matched,updated,unchanged,added,unmatched,unparsed}`。
- **删除歌曲**：`DELETE /api/library/song?mid=`（admin）—— 只移除曲库记录，**不动磁盘音频文件**。
- **排曲编辑**：`POST /api/setlist` 接受 `{name, songs:[{mid, playMs?}], event:{name,time,location,host,note}}`；`playMs` 为**裁剪播放时长**（毫秒），`totalMs` 按裁剪后计算。
- **排曲传递文件**：`GET /api/setlist/:id/export` 下载 `hdbc-setlist` JSON（含 `event` 舞会信息 + 曲目）；`POST /api/setlist/import` 导入该文件生成新排曲，供互相传递。
- **导出长图**：前端「导出长图」用开源 **html2canvas** 把离屏海报渲染成 PNG（舞会名称/时间/地点/主办 + 完整曲目 + 总时长）。
- **自动排列规则（优先满足）**：`POST /api/setlist/generate` 支持 `order:[...]`；默认 `集体舞 慢四 吉特巴 慢三 平四 并四 伦巴 快三` —— **集体舞开场**，之后按该顺序**循环出歌**，避免快慢扎堆（`DEFAULT_DANCE_ORDER`）。前端可编辑「类型顺序」，一键「按舞种归组」也按此顺序。
- **统一播放**：`GET /api/song/stream?mid=` —— **本地命中就 302 到 `/media/<file>`，否则 302 到 QQ 直链**；播放器一条地址即可同时播本地 MP3 与 QQ 歌。
- **大屏模式**：前端路由 `/wall`（howler.js + anime.js，象牙白/香槟金），供舞会现场大屏投放；控制台「排曲」页「大屏播放」按钮进入。
