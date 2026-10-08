# 端到端验收报告

- 日期：2026-10-08
- 提交：`398ddb8`（`main`，已 push）
- 环境：Windows / Node ≥18；`ffmpeg`、`ffprobe` 在 PATH；QQ 音乐客户端 + `tools/qqclient-bridge` 运行中（`/health` → `hasCookie:true`）
- 服务：后端 `http://127.0.0.1:8790`；前端产物由后端托管

## 1. 构建与单测
| 项 | 命令 | 结果 |
|---|---|---|
| SDK 构建 | `packages/qqmusic-sdk` `npm run build` | ✅ |
| SDK 单测 | `npm test` | ✅ **12 / 12** |
| 后端构建 | `packages/dance-backend` `npx tsc -p tsconfig.json` | ✅ |
| 前端构建 | `packages/dance-frontend` `npm run build` | ✅（dist 已更新） |

## 2. 后端全量冒烟
| 套件 | 覆盖 | 结果 |
|---|---|---|
| `scripts/smoke-v6.js` | health / 曲库(含我喜欢合集) / 搜索 / 直链(本地+QQ) / stream / 歌词 / 设置 / 缓存用量 / scan / 编辑 / 排曲生成·保存·导出·导入·删除 / 歌单解析 / 校准 dryRun / 缓存并分类(实网) / 前端三路由 | ✅ **27 / 27** |
| `scripts/smoke-v7.js` | 来源列表(4) / schema v2 provenance·assets / 网易云搜索 / 网易云单曲导入+清理 / QQ 单曲导入+清理 / 本地文件夹导入+清理 / 直链导入+清理 / 直链播放 / 按来源批量缓存·清空 | ✅ **13 / 13** |

## 3. 实网联调
| 项 | 结果 |
|---|---|
| `/api/health` | ✅ `{ok, libraryTypes:9, sessions:1, setlists:4, mediaQuality:320}` |
| 客户端镜像 `/health` | ✅ `hasCookie:true`（pid 26888） |
| `/api/sources` | ✅ `qqmusic✓ netease✗(未配Cookie) local✓ http✓`（4 个来源） |
| 本地缓存命中播放 | ✅ `/api/song/stream` 命中本地 → 200 |
| QQ 直链 | ✅（缓存未命中时 302 到 QQ） |
| 网易云 | ✅ 搜索《晴天(深情版)》、单曲/歌单导入、播放直链、歌词；缓存已实测（`2652820720.mp3`） |
| 本地/社团文件夹 | ✅ 按 `舞种-歌名-歌手` 扫描入库（文件原位）、直接流播放 |
| 自建直链 | ✅ URL 列表入库、302 播放、下载转 mp3 |
| 缓存用量 | ✅ 326 MB / 38 文件 / 上限 20 GB |

## 4. 前端页面（DOM 实测，无 console 报错）
| 页面/元素 | 结果 |
|---|---|
| `/` 控制台 Tab | ✅ 曲库 / 搜索 / 导入来源 / 排曲 |
| 顶栏 | ✅ 明/暗主题切换（☾ 深色） |
| 曲库 | ✅ 舞种筛选 + **来源筛选**（全部/QQ/网易云/本地/直链）+ 来源 chip + **自制 chip** + 缓存/曲风/BPM/不适合标签 |
| 搜索页 | ✅ 来源切换（QQ/网易云）+ 结果「+ 加入曲库」 |
| 导入来源页 | ✅ QQ / 网易云 / 本地文件夹 / 直链 四种入口 |
| 编辑弹窗 | ✅ 歌名/歌手/舞种/适合当舞曲/归属(外部·自制)/是否编辑过 |
| 设置（管理员） | ✅ 口令/缓存目录/音质(HQ)/缓存上限/自动缓存/自动识别舞种/**网易云 Cookie**（已无「百度网盘」） |
| 排曲 | ✅ 生成/拖拽/保存/导出长图/导出导入传递文件 |
| `/play` | ✅ APlayer 渲染（封面/列表/歌词） |
| `/wall` | ✅ 标题/进度/「接下来」/4 控制/双图层背景，封面 Ken Burns + 光晕，切歌淡入淡出 |

## 5. 数据模型
- 存储 **schema v2**：`data/tracks.json` = `{schemaVersion:2, collections}`；首次启动自动从旧 `library.json` 迁移。
- 每首 Track：`provenance{rights,edited,origin}` + `assets[]` + `primaryAssetId`（与原扁平字段并存，兼容）。
- 「我喜欢」为稳定合集（`liked` 标记，跨舞种保留）。

## 6. 已知限制（非缺陷）
- **服务端 QQ 自续期不可用**（`10006`）：长期有效依赖客户端镜像或用户重扫码。
- **网易云**：部分歌需 `neteaseCookie`（`MUSIC_U`）才能出直链。
- **自动识别**：本质是「速度+曲风」推断，无法识别鼓点型；边界/散拍可能不准（可手动改舞种或标「不适合」）。
- **百度网盘**：不做（未接入）。

## 7. 结论
**通过。** 构建、单测、后端全量冒烟、实网联调、前端三路由与主要页面均正常；多来源导入（QQ/网易云/本地/直链）、播放即缓存（HQ→mp3、20GB LRU）、自动识别舞种、排曲与大屏、schema v2 归属模型均可用。
