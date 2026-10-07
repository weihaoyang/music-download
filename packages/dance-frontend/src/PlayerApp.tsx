import { useEffect, useRef } from 'react';
import APlayer from 'aplayer';
import 'aplayer/dist/APlayer.min.css';
import { getQueue } from './api';

/**
 * 独立全屏播放页（/play）。
 * - 统一走 /api/song/stream：本地 MP3 与 QQ 音乐直链由后端 302 决定，播放器无需区分。
 * - 支持「裁剪时长」：某首设了 playMs 时，播到该时长自动切下一首。
 */
export default function PlayerApp() {
  const ref = useRef<HTMLDivElement | null>(null);
  const q = getQueue();

  useEffect(() => {
    if (!ref.current || !q || !q.items.length) return;
    const limits = q.items.map((s) => (s.playMs && s.playMs > 0 ? s.playMs : 0));
    let idx = 0;
    const ap = new APlayer({
      container: ref.current,
      audio: q.items.map((s) => ({
        name: s.name,
        artist: (s.artists || []).join(' / '),
        // 统一音频地址：后端本地缓存 -> /media；否则 302 到 QQ 直链
        url: '/api/song/stream?mid=' + encodeURIComponent(s.mid),
        cover: s.coverUrl || undefined,
        lrc: '/api/song/lyric?mid=' + encodeURIComponent(s.mid),
      })),
      listFolded: false,
      listMaxHeight: '68vh',
      theme: '#0064fa',
      order: 'list',
      loop: 'all',
      preload: 'none',
      lrcType: 3,
    });
    try {
      ap.on('listswitch', (data: { index?: number }) => {
        if (data && typeof data.index === 'number') idx = data.index;
      });
      ap.on('timeupdate', (time: number) => {
        const limit = limits[idx];
        if (limit && typeof time === 'number' && time * 1000 >= limit) {
          const next = idx + 1;
          if (next < q.items.length) {
            ap.list.switch(next);
            ap.play();
          } else {
            ap.pause();
          }
        }
      });
    } catch {
      /* ignore */
    }
    try {
      ap.list.switch(q.index || 0);
      ap.play();
    } catch {
      /* ignore */
    }
    return () => {
      try {
        ap.destroy();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasQueue = !!(q && q.items.length);
  return (
    <div className="player-page">
      <div className="player-top">
        <a href="/">← 返回控制台</a>
        <span className="muted">舞曲排曲台 · 播放{hasQueue ? ` · ${q!.items.length} 首` : ''}</span>
      </div>
      {hasQueue ? <div className="aplayer-wrap" ref={ref} /> : <div className="muted" style={{ padding: 48, textAlign: 'center' }}>没有播放队列，回控制台点「播放」或「播放全部」</div>}
    </div>
  );
}
