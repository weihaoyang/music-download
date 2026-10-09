# 接入说明（部署 / 集成指南）

面向两类读者：**部署整套舞曲排曲台**，或**在别的项目里复用 SDK**。

---

## 一、系统组成与端口

| 组件 | 目录 | 默认端口 | 作用 |
|---|---|---|---|
| QQ 音乐数据 SDK | `packages/qqmusic-sdk` | — | 搜索/详情/直链/歌单/我喜欢/扫码登录 |
| 舞曲核心 SDK | `packages/dance-sdk` | — | **舞种识别** + **多来源导入/下载** + 缓存转 mp3 |
| 数据后端 | `packages/dance-backend` | **8790** | 曲库/导入/分类/缓存/排曲/任务；托管前端 |
| 前端 | `packages/dance-frontend` | 5173(dev) | 控制台 `/`、播放 `/play`、大屏 `/wall` |
| 客户端镜像 | `tools/qqclient-bridge` | **8899** | 从运行中的 QQ 音乐客户端取 live cookie（会员账号） |

---

## 二、环境依赖

- **Node ≥ 18**（后端/SDK/前端）
- **ffmpeg / ffprobe** 在 PATH（舞种识别、缓存转 mp3；可用 `MF_FFMPEG` / `MF_FFPROBE` 覆盖）
- **Python 3 + `frida`**（仅客户端镜像用：`pip install frida`）
- **QQ 音乐 PC 客户端**（登录**会员账号**，供补歌/下载/播放直链；可选但强烈推荐）

---

## 三、从零部署

```powershell
# 1) 构建（顺序：qqmusic-sdk → dance-sdk → backend → frontend）
cd packages\qqmusic-sdk  ; npm install ; npm run build
cd ..\dance-sdk          ; npm install ; npm run build
cd ..\dance-backend      ; npm install ; npm run build
cd ..\dance-frontend     ; npm install ; npm run build     # 产出 dist，由后端托管

# 2) 配置后端
cd ..\dance-backend
copy config.example.json config.json   # 若不存在则新建，见下

# 3) 启动后端 → http://127.0.0.1:8790
npm start

# 4)（可选，推荐）启动客户端镜像：先开着 QQ 音乐客户端
cd ..\..\tools\qqclient-bridge
python bridge.py            # 暴露 http://127.0.0.1:8899/cookie
```

`packages/dance-backend/config.json`：

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
  "downloadConcurrency": 3,
  "cacheLimitBytes": 21474836480,
  "autoClassify": true,
  "neteaseCookie": ""
}
```

> `adminToken` 用于「设置/导入/分类」等管理接口（前端右上角「设置」里填）；`neteaseCookie` 也可在设置里填。

---

## 四、账号模型（重点：**不是必须扫码**）

| 用途 | 用谁的登录态 | 需要扫码吗 |
|---|---|---|
| 曲库浏览 / 播放 / 缓存下载 / 歌单导入 / 单曲加入 | **客户端镜像的会员账号**（`bridgeUrl`） | ❌ 不需要 |
| 「我喜欢」导入 | 优先当前登录用户，否则客户端镜像账号 | ❌ 一般不需要 |
| **我的歌单 / 克隆到我的歌单** | **用户各自扫码**（`sid`） | ✅ 需要 |

**为什么客户端已经登录了，界面还提示扫码？**
- 客户端镜像（bridge）解决的是**曲库级**操作：它从运行中的 `QQMusic.exe` 读 live cookie，作为「会员账号」给全站补歌/下载/播放用——这部分**不用扫码**。
- 扫码是给**每个用户自己的账号**用的：把歌单写到**你自己**的 QQ（`我的歌单`、`克隆到我的歌单`、把「我喜欢」读到你名下）。服务器不能拿社团会员号冒充你，所以个人功能要各自登录（多租户，互不影响）。
- 若只是「曲库/下载/播放」却仍在提示扫码，通常是 **bridge 没连上**：确认 QQ 音乐客户端在运行、`python bridge.py` 已启动、`http://127.0.0.1:8899/health` 返回 `hasCookie:true`。

