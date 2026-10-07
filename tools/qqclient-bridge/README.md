# qqclient-bridge —— QQ 音乐客户端 cookie 桥（Python / Frida）

把**运行中的 QQ 音乐 PC 客户端**里当前有效的登录 cookie 抠出来，用本地 HTTP 暴露给后端 / SDK。

用途：让「会员账号」的登录态**跟着客户端自动续期**（客户端会自己刷新 `qqmusic_key`），
从而解决「服务端 cookie 约 60 天过期 / 无法续期」的问题——**只要客户端开着，拿到的永远是新 key，不用重扫。**

## 原理

QQ 客户端每次发请求都会在内存里拼出 Cookie 头（含 `uin` / `qqmusic_key` / `qm_keyst`）。
`agent.js` 用 Frida 注入 `QQMusic.exe`，扫描内存里的 `qqmusic_key=`，读取窗口并抽出完整 cookie。
**不 hook、不改客户端行为。**

## 依赖与运行

```powershell
cd tools/qqclient-bridge
pip install frida

# 先启动并登录 QQ 音乐客户端，然后：
python bridge.py            # 起服务：http://127.0.0.1:8899
python bridge.py --once     # 只取一次并打印（脱敏）
python bridge.py --pid 1234 # 指定进程
```

接口：

| 接口 | 说明 |
|---|---|
| `GET /cookie` | 返回 live cookie（`{ok, uin, qqmusic_key, qm_keyst, ...}`）；失败 503 |
| `GET /health` | `{ok, pid, count, updatedAt, hasCookie}` |

`bridge.py` 每 20 秒自动重扫，捕捉客户端刷新后的新 key。

## 权限 / 排错

- 默认同用户注入即可；报错就用**管理员**开 PowerShell 再运行。
- `count=0`：确认客户端已登录（能播放）；打开 QQ 音乐随便点两下再重试。
- 杀软可能拦 Frida 注入，需放行。

## 与 SDK 集成

```ts
import { createQQMusicClient, HttpCookieProvider } from '@hdbc/qqmusic-sdk';

const qq = await createQQMusicClient({
  cookieProvider: new HttpCookieProvider('http://127.0.0.1:8899/cookie'),
});
```

## 账号模型（推荐）

- **会员账号（补歌/下载）**：在服务器那台机器上，用**有会员的 QQ 号**登录客户端 → bridge 镜像它的 cookie →
  全站搜索/试听/无损下载都走它，**不用重扫**。
- **用户账号（导入歌单等）**：每个用户扫码登录自己的账号，取自己的歌单/收藏（互相隔离，用「每用户一个实例」）。

## 安全

- 只监听 `127.0.0.1`，返回的是**完整凭证**，**切勿暴露公网**。
- 日志只打印脱敏 key（前 4 + 后 4）。
