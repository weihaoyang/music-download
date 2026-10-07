# music-fetcher（补歌服务原型）

一个给排曲 / 点歌系统用的**本地补歌服务**：搜索 QQ 音乐 → 获取音频 → 规范化入库，
让「曲库里没有的歌」能一键补进本地曲库。

本项目是**原型 + 架构骨架**：核心流水线（搜索 / 触发 / 解密 / 监听 / 规范化 / 入库 / 任务回执）
都已跑通，并用 `mock` 模式做到**不装 QQ 音乐也能自测**。真正的下载触发引擎留了两种可插拔实现。

---

## 一、为什么是这么设计的

最初的思路是：**歌单自动下载 + TuneFree 解密**。
这条路的核心问题不在解密，而在 **Trigger（谁去触发客户端下载）**：

- TuneFree（你发的那个仓库）只做**解密**：用 Frida 注入运行中的 `QQMusic.exe`，把本地
  `.mflac / .mgg` 解成 MP3/FLAC。它不搜索、也不下载。
- QQ 音乐「自动下载新增歌曲」官方确实存在，官方原话：
  *「不同终端下添加歌曲到已开启此开关的歌单，歌曲将自动下载。」*
  但该说明挂在**移动端**，**PC 客户端是否有这个开关尚未验证**。
- 而 TuneFree 需要加密文件落在 **PC** 上，所以下载必须发生在 PC 客户端。

**所以本项目的做法是：把「获取音频」和「入库」解耦，引擎可插拔。**
无论那个 PC 开关存不存在，项目都不会白做。

| 引擎 | 怎么工作 | 优点 | 缺点 |
|---|---|---|---|
| `web`（默认） | 本地 `QQMusicApi` 服务带你的会员 cookie，`/song/url` 拿**直链**直接下载（拿到就是可播放音频，**不需要 TuneFree**） | 今天就能跑通，不依赖客户端 | cookie 会过期，需要偶尔扫码刷新 |
| `client` | 把歌加进「补歌队列」歌单 → PC 客户端自动下载 `.mflac` → 本项目监听到文件后调 TuneFree 解密入库 | 复用你已验证的 TuneFree，客户端会话极稳 | 依赖 PC「自动下载新增歌曲」开关；需先实测 |

> 更成熟的长期方案排序：
> 1. **引擎 `web` + 可刷新的 cookie**：最省事、最稳，是推荐主链路。
> 2. **引擎 `client`（你思路的产品化）**：验证 PC 开关后作为「零 token 依赖」的第二引擎。
> 3. 直接 hook 客户端内部下载函数（Frida RPC）：体验最好但最不成熟、最易随版本失效，**不建议作为唯一方案**。
>
> 本项目把 1 和 2 都留好了口子。

---

## 二、流水线

```
排曲页面 / 任意调用方
      │  GET /search?q=...
      │  POST /fetch { mid, mediaId, title, artist, engine? }
      ▼
  补歌服务 (Node, 无三方依赖)
      │
      ├── engine=web ──► QQMusicApi(/song/url) ──► 直链下载 ─────────────┐
      │                                                                  │
      └── engine=client ─► QQMusicApi(/songlist/add) ─► 客户端自动下载    │
                                                         │                │
                                             .mflac/.mgg 落入下载目录      │
                                                         ▼                │
                                          Watcher 轮询监听（等文件大小稳定）│
                                                         ▼                │
                                          TuneFree CLI 解密 ──► MP3 ──────┤
                                                                          ▼
                                     规范化命名 + 防覆盖 + 移入曲库目录
                                                                          ▼
                                                  Job 状态回执（/jobs/:id）
```

任务状态机：`queued → queueing/downloading → converting → importing → imported | failed`。

---

## 三、快速开始

要求：Node ≥ 18（本机是 v24，无需 `npm install`，零依赖）。

```powershell
cd D:\music-download

# 1) 离线自测整条流水线（不需要 QQ 音乐 / 网络）
node scripts/selftest.js

# 2) 启动服务（默认 mock 转换，不会真的调用 TuneFree）
node src/index.js
# 打开 http://127.0.0.1:8787 使用内置补歌控制台
```

CLI：

```powershell
node bin/cli.js search 晴天
node bin/cli.js fetch 晴天 --type 320
node bin/cli.js fetch 0039MnYb0qxYhV --mid --engine client
node bin/cli.js convert "C:\path\to\xxx.mflac"     # 手动解密并入库
node bin/cli.js watch                              # 只跑目录监听
node bin/cli.js jobs
```

配置：复制 `config.example.json` 为 `config.json` 后修改（`config.json` 已被 gitignore）。
关键项：

- `paths.downloadDir`：QQ 音乐 PC 客户端的**下载/缓存目录**。
- `paths.libraryDir`：你的本地曲库目录。
- `paths.tuneFreeExe`：TuneFree 的 `main.exe`（命令行版）；留空则用 mock。
- `paths.musicApiBase`：本地 QQMusicApi 服务地址（默认 `http://127.0.0.1:3300`）。
- `engine.default`：`web` 或 `client`。
- `engine.playlistDirId`：`client` 引擎用的「补歌队列」歌单 dirid。
- `converter.mock`：`true` 时不调用 TuneFree，直接把加密文件当 mp3 拷出来（自测用）。
- `import.naming`：`keep`（保留原文件名）或 `artist-title`（重命名成「歌手 - 歌名」）。

---

## 四、两种引擎的落地配置

### 引擎 `web`（推荐先跑通）