> 另：QQ 音乐网页态**无法服务端自续期**（`QQLogin` 恒返回 `10006`），所以「不过期」只能靠客户端镜像（只要客户端开着，bridge 定期重扫 key）或用户重新扫码。

---

## 五、多来源接入

> 搜索页默认 **「聚合搜索」**：并行查所有支持搜索的来源（QQ 音乐 + 网易云），结果交错合并、逐条标注来源；也可切单来源。

| 来源 | 界面入口 | 说明 |
|---|---|---|
| QQ 音乐 | 导入来源 → QQ音乐 | 歌单链接导入 / 单曲加入 / 克隆到我的歌单 |
| 网易云音乐 | 导入来源 → 网易云 / 搜索页切来源 | 歌单/单曲链接或 ID；部分歌需 `neteaseCookie`(`MUSIC_U`) |
| 本地/社团文件夹 | 导入来源 → 本地 | 文件名按 `舞种-歌名-歌手` 扫描入库，**文件保持原位** |
| 自建服务器直链 | 导入来源 → 直链 | `urls` 列表，或 `manifestUrl` **整库清单** |

### 自建服务器「整库清单」

服务器上放一个 JSON（可由脚本/网盘导出生成），舞曲台一次收编为完整曲库：

```json
{
  "base": "https://my-server/music/",
  "files": [
    { "name": "平四-暧昧-王菲.mp3", "url": "pop/amen.mp3" },
    { "name": "慢三-偏偏喜欢你-陈百强.mp3", "url": "https://cdn/xx.mp3" }
  ]
}
```

```http
POST /api/source/http/import   { "manifestUrl": "https://my-server/index.json" }
```

- `name` 按《HBDC 规则》命名即自动归舞种；`base` 可省略（相对 `url` 按清单所在目录解析）。
- 示例：`packages/dance-backend/public/manifest.example.json`。

---

## 六、在别的项目里复用 SDK

```bash
npm i @hdbc/qqmusic-sdk @hdbc/dance-sdk
```

```ts
import { analyze, createSourceRegistry, MediaCache } from '@hdbc/dance-sdk';
import { createQQMusicClient, HttpCookieProvider } from '@hdbc/qqmusic-sdk';

// 1) 舞种识别
const r = await analyze('/music/x.mp3');       // { bpm, type, suitable, ... }

// 2) 多来源导入
const qq = await createQQMusicClient({ cookieProvider: new HttpCookieProvider('http://127.0.0.1:8899/cookie') });
const sources = createSourceRegistry({ qqAnonymous: () => qq, qqLibrary: () => qq });
const { tracks } = await sources.get('http')!.build({ manifestUrl: 'https://my-server/index.json' });

// 3) 下载缓存（统一转 mp3）
const media = new MediaCache('/data/media', '320', 3, console);
await media.ensureFromUrl(tracks[0].url!, tracks[0].id);
```

详见 `packages/dance-sdk/README.md` 与 `packages/qqmusic-sdk/CONTRACT.md`。

---

## 七、常见问题

- **播放 401 / 导入失败**：客户端镜像掉线（或 cookie 过期）——重启 `bridge.py`，确认 QQ 客户端在运行。
- **网易云无直链 / 只下到 30 秒**：匿名时多数歌只返回**试听片段**，舞曲台会**自动拒绝**该片段（不缓存、不计入曲库），设置里填 `neteaseCookie`（`MUSIC_U=...`，最好是会员）即可下载完整音频。搜索/导入不受影响。
- **识别不准**：本质是「速度+曲风」推断，边界/散拍可能不准——编辑里手动改舞种，或标「不适合舞曲」。
- **缓存太大**：设置里调「缓存上限（GB）」，超限按最近播放 LRU 淘汰（只删缓存目录内文件，不删本地文件）。
- **换缓存目录**：设置里改 `mediaDir` 后，用 `POST /api/library/scan` 校正 `file` 标记。
