#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
QQ 客户端 cookie 桥（Python 版，用 frida-python）。

- attach QQMusic.exe -> 加载 agent.js -> 定期扫内存拿 live cookie -> 本地 HTTP 暴露。
- 供 SDK 的 CookieProvider 消费；也可 --once 单次取出。

用法：
    pip install frida
    python bridge.py            # GET /cookie | /health | /refresh  (127.0.0.1:8899)
    python bridge.py --once     # 只取一次（脱敏打印）
    python bridge.py --pid 1234
"""

import argparse
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import frida

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT = open(os.path.join(HERE, "agent.js"), "r", encoding="utf-8").read()
PORT = int(os.environ.get("BRIDGE_PORT", "8899"))

state = {"ok": False, "pid": None, "cookie": None, "count": 0, "updatedAt": 0, "error": None}
lock = threading.Lock()


def pick_process(device, want_pid):
    procs = device.enumerate_processes()
    if want_pid:
        for p in procs:
            if p.pid == want_pid:
                return p
        return None
    for p in procs:
        if p.name in ("QQMusic", "QQMusic.exe"):
            return p
    for p in procs:
        if "QQMusic" in p.name and not any(
            s in p.name for s in ("Service", "Up", "Uninst", "Agent", "External", "Svr")
        ):
            return p
    return None


def masked(c):
    if not c:
        return None
    k = c.get("qqmusic_key") or c.get("qm_keyst") or ""
    return {"uin": c.get("uin"), "keyMasked": (k[:4] + "****" + k[-4:]) if k else None}


def sniff(script):
    try:
        r = script.exports_sync.sniff()
        with lock:
            state["count"] = r.get("count", 0)
            state["updatedAt"] = int(time.time() * 1000)
            if r.get("count", 0) > 0:
                state["cookie"] = r["candidates"][0]
                state["ok"] = True
                state["error"] = None
            else:
                state["ok"] = False
                state["error"] = "内存中未找到 cookie（客户端可能未登录）"
    except Exception as e:  # noqa: BLE001
        with lock:
            state["ok"] = False
            state["error"] = str(e)
    print(
        "[sniff] count=%s ok=%s %s %s"
        % (state["count"], state["ok"], json.dumps(masked(state["cookie"]), ensure_ascii=False), state["error"] or ""),
        flush=True,
    )


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/cookie":
            with lock:
                ok, cookie, err = state["ok"], state["cookie"], state["error"]
            if ok and cookie:
                self._send(200, {"ok": True, **cookie})
            else:
                self._send(503, {"ok": False, "error": err})
        elif path == "/health":
            with lock:
                self._send(200, {"ok": True, "pid": state["pid"], "count": state["count"], "updatedAt": state["updatedAt"], "hasCookie": state["ok"]})
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *args):  # 静音默认访问日志
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--pid", type=int, default=0)
    ap.add_argument("--interval", type=int, default=20)
    args = ap.parse_args()

    device = frida.get_local_device()
    target = pick_process(device, args.pid)
    if not target:
        print("未找到 QQMusic 进程，请先启动并登录 QQ 音乐客户端", file=sys.stderr)
        sys.exit(1)

    session = device.attach(target.pid)
    script = session.create_script(AGENT, runtime="qjs")
    script.load()
    with lock:
        state["pid"] = target.pid
    print("attached %s (pid=%s)" % (target.name, target.pid), flush=True)

    sniff(script)

    if args.once:
        sys.exit(0 if state["ok"] else 2)

    def loop():
        while True:
            time.sleep(args.interval)
            sniff(script)

    threading.Thread(target=loop, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("bridge listening on http://127.0.0.1:%d  (GET /cookie | /health)" % PORT, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
