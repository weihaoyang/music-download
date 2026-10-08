# @hdbc/dance-sdk

舞曲工作台核心 SDK：把「**舞曲分类能力**」和「**从多元来源下载/导入的能力**」做成标准可复用包。

- **舞种自动识别**：`analyze` / `classify`（ffmpeg 解码 + aubio 测速 + 曲风/稳定性；依据《HBDC 规则 表3》）
- **多来源导入**：`createSourceRegistry` —— QQ音乐 / 网易云 / 本地·社团文件夹 / 自建直链（含**整库清单**）
- **本地缓存**：`MediaCache` —— 统一下载并转 mp3（HQ/320 直接是 mp3；flac/ape/m4a 用 ffmpeg 转码）

> License: GPL-3.0-or-later。依赖系统 `ffmpeg`/`ffprobe`（PATH，可用 `MF_FFMPEG`/`MF_FFPROBE` 覆盖）与 `@hdbc/qqmusic-sdk`。

---

## 安装与构建

```bash
cd packages/dance-sdk
npm install
npm run build      # 产出 dist/ + .d.ts
```

依赖方（如 `@hdbc/dance-backend`）用 `file:../dance-sdk` 链接。

---

## 1. 舞种识别

```ts
import { analyze, classify, DANCE_TYPES } from '@hdbc/dance-sdk';

const r = await analyze('/path/to/song.mp3');
// { bpm, meter, type: '平四', confidence, energy, mood, stability, prominence, onsetRate, onsetStrength, suitable, warning }

// 也可只按 BPM+拍号+曲风归类
classify(134, '4/4', '欢快'); // -> { type: '平四', confidence: 0.83 }
```

- 只保留 7 个舞种：慢三/平四/伦巴/并四/快三/慢四/吉特巴（区间见 `DANCE_TYPES`）。
- `suitable=false` 表示节奏不稳/无明显节拍，**不建议作舞曲**。
- `analyze` 默认只取前 90 秒，足够测速。

## 2. 多来源导入

```ts
import { createSourceRegistry } from '@hdbc/dance-sdk';
import { createQQMusicClient, HttpCookieProvider } from '@hdbc/qqmusic-sdk';

const qq = await createQQMusicClient({ cookieProvider: new HttpCookieProvider('http://127.0.0.1:8899/cookie') });
const sources = createSourceRegistry({ qqAnonymous: () => qq, qqLibrary: () => qq });

// 来源列表
[...sources.values()].map((s) => ({ id: s.id, label: s.label, auth: s.authed() }));

// 导入：每个来源的 build(input) 返回归一化曲目
const { tracks } = await sources.get('netease')!.build({ input: 'https://music.163.com/playlist?id=3778678', type: '未分类' });
// tracks: [{ id, name, artists, album, durationMs, coverUrl, url?, file?, local?, type? }, ...]
```

| 来源 id | 输入 | 说明 |
|---|---|---|
| `qqmusic` | `{ url|disstid }` 歌单；`{ songMid }` 单曲 | 需 `qqLibrary` 有登录态（歌单） |
| `netease` | `{ input: 链接/ID }` | 匿名可用；播放直链对部分歌需 `neteaseCookie` |
| `local` | `{ dir, recursive? }` | 按文件名 `舞种-歌名-歌手` 扫描，文件原位 |
| `http` | `{ urls:[...] }` 或 `{ manifestUrl }` | **整库清单** |

### 自建服务器「整库」清单

把服务器上所有音频列成一个 JSON，即可**一次性收编为完整曲库**：

```json
{
  "base": "https://my-server/music/",
  "files": [
    { "name": "平四-暧昧-王菲.mp3", "url": "pop/amen.mp3" },
    { "name": "慢三-偏偏喜欢你-陈百强.mp3", "url": "https://other/cdn/xxx.mp3" }
  ]
}
```

- `base` 可选；`files` 项可为字符串或对象；相对 `url` 按 `base`（或清单所在目录）解析。
- `name` 按《HBDC 规则》命名即可自动归舞种。

```ts
const { tracks } = await sources.get('http')!.build({ manifestUrl: 'https://my-server/index.json' });
```

## 3. 本地缓存

```ts
import { MediaCache } from '@hdbc/dance-sdk';

const media = new MediaCache('/data/media', '320', 3, console);
const file = await media.ensureFromUrl('https://.../x.mp3', 'songmid'); // 下载并转 mp3，返回文件名
await media.ensure(qqClient, '0039MnYb0qxYhV');                        // 从 QQ 下载
const { bytes, files } = await media.stats();
```

---

## 边界（SDK 不做）

- 不做 HTTP 服务 / 路由、不做曲库持久化与排曲逻辑（由宿主负责，见 `@hdbc/dance-backend`）。