1. 起一个本地 QQMusicApi（成熟组件，负责签名/cookie）：
   ```powershell
   git clone https://github.com/jsososo/QQMusicApi.git
   cd QQMusicApi && npm install && npm start     # 默认 http://127.0.0.1:3300
   ```
2. 用你的会员账号登录，让它拿到 cookie（详见该仓库文档；也可用其它仍维护的 fork，
   如 `@sansenjian/qq-music-api`）。
3. 本项目 `config.json` 里 `engine.default="web"`、`musicApiBase` 指向它即可。

> 直链接口：`GET /song/url?id=<songmid>&mediaId=<media_mid>&type=320|flac`。
> **付费歌曲的 `media_mid` 与 `songmid` 不同**，本项目会在缺失时自动用 `/song?songmid=` 补齐。

### 引擎 `client`（你的思路）

1. PC 客户端建一个歌单，例如「补歌队列」，**开启「自动下载新增歌曲」**（先确认 PC 版有没有此开关）。
2. 把该歌单的 `dirid` 填到 `engine.playlistDirId`，`engine.default="client"`。
3. 启动 QQ 音乐 PC 客户端并保持运行；TuneFree 别填 mock。
4. `POST /fetch` 后：服务把歌加进歌单 → 客户端自动下载 `.mflac` 到 `downloadDir` →
   Watcher 发现 → 调 TuneFree 解密 → 入库。
5. 每首入库后源加密文件会被删除（`converter.keepSource=true` 时移到 `.work/done/`）。

---

## 五、给你的排曲系统接入

服务只暴露几个简单接口（`config.server.token` 非空时需带 `x-token` 或 `?token=`）：

```
GET  /health                        → 服务状态
GET  /search?q=关键词&limit=10       → [{ mid, mediaId, title, artist, album, interval, pay }]
POST /fetch  { mid, mediaId?, title?, artist?, type?, engine? }   → { id, status, ... }
GET  /jobs/:id                      → 轮询任务进度
GET  /jobs                          → 最近任务
```

排曲页面的典型交互：搜索 → 展示候选（含是否付费）→ 用户确认「补这首歌」→ 轮询 `/jobs/:id`
直到 `imported` → 刷新曲库。

> 建议：搜索匹配可能出现同名/翻唱，**让用户在候选里点确认**，不要全自动取第一条。
> 去重键建议用 QQ 音乐 `mid`，入库命名与你现有几千首曲库保持一致。

---

## 六、先做这一步验证（决定用哪个引擎）

在本项目 `mock=true` 下先跑通流水线（已通过 `scripts/selftest.js`）。
真实环境按顺序验证：

1. **PC 自动下载是否可用**：PC 客户端 → 某歌单 → 找「自动下载新增歌曲」；
   用任意方式把一首歌加进该歌单，看下载目录是否出现 `.mflac`。
   - 有 → `client` 引擎可用。
   - 没有 → 直接用 `web` 引擎。
2. **TuneFree 可用**：把 `tuneFreeExe` 指向 `main.exe`，`mock=false`，
   手动丢一个 `.mflac` 进 `downloadDir`，看是否自动转出 MP3。

---

## 七、注意与已知限制

- **权限/杀软**：TuneFree 用 Frida 注入，需足够权限，杀软会误报，记得加白。
- **格式变化**：QQ 音乐若更新加密算法，TuneFree 需更新（本项目会报「未找到 MP3 输出」）。
- **半截文件**：Watcher 用「文件大小连续 N 轮不变」判断下载完成（`watcher.stableRounds`）。
- **TuneFree 逐首调用**：原型为每首单独调一次（都要注入一次）。量大时建议改成批量传入。
- **任务与文件匹配**：`client` 引擎目前靠「歌名」把任务和下载文件关联，可能不准；
  更稳的做法是读客户端下载库或从 TuneFree 输出名反查。
- **转码**：`web` 引擎若拿到 `.flac/.ape`，当前直接入库（未转 MP3）。需要统一成 MP3 时，
  用 `ffmpeg` 转码，本项目已预留 `paths.ffmpeg`。
- **合规**：仅供个人会员范围内的合法使用，请勿传播。

---

## 八、目录结构

```
config.example.json     配置样例
src/
  config.js             配置加载 + 默认值 + 环境变量覆盖
  log.js                日志
  qqmusic.js            搜索 / 直链 / 加歌单 / 下载
  converter.js          调 TuneFree（或 mock）解密
  importer.js           规范化命名 + 防覆盖 + 入库
  jobs.js               任务存储（内存 + .work/jobs.json）
  watcher.js            轮询监听下载目录 → 解密 → 入库
  fetcher.js            引擎编排
  server.js             HTTP API + 内置补歌控制台
  index.js              入口
bin/cli.js              命令行
scripts/
  selftest.js           离线自测
  smoke.js              HTTP 冒烟测试
  make-mock-mflac.js    造一个假加密文件用于测试
```

---

## 九、许可协议

本项目以 **GNU General Public License v3.0（或更新版本）** 开源发布，
版权归 **weihaoyang** 所有。完整条款见根目录 [LICENSE](LICENSE)。

```
music-fetcher — 本地补歌服务（搜索 QQ 音乐 → 下载 → 解密 → 规范化入库）
Copyright (C) 2026  weihaoyang

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```

> 注意：GPLv3 是强 copyleft 许可。若你分发本项目的修改版，必须同样以 GPLv3（或更新版本）
> 开放全部对应源码。本项目仅用于个人会员范围内的合法使用，请遵守相关服务条款，勿传播下载内容。
