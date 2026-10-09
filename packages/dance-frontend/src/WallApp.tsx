import { useEffect, useRef, useState } from 'react';
import { Howl } from 'howler';
import anime from 'animejs';
import { getQueue, type QueueItem } from './api';
import QRCode from 'qrcode';

const FADE_OUT = 700;
const FADE_IN = 900;

function parseLrc(text: string): Array<{ t: number; text: string }> {
  const out: Array<{ t: number; text: string }> = [];
  for (const line of (text || '').split('\n')) {
    const matches = [...line.matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)];
    const t = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of matches) {
      const sec = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
      if (t) out.push({ t: sec, text: t });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

function mmss(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 响度归一化目标（LUFS）与增益（dB 限幅 ±12dB） */
const TARGET_LUFS = -16;
function trackGain(loudness?: number | null): number {
  if (loudness == null) return 1;
  const db = Math.min(12, Math.max(-12, TARGET_LUFS - loudness));
  return Math.pow(10, db / 20);
}

/** 舞种色带：给每个舞种一个专属强调色（用于标签 / 底部色带 / 列表强调） */
const TYPE_COLORS: Record<string, string> = {
  慢三: '#7f9dc0',
  中三: '#8aa6c4',
  快三: '#5f86b0',
  慢四: '#6b8cae',
  中四: '#8aa6c4',
  平四: '#c5a059',
  并四: '#b07d3a',
  伦巴: '#c56b8a',
  吉特巴: '#d1603d',
  集体舞: '#5e8c6a',
  华尔兹: '#7f9dc0',
  探戈: '#a8503f',
  恰恰: '#c56b8a',
  桑巴: '#d98c4a',
  牛仔: '#d1603d',
};
function typeColor(t?: string | null): string {
  return (t && TYPE_COLORS[t]) || '#c5a059';
}
/** 封面进度环几何 */
const RING_R = 45;
const RING_C = 2 * Math.PI * RING_R;

/** 舞会大屏播放（/wall）：howler + anime；切歌自动淡出→切换→淡入 */
export default function WallApp() {
  const q = getQueue();
  const [items, setItems] = useState<QueueItem[]>(q?.items || []);

  const [idx, setIdx] = useState(q?.index || 0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [clock, setClock] = useState('');
  const [lrc, setLrc] = useState<Array<{ t: number; text: string }>>([]);
  const initialCover = items[q?.index || 0]?.coverUrl || null;
  const [layers, setLayers] = useState<{ bg: [string | null, string | null]; cover: [string | null, string | null]; front: 0 | 1 }>({
    bg: [initialCover, initialCover],
    cover: [initialCover, initialCover],
    front: 0,
  });
  const soundRef = useRef<Howl | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const revRef = useRef(-1);
  const curMidRef = useRef('');
  const [finished, setFinished] = useState(false);
  const [qr, setQr] = useState('');
  const [reqs, setReqs] = useState<Array<{ id: string; name: string; status: string }>>([]);

  const cur = items[idx];
  const limitSec = cur && cur.playMs && cur.playMs > 0 ? cur.playMs / 1000 : 0;

  // 时钟
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, []);

  // 点歌二维码（离线生成）
  useEffect(() => {
    QRCode.toDataURL(window.location.origin + '/request', { width: 240, margin: 1 }).then(setQr).catch(() => {});
  }, []);

  // 已点歌滚动提示：轮询点歌队列（待处理 / 已采纳）
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/requests')
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          setReqs((j?.data || []).filter((x: { status: string }) => x.status === 'pending' || x.status === 'accepted'));
        })
        .catch(() => {});
    };
    load();
    const t = window.setInterval(load, 10000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // 记录当前正在播放的曲目 mid（供实时同步时保持不回退）
  useEffect(() => {
    curMidRef.current = items[idx]?.mid || '';
  }, [items, idx]);

  // 实时同步：轮询服务端「大屏队列」，控制台推送后自动跟随（当前曲目仍在队列里则保留）
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/wall/queue')
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          const d = j?.data as { items?: QueueItem[]; index?: number; rev?: number } | null;
          if (!d || !Array.isArray(d.items) || !d.items.length) return;
          if (d.rev === revRef.current) return;
          revRef.current = d.rev ?? -1;
          const next = d.items;
          const playing = curMidRef.current;
          setItems(next);
          const found = playing ? next.findIndex((x) => x.mid === playing) : -1;
          setIdx(found >= 0 ? found : Math.max(0, Math.min(next.length - 1, d.index ?? 0)));
        })
        .catch(() => {});
    };
    load();
    const t = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // 播放当前曲目（淡入）+ 视觉过渡
  useEffect(() => {
    if (!cur) return;
    setPos(0);
    setLrc([]);
    setDur(cur.durationMs ? cur.durationMs / 1000 : 0);
    const s = new Howl({
      src: ['/api/song/stream?mid=' + encodeURIComponent(cur.mid)],
      html5: true,
      volume: 0,
      onplay: () => setPlaying(true),
      onpause: () => setPlaying(false),
      onload: () => setDur(s.duration() || (cur.durationMs ? cur.durationMs / 1000 : 0)),
      onend: () => {
        if (idx + 1 < items.length) setIdx(idx + 1);
        else setFinished(true);
      },
    });
    soundRef.current = s;
    s.play();
    s.fade(0, trackGain(cur.loudness), FADE_IN);
    fetch('/api/song/lyric?mid=' + encodeURIComponent(cur.mid) + '&json=1')
      .then((r) => r.json())
      .then((j) => setLrc(parseLrc(j?.data?.lyric || '')))
      .catch(() => {});
    // 封面 / 模糊背景：双图层交叉溶解（CSS 过渡），文字做淡入
    const url = cur.coverUrl || null;
    setLayers((p) => {
      const back = (p.front === 0 ? 1 : 0) as 0 | 1;
      const bg: [string | null, string | null] = [p.bg[0], p.bg[1]];
      const cover: [string | null, string | null] = [p.cover[0], p.cover[1]];
      bg[back] = url;
      cover[back] = url;
      return { bg, cover, front: back };
    });
    if (stageRef.current) {
      anime({ targets: stageRef.current.querySelectorAll('.wall-info'), opacity: [0, 1], translateY: [26, 0], duration: 750, easing: 'easeOutExpo' });
    }
    return () => {
      try {
        s.stop();
      } catch {
        /* ignore */
      }
      s.unload();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // 进度 + 裁剪到点自动切歌（走淡出过渡）
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = soundRef.current;
      if (!s) return;
      const p = s.seek();
      if (typeof p === 'number') setPos(p);
      if (limitSec && typeof p === 'number' && p >= limitSec) goTo(idx + 1);
    }, 400);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, limitSec]);

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if (e.code === 'ArrowRight') goTo(idx + 1);
      else if (e.code === 'ArrowLeft') goTo(idx - 1);
      else if (e.key === 'f' || e.key === 'F') fullscreen();
      else if (e.key === 'Escape') {
        if (!document.fullscreenElement) exitWall();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  /** 切歌：淡出当前 → 切换 → 新曲淡入 */
  function goTo(target: number) {
    const t = Math.max(0, Math.min(items.length - 1, target));
    if (t === idx || busyRef.current) return;
    busyRef.current = true;
    const s = soundRef.current;
    const commit = () => {
      setIdx(t);
      window.setTimeout(() => {
        busyRef.current = false;
      }, FADE_IN);
    };
    if (s && s.playing()) {
      s.fade(s.volume(), 0, FADE_OUT);
      window.setTimeout(() => {
        try {
          s.stop();
        } catch {
          /* ignore */
        }
        commit();
      }, FADE_OUT);
    } else {
      try {
        s?.stop();
      } catch {
        /* ignore */
      }
      commit();
    }
  }
  function toggle() {
    const s = soundRef.current;
    if (!s) return;
    if (s.playing()) s.pause();
    else {
      s.volume(0);
      s.play();
      s.fade(0, trackGain(cur?.loudness), FADE_IN);
    }
  }
  function fullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
  /** 退出大屏：停播 + 退全屏 + 回控制台 */
  function exitWall() {
    try {
      soundRef.current?.stop();
    } catch {
      /* ignore */
    }
    if (document.fullscreenElement) void document.exitFullscreen?.();
    window.location.href = '/';
  }

  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  // 当前歌词行索引 + 展示窗口（前后若干行）
  let curIdx = -1;
  for (let i = 0; i < lrc.length; i++) if (lrc[i].t <= pos + 0.15) curIdx = i;
  const winStart = Math.max(0, curIdx - 2);
  const win = lrc.slice(winStart, winStart + 6);
  const upcoming = items.slice(idx + 1, idx + 7);
  const accent = typeColor(cur?.type);
  const reqText = reqs.length ? reqs.map((r) => r.name + (r.status === 'accepted' ? '✓' : '')).join('　·　') : '';

  if (!items.length) {
    return (
      <div className="wall wall-empty">
        <div className="wall-empty-inner">
          <div className="wall-empty-title">舞曲排曲台 · 大屏</div>
          <div className="wall-empty-sub">没有播放队列，回控制台「排曲」里点「大屏播放」</div>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="wall wall-end">
        <div className="wall-end-inner">
          <div className="wall-end-brand">舞曲排曲台</div>
          <div className="wall-end-title">本场到此</div>
          <div className="wall-end-sub">谢谢大家 · 欢迎下次再来</div>
          <button className="wall-exit" onClick={exitWall}>
            ← 返回控制台
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wall">
      {[0, 1].map((i) => (
        <div
          key={'bg' + i}
          className={'wall-bg' + (layers.front === i ? ' front' : '')}
          style={layers.bg[i] ? { backgroundImage: `url(${layers.bg[i]})` } : undefined}
        />
      ))}
      <div className="wall-veil" />
      <div className="wall-tint" style={{ background: `radial-gradient(130% 130% at 85% 0%, ${accent}40, transparent 58%)` }} />

      <header className="wall-top">
        <span className="wall-brand">舞曲排曲台</span>
        <div className="wall-top-right">
          <button className="wall-exit" onClick={exitWall} title="返回控制台">
            ← 返回控制台
          </button>
          <span className="wall-clock">{clock}</span>
        </div>
      </header>

      <div className="wall-ticker">
        <span className="ticker-label">
          点歌{reqs.length ? ' ' + reqs.length : ''}
        </span>
        <div className="ticker-track">
          <span className={'ticker-inner' + (reqs.length ? ' scroll' : '')}>{reqs.length ? reqText + '　　·　　' + reqText : '暂无点歌 · 扫码点歌 →'}</span>
        </div>
      </div>

      <main className="wall-main" ref={stageRef}>
        <div className="wall-cover">
          {[0, 1].map((i) => (layers.cover[i] ? <img key={'c' + i} className={layers.front === i ? 'front' : ''} src={layers.cover[i] as string} alt="" /> : null))}
          {!layers.cover[layers.front] ? <div className="wall-cover-ph front" /> : null}
          <svg className="wall-ring" viewBox="0 0 100 100" aria-hidden>
            <circle className="ring-track" cx="50" cy="50" r={RING_R} />
            <circle
              className="ring-fill"
              cx="50"
              cy="50"
              r={RING_R}
              style={{ stroke: accent, strokeDasharray: RING_C, strokeDashoffset: RING_C * (1 - pct / 100) }}
            />
          </svg>
        </div>

        <section className="wall-info">
          {cur?.type ? <span className="wall-type" style={{ background: accent }}>{cur.type}</span> : null}
          <h1 className="wall-title">{cur?.name}</h1>
          <div className="wall-artist">{(cur?.artists || []).join(' / ')}</div>
          {cur?.bpm || cur?.mood ? (
            <div className="wall-meta">
              {cur?.bpm ? <span>{cur.bpm} BPM</span> : null}
              {cur?.mood ? <span>{cur.mood}</span> : null}
            </div>
          ) : null}

          <div className="wall-progress">
            <div className="wall-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="wall-times">
            <span>{mmss(pos)}</span>
            <span className={'wall-remain' + (dur > 0 && dur - pos <= 15 ? ' soon' : '')}>{dur > 0 ? '还剩 ' + mmss(Math.max(0, dur - pos)) : '--:--'}</span>
            <span>{dur > 0 ? mmss(dur) : '--:--'}</span>
          </div>

          <div className="wall-lyric">
            {win.length ? (
              win.map((l, i) => {
                const gi = winStart + i;
                const cls = gi === curIdx ? 'cur' : gi === curIdx + 1 ? 'near' : 'far';
                return (
                  <div key={gi} className={'ly ' + cls}>
                    {l.text || ' '}
                  </div>
                );
              })
            ) : (
              <div className="ly far">♪ 纯音乐 / 暂无歌词</div>
            )}
          </div>
        </section>

        <aside className="wall-next">
          <div className="wall-next-title">接下来</div>
          <ol>
            {upcoming.map((s, i) => (
              <li key={s.mid + i}>
                <span className="n-idx">{idx + i + 2}</span>
                <span className="n-main">
                  <span className="n-name">{s.name}</span>
                  <span className="n-sub">
                    {s.type ? <em style={{ color: typeColor(s.type) }}>{s.type}</em> : null}
                    {(s.artists || []).join(' / ')}
                  </span>
                </span>
              </li>
            ))}
            {!upcoming.length ? <li className="n-empty">已是最后一首</li> : null}
          </ol>
          <div className="wall-qr">
            {qr ? <img src={qr} alt="点歌" /> : null}
            <span>扫码点歌</span>
          </div>
        </aside>
      </main>

      <div className="wall-controls">
        <button onClick={() => goTo(idx - 1)} title="上一首">
          ⏮
        </button>
        <button className="big" onClick={toggle} title="播放/暂停">
          {playing ? '⏸' : '▶'}
        </button>
        <button onClick={() => goTo(idx + 1)} title="下一首">
          ⏭
        </button>
        <button onClick={fullscreen} title="全屏">
          ⛶
        </button>
      </div>

      <div className="wall-hint">空格 播放/暂停 · ← → 切歌（自动淡入淡出）· F 全屏 · Esc/返回 退出</div>
      <div className="wall-band" style={{ background: accent }} />
    </div>
  );
}
