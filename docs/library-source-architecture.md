# 曲库「来源 / 自有版本 / 多下载来源」架构设计（草案）

> 目标：让曲库成为**社团自己拥有和管理的曲库**，而不是「一批 QQ 音乐的元数据」。
> 需要：① 明确每首歌的**来源与版权归属**；② 支持**多个下载来源**；③ 处理**剪辑/编辑过的版本**（谁拥有、怎么标来源）。

---

## 1. 现状与问题

现在的一等公民是 **QQ 音乐的歌**：

- 曲目以 QQ `mid` 为身份（`library.json` 里 `LibrarySong.mid`）；播放靠 `mid → /api/song/stream → QQ 直链/本地缓存`。
- 没有「来源」概念（隐含就是 QQ 音乐）。
- 剪辑版只是排曲时的一个 `playMs` 裁剪参数，**不是真实的资产**；而现实是社团手里有大量**已剪辑好的文件**（文件名规范：`舞种-歌名-歌手（剪辑版）`）。
- 一个曲目只能有**一个**音频（`file` 字段），无法表达「QQ 原版 + 社团剪辑版」并存。
- 无法表达**版权归属**（外部引进 vs 社团自制），也无法扩展**别处下载**。

**核心矛盾**：身份绑定 QQ `mid`，但社团要的是「自己的曲目 + 自己的音频资产」。

---

## 2. 设计目标

1. **曲目与音频资产解耦**：曲目是「我们库里的这一首」，资产是「实际可播放的文件/链接」，一首可有多个。
2. **来源可追溯**：每个资产记录**来源**（QQ/网易云/本地/直链）与**派生关系**（剪辑自哪版）。
3. **归属清晰**：曲目记录**版权归属**（`external` 外部引进 / `club` 社团自制）与**是否编辑过**。
4. **来源可扩展**：新增下载来源 = 实现一个适配器，不改核心。
5. **向后兼容**：现有 mid-keyed 曲库平滑迁移，播放/排曲零中断。

---

## 3. 数据模型

把现在的 `LibrarySong` 拆成 **Track（曲目）+ Asset（资产）+ Provenance（来源）**：

```ts
interface Track {
  id: string;                 // 稳定本地 id：'qq:<mid>' | 'local:<hash>' | 'trk:<uuid>'
  name: string;
  artists: string[];
  album?: string | null;
  type: string;               // 舞种（标签，可改）
  tags?: {                    // 自动识别/人工
    bpm?: number; meter?: string; confidence?: number;
    energy?: number; mood?: string; stability?: number;
    suitable?: boolean; warning?: string; liked?: boolean;
  };
  provenance: {
    rights: 'external' | 'club';   // 版权归属：外部引进 / 社团自制（“自己”）
    edited: boolean;                // 是否经过剪辑/编辑
    origin: OriginRef | null;       // 最初来源（永久保留，用于溯源）
    note?: string;                  // 如「4′20″剪辑版」「32步」
  };
  assets: Asset[];             // ≥1；按优先级排序
  primaryAssetId: string;      // 默认播放/缓存的资产
}

type OriginRef =
  | { source: 'qqmusic'; mid: string; mediaMid?: string }
  | { source: 'local'; path: string }
  | { source: 'http'; url: string };

interface Asset {
  id: string;
  trackId: string;
  kind: 'original' | 'edited';    // 原版 / 剪辑版
  source: 'qqmusic' | 'netease' | 'local' | 'http';
  ref: { mid?: string; path?: string; url?: string };  // 取流/下载依据
  file?: string | null;           // 本地化后的文件（相对 mediaDir 或绝对路径）
  sizeBytes?: number | null;
  sha256?: string | null;         // 去重/校验
  codec?: string | null;
  durationMs?: number | null;
  derivedFromAssetId?: string | null; // 剪辑自哪个资产
  createdAt: number;
}
```

要点：
- **一首歌 = 一个 Track，多个 Asset**（QQ 原版 + 社团剪辑版 + 本地缓存）。
- **`provenance.origin` 永久保留**，剪辑不会抹掉它。
- **`rights`/`edited` 是「归属」**，与「来源」分开：来源=从哪来，归属=是谁的。

---

## 4. 来源适配器（“再添加一个下载来源”）

核心不认 QQ，只认 `TrackSource` 接口；QQ 只是其中一个实现：

