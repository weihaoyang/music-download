# 舞曲排曲台（HBDC 交谊舞曲库与排曲系统）

面向国标交谊舞社团的**曲库 + 排曲 + 播放 + 大屏**系统：多来源导入舞曲、自动识别舞种、按规则排曲、
舞会大屏投放、离线缓存播放。

技术形态是一个 monorepo：**数据 SDK + 后端 + 前端**，前端为可部署的静态产物，无 CDN 依赖。

---

## 一、组成

| 目录 | 说明 | 文档 |
|---|---|---|
| `packages/qqmusic-sdk` | QQ 音乐数据 SDK（搜索/详情/直链/歌单/我喜欢/扫码登录/续期），TypeScript | [README](packages/qqmusic-sdk/README.md) · [CONTRACT](packages/qqmusic-sdk/CONTRACT.md) |
| `packages/dance-sdk` | 舞曲工作台核心 SDK：**舞种自动识别** + **多来源导入/下载**（QQ/网易云/本地/直链·整库清单）+ 本地缓存转 mp3 | [README](packages/dance-sdk/README.md) |
| `packages/dance-backend` | Node/TS 数据后端（曲库、导入、分类、缓存、排曲、任务） | [README](packages/dance-backend/README.md) |
| `packages/dance-frontend` | Vite + React + Semi 前端（控制台 `/`、播放 `/play`、大屏 `/wall`） | [README](packages/dance-frontend/README.md) |
| `tools/qqclient-bridge` | Frida 客户端镜像：从运行中的 QQ 音乐客户端取 live cookie（会员账号、不过期） | [README](tools/qqclient-bridge/README.md) |

架构与全量进度见 **[docs/qqmusic-sdk-plan.md](docs/qqmusic-sdk-plan.md)**，
**部署/接入指南见 [docs/integration.md](docs/integration.md)**，
「来源 / 自制版本 / 多下载来源」设计见 **[docs/library-source-architecture.md](docs/library-source-architecture.md)**，
端到端验收清单见 **[docs/acceptance.md](docs/acceptance.md)**。

---

## 二、功能

- **曲库**：按舞种浏览；支持**来源筛选**（QQ音乐 / 网易云 / 本地 / 直链）；
  「我喜欢」稳定合集（跨舞种、识别后不移出）；每首显示 **舞种 / 曲风 / BPM / 稳定性 / 来源 / 缓存状态**。
- **多来源导入**：
  - **QQ音乐**：歌单导入 / 单曲加入 / 克隆到我的歌单；
  - **网易云音乐**：搜索、歌单/单曲链接或 ID 导入（免加密端点；部分歌需 `neteaseCookie`）；
  - **本地/社团文件夹**：按《HBDC 规则》文件名 `舞种-歌名-歌手` 扫描入库（文件原位）；
  - **自建服务器直链**：URL 列表导入。
- **自动识别舞种**：ffmpeg 解码 + aubio 测速 → 按《HBDC 规则 表3》BPM 区间映射到
  **慢三/平四/伦巴/并四/快三/慢四/吉特巴**；曲风（欢快/舒缓）用于八度纠错与边界判定；
  另判「是否适合作为舞曲」。见 plans §28/§35。
- **缓存策略**：点击播放即缓存（HQ 320k，统一转 mp3），**20GB 上限 + LRU 淘汰**，
  也可对某舞种批量「缓存并分类」。
- **排曲**：目标时长 + 各舞种权重生成；**拖拽排序 / 一键乱序 / 按舞种归组 / 单曲裁剪**；
  保存、导出长图（html2canvas）、导出/导入传递文件。
- **播放与大屏**：`/play`（APlayer，含歌词）、`/wall`（howler + anime：封面交叉溶解、Ken Burns、金色光晕、音频淡入淡出切歌）。
- **明/暗主题**、**管理员设置**（缓存目录/上限/音质、Cookie、按文件名校准）。

---

## 三、快速开始

要求：Node ≥ 18；系统 `ffmpeg`/`ffprobe` 在 PATH（分类与转码用）。

```powershell
# 1) SDK
cd packages\qqmusic-sdk
npm install
npm run build

# 2) 后端（默认 http://127.0.0.1:8790）
cd ..\dance-backend
npm install
npm run build
npm start

# 3) 前端（构建产物由后端托管，浏览器访问 http://127.0.0.1:8790/）
cd ..\dance-frontend
npm install
npm run build
```

**客户端镜像（推荐，用于补歌/下载的会员账号，不过期）**：
保持 QQ 音乐客户端登录并运行，然后：

```powershell
cd tools\qqclient-bridge
python bridge.py     # 暴露 http://127.0.0.1:8899/cookie
```

**配置**（`packages/dance-backend/config.json`，已被 gitignore）：

```json
{
  "port": 8790,
  "mediaDir": "data/media",
  "bridgeUrl": "http://127.0.0.1:8899/cookie",
  "adminToken": "change-me",
  "mediaQuality": "320",
  "autoDownload": true,
  "cacheLimitBytes": 21474836480
}
```

- `neteaseCookie`（`MUSIC_U=...`）可在前端「设置（管理员）」里填，或写进 config.json。

---

## 四、常用脚本

```powershell
cd packages\dance-backend
node scripts\smoke-v6.js      # 全量冒烟（曲库/搜索/播放/排曲/缓存并分类/前端路由）
node scripts\smoke-v7.js      # 多来源冒烟（来源列表/网易云/QQ单曲/本地/直链）
node scripts\build-library.js # 按 library.config.json 批量离线构建
cd ..\qqmusic-sdk && npm test # SDK 契约单测
```

---

## 五、目录结构

```
packages/
  qqmusic-sdk/        数据 SDK（TypeScript，dist + .d.ts）
  dance-backend/      Node 后端（src/、scripts/、data/ 为运行时数据，已 gitignore）
  dance-frontend/     Vite 前端（src/、dist/）
tools/
  qqclient-bridge/    Frida 客户端镜像（Python）
docs/
  qqmusic-sdk-plan.md            规划 + 全量进度（§0–§35）
  library-source-architecture.md 来源/自制/多来源架构设计
src/                  【旧原型】早期 music-fetcher（Node 零依赖），保留作参考，已被 packages/ 取代
```

---

## 六、注意

- **合规**：仅供社团在会员/授权范围内的合法使用，请勿传播下载内容。
- **TuneFree/解密**：本项目走各平台 API 直链，**HQ 即标准 mp3、无需解密**；客户端加密文件（`.mflac/.mgg` 等）
  才需要 Unlock Music 之类的工具。
- **续期限制**：`QQLogin` 对浏览器/扫码 cookie 均返回 `10006`，服务端无法自续；
  长期有效依赖**客户端镜像**或用户重新扫码。

---

## 七、许可协议

本项目以 **GNU General Public License v3.0（或更新版本）** 开源发布，版权归 **weihaoyang** 所有。
完整条款见根目录 [LICENSE](LICENSE)。

```
hdbc-dance — 舞曲排曲台（多来源曲库 / 自动识别舞种 / 排曲 / 大屏）
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

> GPLv3 是强 copyleft 许可：分发本项目的修改版必须同样以 GPLv3（或更新版本）开放全部对应源码。