```ts
interface TrackSource {
  id: string;                       // 'qqmusic' | 'netease' | 'local' | 'http'
  label: string;                    // 展示名
  capabilities: { search?: boolean; collection?: boolean; stream?: boolean; download?: boolean };
  resolve?(input: string): Promise<OriginRef[]>;        // 链接/ID/路径 → 引用
  listCollection?(ref: OriginRef): Promise<TrackMeta[]>; // 歌单/本地文件夹
  search?(kw: string): Promise<TrackMeta[]>;
  stream?(asset: Asset, session?): Promise<{ url: string; expiresAt: number | null }>;
  download?(asset: Asset, destPath: string): Promise<{ codec?: string; sizeBytes?: number }>;
}
```

内置实现：
- **`qqmusic`**：现有 SDK（搜索/歌单/直链/下载）。
- **`local`**：扫描本地/社团文件夹（复用现有 `localscan.ts`）；文件即资产，`source=local`、`rights=club`。
- **`http`**：直链下载（自建服务器 / 对象存储 / 其他站点直链）。
- **百度网盘：不做**（未接入）。

新增来源 = 新增一个适配器 + 注册，核心、播放、缓存、分类都不用改。

---

## 5. 「编辑过就来源改成自己」——推荐怎么做

**不要把原本的 `source` 直接改成 self**（会丢溯源、无法回滚、无法区分“社团自制”和“随手裁了 5 秒”）。推荐**两层记录**：

- `provenance.origin` **永久保留**最初来源（QQ mid / 原始 URL / 本地路径）。
- 一旦产生编辑版：
  - 新增 `Asset{ kind:'edited', source:'local', derivedFromAssetId:<原资产> }`；
  - 设 `provenance.edited = true`；
  - 设 `provenance.rights = 'club'`（这首曲目**对外发行的版本归社团**）；
  - `primaryAssetId` 指向剪辑版 → 播放/导出/排曲默认用社团版本。

**触发时机**（三选一/可组合）：
1. **手动**：导入/上传剪辑版时勾选「这是社团自制版本」。
2. **按文件名**：符合规范 `舞种-歌名-歌手（剪辑版）/（剪辑版）/（XX步…）` → 自动 `kind=edited`、`rights=club`。
3. **按一致性**：本地文件时长/大小与 QQ 原版明显不同 → 提示「疑似剪辑版，是否标为自制」。

展示上：曲目行加一个**来源 chip** `QQ音乐 / 自制 / 本地 / 直链`；编辑弹窗可手动在 **外部引进 ↔ 社团自制** 之间切换（人始终可覆盖）。

---

## 6. 播放 / 缓存路由

```
GET /api/track/:id/stream
  1) primaryAsset 有本地 file → 直接流（支持 Range）
  2) 否则走对应 TrackSource.stream() 取直链 → 302（并后台缓存为该 asset.file）
  3) 都不可用 → 404/QQ_UNSUPPORTED
```

- 缓存仍然统一转 mp3、受 20GB 上限约束；但**归属到 Asset**（`asset.file/sizeBytes`），而不是曲目单字段。
- 兼容旧接口：`/api/song/stream?mid=` 内部映射到 `track(id='qq:'+mid)`，前端可渐进迁移。

---

## 7. API 变化

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sources` | 列出可用来源与能力 |
| POST | `/api/source/:source/import` | 按来源导入（qqmusic 歌单 / local 目录 / http 链接） |
| GET | `/api/library/list?...` | 返回 Track（含 `provenance` 与 `assets` 概要） |
| POST | `/api/track/:id/assets` | 添加/关联资产（上传剪辑版 / 引用本地 / 引用直链） |
| PUT | `/api/track/:id` | 改舞种 / 归属(`rights`) / `edited` / 是否适合 / `liked` |
| DELETE | `/api/track/:id` | 移除曲目（可选是否连带删缓存文件） |
| GET | `/api/track/:id/stream` | 播放（优先自制版） |

---

## 8. 迁移方案

- 存储拆/升级：`data/library.json` → 曲库（当前为 `data/tracks.sqlite`，Node 内置 `node:sqlite` 原子事务；无 `node:sqlite` 时回退 `data/tracks.json`，带 `schemaVersion:2`）；启动时若发现旧结构则**自动迁移**：
  - `id = 'qq:' + mid`；`provenance.origin = {source:'qqmusic', mid}`；`rights:'external'`（若 `type`/文件名像剪辑版则 `club`）。
  - `file → assets[0] = {kind:'original', source:'qqmusic', file, sizeBytes}`；`primaryAssetId` 指向它。
  - 原有 `bpm/mood/stability/suitable/warning/liked/playedAt` → `tags` / asset。
- **保留 `mid` 兼容字段**一段时间（`legacyMid`），前端/旧脚本不受影响。
- `data/media/<mid>.mp3` 不动；资产 `file` 仍指向它。

---

## 9. 分阶段实施

- **P1（小改动，先落地价值）**：给 `LibrarySong` 加 `source`/`origin`/`edited`/`rights` 字段（轻量，不拆表）；前端显示来源 chip、可标「自制」；导入时可指定来源。**先解决“标来源 + 自制”**。
- **P2（插件化）**：引入 `TrackSource` + `/api/sources` + `/api/source/:source/import`；实现 **local**（已具备扫描能力）与 **http** 两个新来源。
- **P3（资产化）**：升级为 `Track + Asset[]`，支持「原版 + 剪辑版」并存、派生关系、播放优先自制版；提供迁移脚本。
- **P4（剪辑流水）**：上传/生成剪辑版（配合 ffmpeg 裁剪），自动 `derivedFrom` + `rights=club`。

---

## 10. 待决问题

1. **（已定）新增的下载来源**：网易云音乐 + 本地/社团文件夹 + 自建服务器直链；**百度网盘不做**。
2. 剪辑版是**替换**原曲目的默认播放，还是作为**同一曲目的另一个版本**在 UI 上可选？（推荐后者。）
3. 是否需要**导出“自有曲库清单”**（含来源/归属），作为社团资产台账？
4. 归属切换是否需要**权限/审批**（谁能标「自制」）？

---

## 11. 决策与实施状态（2026-10）

**已拍板**
- **来源**：`qqmusic`（已有）+ `netease`（网易云，已实现）+ `local`（本地/社团文件夹，已实现）+ `http`（自建服务器直链，已实现）。**百度网盘不做**。
- **剪辑版不做「多版本可选」**：编辑过的文件就是该曲目的**默认（唯一）播放资产**，不再提供「原版/剪辑版」切换；`provenance.origin` 仍作为**元数据**保留用于溯源。
- **不做**「自有曲库清单/资产台账」导出。
- **标「自制」不需要权限/审批**：任何人可直接改归属。

**实施状态**
| 来源 | 端点 | 搜索 | 导入 | 播放/缓存 | 状态 |
|---|---|---|---|---|---|
| QQ音乐 | 既有 | ✅ | ✅ 歌单/我喜欢 | ✅ | 已实测 |
| 网易云 | `POST /api/source/netease/import`、`GET /api/search/netease` | ✅ | ✅ 歌单/单曲 | ✅（部分歌需 Cookie） | **已实测**（匿名可播放部分歌；`neteaseCookie` 提升成功率） |
| 本地/社团文件夹 | `POST /api/source/local/import` | — | ✅ 扫描入库（文件原位） | ✅ 绝对路径直接流 | **已实测** |
| 自建直链 | `POST /api/source/http/import` | — | ✅ URL 列表 | ✅ 302 + 下载转 mp3 | **已实测** |
| 来源列表 | `GET /api/sources` | — | — | — | 已实测 |

**登录/Cookie（`PUT /api/settings`）**：`neteaseCookie`（MUSIC_U）、`baiduCookie`（BDUSS;STOKEN）。

**来源注册表（已实现）**：`packages/dance-backend/src/sources/registry.ts` 定义统一 `SourceDef`（`id/label/kind/authed/search/build/streamUrl`）；`GET /api/sources` 由注册表驱动；导入/搜索走通用路由 **`POST /api/source/:id/import`** 与 **`GET /api/source/:id/search`**；播放直链走各来源的 `streamUrl`（QQ/本地由后端其它逻辑处理）。新增来源 = 在注册表加一个 `SourceDef`，核心无需改动。

**前端（已做）**：搜索页可切 QQ/网易云并一键「+ 加入曲库」；「导入来源」页含 QQ/网易云/本地文件夹/直链 四种入口；曲目行显示**来源 chip**；设置里可填 `neteaseCookie`。

**模型（已升级 schema v2）**：曲库存储由 `data/library.json` 迁移为 SQLite（**`data/tracks.sqlite`**，Node 内置 `node:sqlite`，原子事务写；无 `node:sqlite` 时回退 `data/tracks.json` 的 `{schemaVersion:2, collections}`）；每首 Track 含 `provenance`（`rights: external|club`、`edited`、`origin` 溯源）与 `assets[]` + `primaryAssetId`，并与原扁平字段并存以兼容。归属/是否编辑过可在编辑弹窗修改。

**已收编**：`/api/library/import` 老接口已统一到来源注册表（内部走 `qqmusic` 来源 `build` + 共享 `importBuiltTracks()`），与通用 `/api/source/qqmusic/import` 单一实现。
