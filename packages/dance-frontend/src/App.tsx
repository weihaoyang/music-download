import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Avatar,
  Button,
  Input,
  InputNumber,
  List,
  Modal,
  Progress,
  Radio,
  RadioGroup,
  Select,
  Slider,
  Tabs,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import html2canvas from 'html2canvas';
import { adminFetch, api, post, getAdminToken, setAdminToken, setQueue as storeQueue, getTheme, setTheme, type ThemeMode, type LibrarySong, type Song, type TaskItem } from './api';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

type SetSong = LibrarySong & { playMs?: number | null };
const DEFAULT_ORDER = ['集体舞', '慢四', '吉特巴', '慢三', '平四', '并四', '伦巴', '快三'];

function fmt(ms: number): string {
  return `${Math.round((ms || 0) / 60000)} 分`;
}
function mmss(ms: number): string {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function eff(ms: number, playMs?: number | null): number {
  return playMs && playMs > 0 ? playMs : ms || 0;
}
function totalOf(arr: SetSong[]): number {
  return arr.reduce((a, s) => a + eff(s.durationMs, s.playMs), 0);
}
function albumName(s: LibrarySong | Song): string {
  const a = (s as LibrarySong).album;
  if (!a) return '';
  return typeof a === 'string' ? a : (a as { name?: string }).name || '';
}
function kindLabel(kind: TaskItem['kind']): string {
  return kind === 'classify' ? '自动分类' : kind === 'cacheClassify' ? '缓存并分类' : '缓存';
}

/* ------------------------------- 图标 ------------------------------- */
const IPlay = () => (
  <svg viewBox="0 0 24 24">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IEdit = () => (
  <svg viewBox="0 0 24 24">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
  </svg>
);
const ITrash = () => (
  <svg viewBox="0 0 24 24">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  </svg>
);
const INote = () => (
  <svg viewBox="0 0 24 24">
    <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
  </svg>
);
const IPlus = () => (
  <svg viewBox="0 0 24 24">
    <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
  </svg>
);
const SOURCE_LABELS: Record<string, string> = {
  qqmusic: 'QQ音乐',
  netease: '网易云',
  local: '本地',
  http: '直链',
  pan: '网盘',
};
const SOURCE_OPTIONS = [
  { value: 'qqmusic', label: 'QQ音乐' },
  { value: 'netease', label: '网易云音乐' },
  { value: 'local', label: '本地/社团文件夹' },
  { value: 'http', label: '自建服务器直链' },
  { value: 'pan', label: '百度网盘' },
];

function IconBtn({ title, danger, onClick, children }: { title: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`iconbtn${danger ? ' danger' : ''}`} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('lib');
  const [types, setTypes] = useState<Array<{ type: string; count: number; cached: number }>>([]);
  const [activeType, setActiveType] = useState('');
  const [songs, setSongs] = useState<LibrarySong[]>([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const [task, setTask] = useState<TaskItem | null>(null);

  const [kw, setKw] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  const [importUrl, setImportUrl] = useState('');
  const [importPreview, setImportPreview] = useState<{ name: string; songCount: number; songs: Song[] } | null>(null);
  const [importName, setImportName] = useState('');
  const [importType, setImportType] = useState('未分类');
  const [importing, setImporting] = useState(false);

  // 多来源
  const [searchSource, setSearchSource] = useState<'qqmusic' | 'netease'>('qqmusic');
  const [addType, setAddType] = useState('未分类');
  const [importSource, setImportSource] = useState<'qqmusic' | 'netease' | 'local' | 'http' | 'pan'>('qqmusic');
  const [neInput, setNeInput] = useState('');
  const [localDir, setLocalDir] = useState('');
  const [localRec, setLocalRec] = useState(true);
  const [httpUrls, setHttpUrls] = useState('');
  const [panShare, setPanShare] = useState('');
  const [panPwd, setPanPwd] = useState('');
  const [loadingImport, setLoadingImport] = useState(false);
  const [cloning, setCloning] = useState(false);

  const [durationMin, setDurationMin] = useState(120);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [orderText, setOrderText] = useState(DEFAULT_ORDER.join(' '));
  const [mode, setMode] = useState<'weighted' | 'sequential'>('weighted');
  const [setlistName, setSetlistName] = useState('');
  const [gen, setGen] = useState<SetSong[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [savedLists, setSavedLists] = useState<Array<{ id: string; name: string; count: number; totalMs: number }>>([]);
  const [generating, setGenerating] = useState(false);

  const [user, setUser] = useState<{ uin: string; nickname?: string | null; vip?: boolean } | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [qr, setQr] = useState<{ token: string; image: string } | null>(null);
  const [qrState, setQrState] = useState('');
  const pollRef = useRef<number | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [adminTokenState, setAdminTokenState] = useState(getAdminToken());
  const [settings, setSettings] = useState<{ mediaDir: string; mediaQuality: string; autoDownload: boolean; cacheLimitBytes: number; autoClassify: boolean; neteaseCookie: string; baiduCookie: string }>({ mediaDir: '', mediaQuality: '320', autoDownload: true, cacheLimitBytes: 20 * 1024 * 1024 * 1024, autoClassify: true, neteaseCookie: '', baiduCookie: '' });
  const [usage, setUsage] = useState<{ bytes: number; files: number; limit: number } | null>(null);

  const [calibDir, setCalibDir] = useState('');
  const [calibRecursive, setCalibRecursive] = useState(true);
  const [calibAddMissing, setCalibAddMissing] = useState(false);
  const [calibDryRun, setCalibDryRun] = useState(true);
  const [calibLoading, setCalibLoading] = useState(false);
  const [calibReport, setCalibReport] = useState<{
    scanned: number;
    audio: number;
    matched: number;
    updated: number;
    unchanged: number;
    added: number;
    unmatched: Array<{ name: string; type: string }>;
    unparsed: string[];
  } | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<{ mid: string; name: string; artists: string; type: string; bpm: number | null; meter: string | null; energy: number | null; mood: string | null; suitable: boolean | null }>({ mid: '', name: '', artists: '', type: '', bpm: null, meter: null, energy: null, mood: null, suitable: null });

  const [event, setEvent] = useState<{ name: string; time: string; location: string; host: string; note: string }>({ name: '', time: '', location: '', host: '', note: '' });
  const posterRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function loadTypes() {
    return api<{ data: Array<{ type: string; count: number; cached: number }> }>('/api/library/types')
      .then((r) => {
        setTypes(r.data || []);
        return r.data || [];
      })
      .catch((e) => {
        Toast.error('读取曲库失败：' + e.message);
        return [];
      });
  }
  function loadSongs(type: string) {
    setLoadingLib(true);
    const url = type === '__liked__' ? '/api/library/list?liked=1' : '/api/library/list?type=' + encodeURIComponent(type);
    return api<{ songs: LibrarySong[] }>(url)
      .then((r) => setSongs(r.songs || []))
      .catch((e) => Toast.error(e.message))
      .finally(() => setLoadingLib(false));
  }
  function loadSetlists() {
    api<{ data: typeof savedLists }>('/api/setlists').then((r) => setSavedLists(r.data || [])).catch(() => {});
  }
  function loadSettings() {
    setAdminToken(adminTokenState);
    adminFetch<{ data: { mediaDir: string; mediaQuality: string; autoDownload: boolean; cacheLimitBytes: number; autoClassify: boolean; neteaseCookie: string; baiduCookie: string } }>('/api/settings', 'GET')
      .then((r) => setSettings({ mediaDir: r.data.mediaDir, mediaQuality: r.data.mediaQuality, autoDownload: r.data.autoDownload, cacheLimitBytes: r.data.cacheLimitBytes ?? 20 * 1024 * 1024 * 1024, autoClassify: r.data.autoClassify !== false, neteaseCookie: r.data.neteaseCookie || '', baiduCookie: r.data.baiduCookie || '' }))
      .catch((e) => Toast.warning('读取设置失败（检查管理员口令）：' + e.message));
    adminFetch<{ data: { bytes: number; files: number; limit: number } }>('/api/media/usage', 'GET')
      .then((r) => setUsage(r.data))
      .catch(() => setUsage(null));
  }
  function saveSettings() {
    setAdminToken(adminTokenState);
    adminFetch('/api/settings', 'PUT', { mediaDir: settings.mediaDir, mediaQuality: settings.mediaQuality, autoDownload: settings.autoDownload, cacheLimitBytes: settings.cacheLimitBytes, autoClassify: settings.autoClassify, neteaseCookie: settings.neteaseCookie, baiduCookie: settings.baiduCookie })
      .then(() => {
        Toast.success('设置已保存并生效');
        setSettingsOpen(false);
      })
      .catch((e) => Toast.error('保存失败：' + e.message));
  }
  function importLiked() {
    setAdminToken(adminTokenState);
    const type = '未分类';
    Toast.info('正在拉取「我喜欢」…');
    adminFetch<{ added: number; skipped: number; fetched: number; total: number }>('/api/library/import-liked', 'POST', { type })
      .then((r) => {
        Toast.success(`「我喜欢」已导入曲库：新增 ${r.added}，跳过 ${r.skipped}（共 ${r.fetched}/${r.total}）`);
        loadTypes();
        setActiveType('__liked__');
      })
      .catch((e) => Toast.error('导入失败：' + e.message));
  }
  function importNetease() {
    setAdminToken(adminTokenState);
    if (!neInput.trim()) return Toast.warning('填入网易云歌单/单曲链接');
    Toast.info('正在从网易云导入…');
    adminFetch<{ added: number; skipped: number; name: string }>('/api/source/netease/import', 'POST', { type: importType, input: neInput.trim() })
      .then((r) => {
        Toast.success(`网易云 →「${importType}」：新增 ${r.added}，跳过 ${r.skipped}${r.name ? '（' + r.name + '）' : ''}`);
        loadTypes();
      })
      .catch((e) => Toast.error('导入失败：' + e.message));
  }
  function importLocal() {
    setAdminToken(adminTokenState);
    if (!localDir.trim()) return Toast.warning('填入本地/社团文件夹路径');
    adminFetch<{ added: number; skipped: number; scanned: number; unparsed: number }>('/api/source/local/import', 'POST', { dir: localDir.trim(), recursive: localRec })
      .then((r) => {
        Toast.success(`本地导入：新增 ${r.added}，跳过 ${r.skipped}（扫描 ${r.scanned}，文件名不合规 ${r.unparsed}）`);
        loadTypes();
      })
      .catch((e) => Toast.error('导入失败：' + e.message));
  }
  function importHttp() {
    setAdminToken(adminTokenState);
    const urls = httpUrls.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return Toast.warning('填入至少一个直链 URL（每行一个）');
    adminFetch<{ added: number; skipped: number }>('/api/source/http/import', 'POST', { type: importType, urls })
      .then((r) => {
        Toast.success(`直链 →「${importType}」：新增 ${r.added}，跳过 ${r.skipped}`);
        loadTypes();
      })
      .catch((e) => Toast.error('导入失败：' + e.message));
  }
  function importPan() {
    setAdminToken(adminTokenState);
    if (!panShare.trim()) return Toast.warning('填入百度网盘分享链接');
    Toast.info('正在解析网盘分享…');
    adminFetch<{ added: number; skipped: number; total: number }>('/api/source/pan/import', 'POST', { type: importType, shareUrl: panShare.trim(), pwd: panPwd || undefined })
      .then((r) => {
        Toast.success(`网盘导入：新增 ${r.added}，跳过 ${r.skipped}（共 ${r.total} 个音频）`);
        loadTypes();
      })
      .catch((e) => Toast.error('导入失败：' + e.message));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantLiked = params.get('liked');
    const wantType = params.get('type');
    loadTypes().then((t) => {
      if (wantLiked) setActiveType('__liked__');
      else if (wantType) setActiveType(wantType);
      else {
        const first = t.find((x) => x.count > 0) || t[0];
        if (first) setActiveType(first.type);
      }
      setWeights((w) => {
        const n = { ...w };
        for (const x of t) if (n[x.type] === undefined) n[x.type] = 1;
        return n;
      });
    });
    loadSetlists();
    api<{ user: typeof user }>('/api/auth/me').then((r) => setUser(r.user)).catch(() => {});
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);
  useEffect(() => {
    if (activeType) loadSongs(activeType);
  }, [activeType]);
  useEffect(() => {
    if (!task || task.status === 'done') return;
    const timer = window.setInterval(() => {
      api<{ data: TaskItem }>('/api/tasks/' + task.id)
        .then((r) => {
          setTask(r.data);
          if (r.data.status === 'done') {
            const label = kindLabel(r.data.kind);
            Toast.success(`${label}完成：成功 ${r.data.done}，失败 ${r.data.failed}`);
            if (activeType) loadSongs(activeType);
            loadTypes();
          }
        })
        .catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [task, activeType]);

  type Playable = { mid: string; name: string; artists: string[]; coverUrl?: string | null; playMs?: number | null; type?: string; durationMs?: number };
  function openPlayer(songs2: Playable[], index = 0, route = '/play') {
    storeQueue(songs2.map((s) => ({ mid: s.mid, name: s.name, artists: s.artists, coverUrl: s.coverUrl, playMs: s.playMs ?? null, type: s.type, durationMs: s.durationMs })), index);
    window.open(route, '_blank');
  }
  function openWall(songs2: Playable[]) {
    openPlayer(songs2, 0, '/wall');
  }
  function play(s: LibrarySong | Song, list: Array<LibrarySong | Song>) {
    const lib = list.filter((x): x is LibrarySong => 'type' in x);
    const idx = lib.findIndex((x) => x.mid === s.mid);
    openPlayer(lib, idx < 0 ? 0 : idx);
  }
  function cacheMissing() {
    adminFetch<{ taskId: string; queued: number }>('/api/library/download', 'POST', { type: activeType }).then((r) => {
      Toast.info(`已加入缓存队列：${r.queued} 首`);
      if (r.queued > 0) api<{ data: TaskItem }>('/api/tasks/' + r.taskId).then((t) => setTask(t.data)).catch(() => {});
    });
  }
  function autoClassify() {
    adminFetch<{ taskId: string; queued: number }>('/api/library/classify', 'POST', { type: activeType }).then((r) => {
      Toast.info(`开始自动分类：${r.queued} 首（需已缓存音频）`);
      if (r.queued > 0) api<{ data: TaskItem }>('/api/tasks/' + r.taskId).then((t) => setTask(t.data)).catch(() => {});
    });
  }
  function cacheClassify() {
    adminFetch<{ taskId: string; queued: number }>('/api/library/cache-classify', 'POST', { type: activeType }).then((r) => {
      Toast.info(`开始缓存并分类：${r.queued} 首（HQ 下载后自动识别，受缓存上限约束）`);
      if (r.queued > 0) api<{ data: TaskItem }>('/api/tasks/' + r.taskId).then((t) => setTask(t.data)).catch(() => {});
    });
  }
  function runCalibrate() {
    setAdminToken(adminTokenState);
    if (!calibDir.trim()) return Toast.warning('先填入舞曲文件夹路径');
    setCalibLoading(true);
    adminFetch<{ data: NonNullable<typeof calibReport> }>('/api/library/calibrate', 'POST', {
      dir: calibDir.trim(),
      recursive: calibRecursive,
      addMissing: calibAddMissing,
      dryRun: calibDryRun,
    })
      .then((r) => {
        setCalibReport(r.data);
        Toast.success(`${calibDryRun ? '试运行：' : ''}匹配 ${r.data.matched} · 改舞种 ${r.data.updated} · 新增 ${r.data.added}`);
        if (!calibDryRun) {
          loadTypes();
          if (activeType) loadSongs(activeType);
        }
      })
      .catch((e) => Toast.error('校准失败：' + e.message))
      .finally(() => setCalibLoading(false));
  }
  function openEdit(s: LibrarySong) {
    setEditForm({ mid: s.mid, name: s.name, artists: (s.artists || []).join(' / '), type: s.type, bpm: s.bpm ?? null, meter: s.meter ?? null, energy: s.energy ?? null, mood: s.mood ?? null, suitable: s.suitable ?? null });
    setEditOpen(true);
  }
  function saveEdit() {
    adminFetch('/api/library/song', 'PUT', {
      mid: editForm.mid,
      name: editForm.name,
      artists: editForm.artists.split(/[/、,，]/).map((x) => x.trim()).filter(Boolean),
      type: editForm.type,
      suitable: editForm.suitable,
      // 手动标记为适合时清掉旧的不适合提示
      ...(editForm.suitable === true ? { warning: null } : {}),
    })
      .then(() => {
        Toast.success('已保存');
        setEditOpen(false);
        loadTypes();
        if (activeType) loadSongs(activeType);
      })
      .catch((e) => Toast.error('保存失败：' + e.message));
  }
  function removeSong(s: LibrarySong) {
    Modal.confirm({
      title: '从曲库移除',
      content: `确定把《${s.name}》从曲库移除吗？（只删曲库记录，不删磁盘音频）`,
      okText: '移除',
      cancelText: '取消',
      onOk: () => {
        adminFetch('/api/library/song?mid=' + encodeURIComponent(s.mid), 'DELETE')
          .then(() => {
            Toast.success('已移除');
            loadTypes();
            if (activeType) loadSongs(activeType);
          })
          .catch((e) => Toast.error('移除失败：' + e.message));
      },
    });
  }
  function toggleTheme() {
    const t: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(t);
    setThemeState(t);
  }
  function doSearch() {
    if (!kw.trim()) return;
    setLoadingSearch(true);
    const path =
      searchSource === 'netease'
        ? '/api/search/netease?keywords=' + encodeURIComponent(kw) + '&limit=30'
        : '/api/search?keywords=' + encodeURIComponent(kw);
    api<{ items: Array<Record<string, unknown>> }>(path)
      .then((r) => {
        const items = (r.items || []).map((x) =>
          searchSource === 'netease'
            ? {
                mid: String(x.id),
                name: String(x.name ?? ''),
                artists: (x.artists as string[]) || [],
                album: x.album ? { name: String(x.album) } : null,
                durationMs: Number(x.durationMs) || 0,
                coverUrl: (x.coverUrl as string) || null,
              }
            : x,
        );
        setResults(items as unknown as Song[]);
      })
      .catch((e) => Toast.error(e.message))
      .finally(() => setLoadingSearch(false));
  }
  function addSearchResult(s: Song) {
    setAdminToken(adminTokenState);
    const req =
      searchSource === 'netease'
        ? adminFetch<{ added: number }>('/api/source/netease/import', 'POST', { type: addType, input: 'https://music.163.com/song?id=' + s.mid })
        : adminFetch<{ added: number }>('/api/source/qqmusic/import', 'POST', { type: addType, songMid: s.mid });
    req
      .then((r) => {
        Toast.success(r.added ? `已加入「${addType}」` : `「${addType}」中已存在`);
        loadTypes();
      })
      .catch((e) => Toast.error('加入失败：' + e.message));
  }
  function doImport() {
    if (!importUrl.trim()) return;
    setLoadingImport(true);
    api<{ data: { name: string; songCount: number; songs: Song[] } }>('/api/playlist/import?url=' + encodeURIComponent(importUrl))
      .then((r) => {
        setImportPreview(r.data);
        setImportName(r.data.name || '导入歌单');
        Toast.success(`解析成功：${r.data.name}（${r.data.songCount} 首）`);
      })
      .catch((e) => Toast.error('解析失败：' + e.message))
      .finally(() => setLoadingImport(false));
  }
  function doClone() {
    if (!user) {
      openLogin();
      return;
    }
    setCloning(true);
    post('/api/playlist/clone', { url: importUrl, name: importName })
      .then((r: any) => Toast.success('已导入到你的歌单：' + r.data.name))
      .catch((e) => Toast.error('导入失败：' + e.message))
      .finally(() => setCloning(false));
  }
  function importToLibrary() {
    setAdminToken(adminTokenState);
    if (!importUrl.trim()) return Toast.warning('先填入歌单链接或分享短链');
    if (!importType.trim()) return Toast.warning('先选择目标舞种');
    setImporting(true);
    adminFetch<{ added: number; skipped: number; queued: number; taskId?: string; name: string }>('/api/library/import', 'POST', {
      type: importType.trim(),
      url: importUrl.trim(),
    })
      .then((r) => {
        Toast.success(`已导入曲库「${importType}」：新增 ${r.added}，跳过 ${r.skipped}，排队缓存 ${r.queued}`);
        loadTypes();
        setActiveType(importType.trim());
        if (r.taskId) api<{ data: TaskItem }>('/api/tasks/' + r.taskId).then((t) => setTask(t.data)).catch(() => {});
      })
      .catch((e) => Toast.error('导入失败：' + e.message))
      .finally(() => setImporting(false));
  }
  function doGenerate() {
    if (!Object.keys(weights).length) {
      Toast.warning('请先设置各舞种权重');
      return;
    }
    setGenerating(true);
    post<{ songs: LibrarySong[]; totalMs: number }>('/api/setlist/generate', { durationMin, weights, mode, fill: true, order: orderArr })
      .then((r) => {
        const list = (r.songs || []).map((s) => ({ ...s, playMs: null }));
        setGen(list);
        Toast.success(`生成 ${list.length} 首，共 ${fmt(totalOf(list))}`);
      })
      .catch((e) => Toast.error('生成失败：' + e.message))
      .finally(() => setGenerating(false));
  }
  function moveGen(from: number, to: number) {
    setGen((g) => {
      const a = g.slice();
      const [x] = a.splice(from, 1);
      a.splice(to, 0, x);
      return a;
    });
  }
  function shuffleGen() {
    setGen((g) => {
      const a = g.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    });
  }
  function groupGen() {
    setGen((g) => g.slice().sort((a, b) => orderArr.indexOf(a.type) - orderArr.indexOf(b.type) || a.name.localeCompare(b.name)));
  }
  function trimGen(mid: string, ms: number) {
    setGen((g) => g.map((s) => (s.mid === mid ? { ...s, playMs: ms } : s)));
  }
  function removeGen(mid: string) {
    setGen((g) => g.filter((s) => s.mid !== mid));
  }
  function saveGen() {
    if (!gen.length) return Toast.warning('还没有排曲内容');
    post('/api/setlist', { name: setlistName || '未命名排曲', targetMin: durationMin, event, songs: gen.map((s) => ({ mid: s.mid, playMs: s.playMs ?? null })) })
      .then(() => {
        Toast.success('排曲已保存');
        loadSetlists();
      })
      .catch((e) => Toast.error('保存失败：' + e.message));
  }
  function exportImage() {
    const el = posterRef.current;
    if (!el || !gen.length) return Toast.warning('没有可导出的内容');
    Toast.info('正在生成长图…');
    html2canvas(el, { scale: 2, backgroundColor: '#FDFCF8', useCORS: true })
      .then((canvas) => {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = (event.name || setlistName || '舞会歌单') + '.png';
        a.click();
        Toast.success('长图已导出');
      })
      .catch((e) => Toast.error('导出失败：' + e.message));
  }
  function exportFile() {
    const file = {
      format: 'hdbc-setlist',
      version: 1,
      name: setlistName || '未命名排曲',
      event,
      targetMin: durationMin,
      totalMs: totalOf(gen),
      exportedAt: new Date().toISOString(),
      songs: gen.map((s) => ({ mid: s.mid, name: s.name, artists: s.artists, type: s.type, durationMs: s.durationMs, playMs: s.playMs ?? null })),
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (event.name || setlistName || 'setlist') + '.hdbc-setlist.json';
    a.click();
    URL.revokeObjectURL(a.href);
    Toast.success('排曲文件已导出');
  }
  function importFile(f: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const j = JSON.parse(String(reader.result)) as { name?: string; event?: Record<string, string>; songs?: Array<Record<string, unknown>> };
        const list: SetSong[] = (j.songs || []).map((s) => ({
          mid: String(s.mid ?? ''),
          name: String(s.name ?? ''),
          artists: Array.isArray(s.artists) ? (s.artists as unknown[]).map(String) : [],
          type: String(s.type ?? ''),
          album: null,
          coverUrl: null,
          durationMs: Number(s.durationMs) || 0,
          file: null,
          addedAt: Date.now(),
          playMs: Number(s.playMs) > 0 ? Number(s.playMs) : null,
        }));
        setGen(list);
        setSetlistName(String(j.name || '导入排曲'));
        const ev = j.event || {};
        setEvent({ name: String(ev.name ?? ''), time: String(ev.time ?? ''), location: String(ev.location ?? ''), host: String(ev.host ?? ''), note: String(ev.note ?? '') });
        Toast.success(`已导入 ${list.length} 首`);
      } catch (e) {
        Toast.error('文件格式不正确：' + (e as Error).message);
      }
    };
    reader.readAsText(f);
  }
  function loadSavedIntoEditor(id: string) {
    api<{ data: { songs: SetSong[]; name: string; event?: Record<string, string> } }>('/api/setlist/' + id).then((r) => {
      setGen(r.data.songs.map((x) => ({ ...x, playMs: x.playMs ?? null })));
      setSetlistName(r.data.name || '');
      const ev = r.data.event || {};
      setEvent({ name: String(ev.name ?? ''), time: String(ev.time ?? ''), location: String(ev.location ?? ''), host: String(ev.host ?? ''), note: String(ev.note ?? '') });
    });
  }
  function openLogin() {
    setLoginOpen(true);
    setQr(null);
    startQr('qq');
  }
  function startQr(type: 'qq' | 'wx') {
    post<{ token: string; image: string }>('/api/auth/qr/start', { type })
      .then((r) => {
        setQr(r);
        setQrState('pending');
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = window.setInterval(() => {
          api<{ state: string; user?: any }>(`/api/auth/qr/check?type=${type}&token=${encodeURIComponent(r.token)}`)
            .then((st) => {
              setQrState(st.state);
              if (st.state === 'confirmed') {
                if (pollRef.current) window.clearInterval(pollRef.current);
                setUser(st.user);
                setLoginOpen(false);
                Toast.success('登录成功：' + ((st.user && (st.user.nickname || st.user.uin)) || ''));
              } else if (st.state === 'expired' && pollRef.current) window.clearInterval(pollRef.current);
            })
            .catch(() => {});
        }, 2000);
      })
      .catch((e) => Toast.error('获取二维码失败：' + e.message));
  }
  function logout() {
    post('/api/auth/logout', {}).then(() => {
      setUser(null);
      Toast.info('已退出');
    }).catch(() => {});
  }

  const typeOptions = useMemo(
    () => types.filter((t) => t.type !== '__liked__').map((t) => ({ label: `${t.type}（${t.count}）`, value: t.type })),
    [types],
  );
  const libFilterOptions = useMemo(() => {
    const liked = types.find((t) => t.type === '__liked__');
    const head = liked ? [{ label: `我喜欢（${liked.count}）`, value: '__liked__' }] : [];
    return [...head, ...typeOptions];
  }, [types, typeOptions]);
  const orderArr = useMemo(() => orderText.split(/[\s,，、→>/-]+/).filter(Boolean), [orderText]);

  function SongRow({ s, list, onAdd }: { s: LibrarySong | Song; list: Array<LibrarySong | Song>; onAdd?: () => void }) {
    const isLib = 'type' in s;
    const lib = s as LibrarySong;
    return (
      <div className="song">
        {s.coverUrl ? <img className="song-cover" src={s.coverUrl} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} /> : <div className="song-cover" />}
        <div className="song-main">
          <div className="song-name">{s.name}</div>
          <div className="song-sub">
            {(s.artists || []).join(' / ')}
            {albumName(s) ? ' · ' + albumName(s) : ''}
          </div>
        </div>
        <div className="song-meta">
          {isLib ? <span className="chip chip-gold">{lib.type}</span> : null}
          {isLib && lib.source && lib.source !== 'qqmusic' ? (
            <span className="chip chip-src" title={'来源：' + (SOURCE_LABELS[lib.source] || lib.source)}>
              {SOURCE_LABELS[lib.source] || lib.source}
            </span>
          ) : null}
          {isLib && lib.mood ? <span className={'chip ' + (lib.mood === '欢快' ? 'chip-lively' : lib.mood === '舒缓' ? 'chip-mellow' : 'chip-mid')}>{lib.mood}</span> : null}
          {isLib && lib.suitable === false ? <span className="chip chip-warn" title={lib.warning || '节奏不稳，可能不适合作为舞曲'}>不适合舞曲</span> : null}
          {isLib && lib.file ? <span className="chip chip-green">已缓存</span> : null}
          {isLib && lib.bpm ? <span className="bpm">{lib.bpm} BPM</span> : null}
          {s.durationMs ? <span className="bpm">{mmss(s.durationMs)}</span> : null}
        </div>
        <div className="song-actions">
          <IconBtn title="播放" onClick={() => play(s, list)}>
            <IPlay />
          </IconBtn>
          {onAdd ? (
            <IconBtn title="加入曲库" onClick={onAdd}>
              <IPlus />
            </IconBtn>
          ) : null}
          {isLib ? (
            <>
              <IconBtn title="编辑" onClick={() => openEdit(lib)}>
                <IEdit />
              </IconBtn>
              <IconBtn title="移除" danger onClick={() => removeSong(lib)}>
                <ITrash />
              </IconBtn>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">♪</span>舞曲排曲台
        </div>
        <div className="top-actions">
          <Button theme="borderless" size="small" onClick={toggleTheme} title="切换明/暗主题">
            {theme === 'dark' ? '☀ 浅色' : '☾ 深色'}
          </Button>
          <Button theme="borderless" size="small" onClick={() => { loadSettings(); setSettingsOpen(true); }}>
            设置
          </Button>
          {user ? (
            <div className="user-chip">
              <span className="avatar">{(user.nickname || user.uin || '?').slice(0, 1)}</span>
              <span>{user.nickname || user.uin}</span>
              <Button theme="borderless" size="small" onClick={logout}>
                退出
              </Button>
            </div>
          ) : (
            <Button theme="solid" type="primary" onClick={openLogin}>
              连接 QQ 音乐
            </Button>
          )}
        </div>
      </div>

      <div className="content">
        {task && task.status === 'running' ? (
          <div className="taskbar">
            <Progress percent={task.total ? Math.round(((task.done + task.failed) / task.total) * 100) : 100} showInfo={false} stroke="var(--gold)" />
            <span className="hint">
              {kindLabel(task.kind)}中 {task.done + task.failed}/{task.total}（失败 {task.failed}）
            </span>
          </div>
        ) : null}

        <Tabs type="button" activeKey={activeTab} onChange={(k) => setActiveTab(k as string)}>
          <TabPane tab="曲库" itemKey="lib">
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">默认曲库</span>
                <div className="panel-actions">
                  <span className="hint">
                    {songs.filter((s) => s.file).length} / {songs.length} 已缓存
                  </span>
                  <Select value={activeType} onChange={(v) => setActiveType(v as string)} style={{ width: 170 }} optionList={libFilterOptions} />
                  <Button onClick={cacheMissing}>缓存缺失音频</Button>
                  <Button theme="solid" type="tertiary" onClick={autoClassify}>
                    自动分类
                  </Button>
                  <Button onClick={cacheClassify}>缓存并分类</Button>
                  <Button onClick={importLiked}>导入「我喜欢」</Button>
                </div>
              </div>
              {songs.length ? (
                <div className="songlist">
                  {songs.map((s) => (
                    <SongRow key={s.mid} s={s} list={songs} />
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <div className="empty-ico">
                    <INote />
                  </div>
                  暂无曲目，管理员端导入歌单后即可在此浏览
                </div>
              )}
            </div>
          </TabPane>

          <TabPane tab="搜索" itemKey="search">
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">搜索</span>
                <div className="panel-actions">
                  <Select
                    value={searchSource}
                    onChange={(v) => setSearchSource(v as 'qqmusic' | 'netease')}
                    style={{ width: 130 }}
                    optionList={[
                      { value: 'qqmusic', label: 'QQ音乐' },
                      { value: 'netease', label: '网易云音乐' },
                    ]}
                  />
                  <Input value={kw} onChange={setKw} onEnterPress={doSearch} placeholder="歌曲 / 歌手" style={{ width: 250 }} />
                  <Select allowCreate value={addType} onChange={(v) => setAddType(v as string)} style={{ width: 130 }} optionList={typeOptions} placeholder="加入舞种" />
                  <Button theme="solid" type="primary" onClick={doSearch} loading={loadingSearch}>
                    搜索
                  </Button>
                </div>
              </div>
              {results.length ? (
                <div className="songlist">
                  {results.map((s) => (
                    <SongRow key={s.mid} s={s} list={results} onAdd={() => addSearchResult(s)} />
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <div className="empty-ico">
                    <INote />
                  </div>
                  输入关键词搜索，点结果右侧「+」加入曲库
                </div>
              )}
            </div>
          </TabPane>

          <TabPane tab="导入来源" itemKey="imp">
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">导入来源</span>
                <div className="panel-actions">
                  <Select
                    value={importSource}
                    onChange={(v) => setImportSource(v as 'qqmusic' | 'netease' | 'local' | 'http' | 'pan')}
                    style={{ width: 160 }}
                    optionList={SOURCE_OPTIONS}
                  />
                  <Select allowCreate value={importType} onChange={(v) => setImportType(v as string)} style={{ width: 150 }} optionList={typeOptions} placeholder="目标舞种" />
                </div>
              </div>

              {importSource === 'qqmusic' ? (
                <div className="panel-actions" style={{ marginBottom: 10 }}>
                  <Input value={importUrl} onChange={setImportUrl} placeholder="QQ 音乐歌单链接 / 分享短链" style={{ width: 340 }} />
                  <Button theme="solid" type="primary" onClick={importToLibrary} loading={importing}>
                    导入到曲库
                  </Button>
                  <Button onClick={doImport} loading={loadingImport}>
                    解析预览
                  </Button>
                  <Button theme="borderless" onClick={doClone} loading={cloning}>
                    克隆到我的歌单
                  </Button>
                </div>
              ) : null}

              {importSource === 'netease' ? (
                <div className="panel-actions" style={{ marginBottom: 10 }}>
                  <Input value={neInput} onChange={setNeInput} placeholder="网易云歌单/单曲链接或 ID" style={{ width: 420 }} />
                  <Button theme="solid" type="primary" onClick={importNetease}>
                    导入到曲库
                  </Button>
                </div>
              ) : null}

              {importSource === 'local' ? (
                <div className="panel-actions" style={{ marginBottom: 10 }}>
                  <Input value={localDir} onChange={setLocalDir} placeholder="本机文件夹，如 D:\\舞曲库" style={{ width: 360 }} />
                  <RadioGroup value={localRec ? 1 : 0} onChange={(e) => setLocalRec(Number(e.target.value) === 1)}>
                    <Radio value={1}>含子目录</Radio>
                    <Radio value={0}>仅本级</Radio>
                  </RadioGroup>
                  <Button theme="solid" type="primary" onClick={importLocal}>
                    扫描入库
                  </Button>
                </div>
              ) : null}

              {importSource === 'http' ? (
                <div className="urls-box">
                  <textarea className="urls-input" value={httpUrls} onChange={(e) => setHttpUrls(e.target.value)} placeholder="每行一个音频直链 URL（自建服务器/对象存储）" rows={4} />
                  <Button theme="solid" type="primary" onClick={importHttp}>
                    导入到曲库
                  </Button>
                </div>
              ) : null}

              {importSource === 'pan' ? (
                <div className="panel-actions" style={{ marginBottom: 10 }}>
                  <Input value={panShare} onChange={setPanShare} placeholder="百度网盘分享链接 https://pan.baidu.com/s/1..." style={{ width: 360 }} />
                  <Input value={panPwd} onChange={setPanPwd} placeholder="提取码（可选）" style={{ width: 120 }} />
                  <Button theme="solid" type="primary" onClick={importPan}>
                    导入到曲库
                  </Button>
                </div>
              ) : null}

              <div className="hint" style={{ marginBottom: 10 }}>
                {importSource === 'qqmusic' && 'QQ：歌单链接导入到默认曲库，可后台缓存；「克隆」写回你的 QQ 账号（需登录）。'}
                {importSource === 'netease' && '网易云：歌单/单曲链接或 ID，导入后播放时再缓存（部分歌需在设置里配 neteaseCookie）。'}
                {importSource === 'local' && '本地/社团文件夹：按《规则》文件名「舞种-歌名-歌手」扫描入库，文件保持原位。'}
                {importSource === 'http' && '自建直链：每行一个音频 URL，播放时下载并转 mp3。'}
                {importSource === 'pan' && '百度网盘：需在设置里配 baiduCookie(BDUSS)，解析分享后按文件名入库，播放时再解析直链。'}
              </div>

              {importSource === 'qqmusic' && importPreview ? (
                <>
                  <div className="hint" style={{ marginBottom: 10 }}>
                    {importPreview.name} · 共 {importPreview.songCount} 首（预览 {importPreview.songs.length}）
                  </div>
                  <div className="songlist">
                    {importPreview.songs.map((s) => (
                      <SongRow key={s.mid} s={s} list={importPreview.songs} />
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </TabPane>

          <TabPane tab="排曲" itemKey="setlist">
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">排曲设置</span>
              </div>
              <div className="toolbar">
                <Text>目标时长</Text>
                <InputNumber value={durationMin} min={10} max={600} step={10} onChange={(v) => setDurationMin(Number(v) || 120)} style={{ width: 92 }} />
                <Text type="tertiary">分钟</Text>
                <div className="spacer" />
                <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as any)}>
                  <Radio value="weighted">随机打乱</Radio>
                  <Radio value="sequential">严格顺序</Radio>
                </RadioGroup>
              </div>
              <div className="weights">
                {types.map((t) => (
                  <div className="weight-row" key={t.type}>
                    <span className="weight-label">{t.type}</span>
                    <Slider value={weights[t.type] ?? 1} min={0} max={1} step={0.1} style={{ width: 150 }} onChange={(v) => setWeights((w) => ({ ...w, [t.type]: Number(v) }))} />
                    <span className="hint">{(weights[t.type] ?? 1).toFixed(1)}</span>
                  </div>
                ))}
              </div>
              <div className="toolbar" style={{ marginBottom: 0 }}>
                <Text>类型顺序</Text>
                <Input value={orderText} onChange={setOrderText} style={{ width: 380 }} />
                <span className="hint">集体舞开场，按此顺序循环出歌（优先规则）</span>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">当前排曲</span>
                <div className="panel-actions">
                  <Button theme="solid" type="primary" onClick={doGenerate} loading={generating}>
                    生成排曲
                  </Button>
                  <Button onClick={shuffleGen} disabled={!gen.length}>
                    一键乱序
                  </Button>
                  <Button onClick={groupGen} disabled={!gen.length}>
                    按舞种归组
                  </Button>
                  <Button onClick={() => openPlayer(gen, 0)} disabled={!gen.length}>
                    播放全部
                  </Button>
                  <Button theme="solid" type="tertiary" onClick={() => openWall(gen)} disabled={!gen.length}>
                    大屏播放
                  </Button>
                </div>
              </div>

              {gen.length ? (
                <>
                  <div className="hint" style={{ marginBottom: 10 }}>
                    共 {gen.length} 首 · 总时长 {fmt(totalOf(gen))}（拖拽 ⠿ 调顺序，「秒」列裁剪单曲时长）
                  </div>
                  <div className="setlist-editor">
                    {gen.map((s, i) => (
                      <div
                        className={`set-row${dragIndex === i ? ' dragging' : ''}`}
                        key={s.mid}
                        draggable
                        onDragStart={() => setDragIndex(i)}
                        onDragEnd={() => setDragIndex(null)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragIndex !== null && dragIndex !== i) moveGen(dragIndex, i);
                          setDragIndex(null);
                        }}
                      >
                        <span className="drag">⠿</span>
                        <span className="idx">{i + 1}</span>
                        <div className="set-main">
                          <div className="song-name">{s.name}</div>
                          <div className="song-sub">
                            {s.type ? <span className="chip chip-gold" style={{ marginRight: 6 }}>{s.type}</span> : null}
                            {s.artists.join(' / ')} · 原 {mmss(s.durationMs)}
                          </div>
                        </div>
                        <InputNumber size="small" value={Math.round(eff(s.durationMs, s.playMs) / 1000)} min={5} max={Math.round((s.durationMs || 0) / 1000)} step={5} style={{ width: 92 }} onChange={(v) => trimGen(s.mid, Number(v) * 1000)} />
                        <span className="hint">秒</span>
                        <IconBtn title="试听" onClick={() => openPlayer([s], 0)}>
                          <IPlay />
                        </IconBtn>
                        <IconBtn title="移除" danger onClick={() => removeGen(s.mid)}>
                          <ITrash />
                        </IconBtn>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty">
                  <div className="empty-ico">
                    <INote />
                  </div>
                  点「生成排曲」按舞种权重生成，或从曲库点播放
                </div>
              )}
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">舞会信息 & 导出</span>
                <div className="panel-actions">
                  <Input value={setlistName} onChange={setSetlistName} placeholder="排曲名称" style={{ width: 160 }} />
                  <Button onClick={saveGen} disabled={!gen.length}>
                    保存排曲
                  </Button>
                  <Button onClick={exportImage} disabled={!gen.length}>
                    导出长图
                  </Button>
                  <Button onClick={exportFile} disabled={!gen.length}>
                    导出文件
                  </Button>
                  <Button onClick={() => fileRef.current?.click()}>导入文件</Button>
                  <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ''; }} />
                </div>
              </div>
              <div className="toolbar" style={{ marginBottom: 0 }}>
                <Input value={event.name} onChange={(v) => setEvent((e) => ({ ...e, name: v }))} placeholder="舞会名称" style={{ width: 200 }} />
                <Input value={event.time} onChange={(v) => setEvent((e) => ({ ...e, time: v }))} placeholder="时间" style={{ width: 190 }} />
                <Input value={event.location} onChange={(v) => setEvent((e) => ({ ...e, location: v }))} placeholder="地点" style={{ width: 220 }} />
                <Input value={event.host} onChange={(v) => setEvent((e) => ({ ...e, host: v }))} placeholder="主办/联系" style={{ width: 150 }} />
                <Input value={event.note} onChange={(v) => setEvent((e) => ({ ...e, note: v }))} placeholder="备注" style={{ width: 150 }} />
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">已保存的排曲</span>
              </div>
              {savedLists.length ? (
                <List
                  dataSource={savedLists}
                  renderItem={(s) => (
                    <List.Item
                      key={s.id}
                      main={
                        <div>
                          <div className="song-name">{s.name}</div>
                          <div className="song-sub">
                            {s.count} 首 · {fmt(s.totalMs)}
                          </div>
                        </div>
                      }
                      extra={
                        <div className="song-actions">
                          <IconBtn title="播放" onClick={() => api<{ data: SetSong[] }>('/api/setlist/' + s.id).then((r) => openPlayer(r.data, 0))}>
                            <IPlay />
                          </IconBtn>
                          <IconBtn title="编辑" onClick={() => loadSavedIntoEditor(s.id)}>
                            <IEdit />
                          </IconBtn>
                          <IconBtn title="删除" danger onClick={() => api('/api/setlist/' + s.id, { method: 'DELETE' }).then(() => { Toast.info('已删除'); loadSetlists(); })}>
                            <ITrash />
                          </IconBtn>
                        </div>
                      }
                    />
                  )}
                />
              ) : (
                <div className="empty">
                  <div className="empty-ico">
                    <INote />
                  </div>
                  还没有保存的排曲
                </div>
              )}
            </div>
          </TabPane>
        </Tabs>
      </div>

      <Modal title="编辑歌曲" visible={editOpen} onOk={saveEdit} onCancel={() => setEditOpen(false)} okText="保存" width={440}>
        <div className="settings-form">
          <div className="field">
            <span>歌名</span>
            <Input value={editForm.name} onChange={(v) => setEditForm((f) => ({ ...f, name: v }))} />
          </div>
          <div className="field">
            <span>歌手（/ 或 、分隔）</span>
            <Input value={editForm.artists} onChange={(v) => setEditForm((f) => ({ ...f, artists: v }))} />
          </div>
          <div className="field">
            <span>舞种</span>
            <Select allowCreate value={editForm.type} onChange={(v) => setEditForm((f) => ({ ...f, type: v as string }))} style={{ width: 200 }} optionList={typeOptions} />
          </div>
          <div className="field">
            <span>适合当舞曲</span>
            <RadioGroup
              value={editForm.suitable === false ? 0 : 1}
              onChange={(e) => setEditForm((f) => ({ ...f, suitable: Number(e.target.value) === 1 }))}
            >
              <Radio value={1}>适合</Radio>
              <Radio value={0}>不适合（节奏不稳/散拍）</Radio>
            </RadioGroup>
          </div>
          {editForm.bpm ? (
            <div className="hint">
              自动分析：{editForm.bpm} BPM · {editForm.meter}
              {editForm.mood ? ' · 曲风 ' + editForm.mood : ''}
              {editForm.energy != null ? '（能量 ' + editForm.energy + '）' : ''}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal title="设置（管理员）" visible={settingsOpen} footer={null} width={480} onCancel={() => setSettingsOpen(false)}>
        <div className="settings-form">
          <div className="field">
            <span>管理员口令</span>
            <Input value={adminTokenState} onChange={setAdminTokenState} placeholder="config.json 里的 adminToken" />
          </div>
          <div className="field">
            <span>音频缓存目录</span>
            <Input value={settings.mediaDir} onChange={(v) => setSettings((s) => ({ ...s, mediaDir: v }))} placeholder="如 D:\\music-cache 或 data/media" />
          </div>
          <div className="field">
            <span>缓存音质</span>
            <Select value={settings.mediaQuality} onChange={(v) => setSettings((s) => ({ ...s, mediaQuality: v as string }))} style={{ width: 200 }} optionList={[{ value: '320', label: 'HQ（320k mp3）' }, { value: '128', label: '标准（128k mp3）' }, { value: 'flac', label: 'SQ 无损（下载后转 mp3）' }, { value: 'ape', label: 'ape（下载后转 mp3）' }, { value: 'm4a', label: 'm4a（下载后转 mp3）' }]} />
          </div>
          <div className="field">
            <span>缓存上限（GB）</span>
            <InputNumber
              value={Math.round((settings.cacheLimitBytes / (1024 * 1024 * 1024)) * 10) / 10}
              min={0}
              step={1}
              style={{ width: 160 }}
              onChange={(v) => setSettings((s) => ({ ...s, cacheLimitBytes: Math.max(0, Number(v) || 0) * 1024 * 1024 * 1024 }))}
            />
            <span className="hint" style={{ marginLeft: 8 }}>超出后自动淘汰最久未播放的（0 = 不限）</span>
          </div>
          {usage ? (
            <div className="hint">
              当前缓存：{(usage.bytes / 1024 / 1024 / 1024).toFixed(2)} GB / {settings.cacheLimitBytes > 0 ? (settings.cacheLimitBytes / 1024 / 1024 / 1024).toFixed(0) + ' GB' : '不限'}（{usage.files} 个文件）
            </div>
          ) : null}
          <div className="field">
            <span>导入/播放时自动缓存</span>
            <RadioGroup value={settings.autoDownload ? 1 : 0} onChange={(e) => setSettings((s) => ({ ...s, autoDownload: Number(e.target.value) === 1 }))}>
              <Radio value={1}>开</Radio>
              <Radio value={0}>关</Radio>
            </RadioGroup>
          </div>
          <div className="field">
            <span>缓存后自动识别舞种</span>
            <RadioGroup value={settings.autoClassify ? 1 : 0} onChange={(e) => setSettings((s) => ({ ...s, autoClassify: Number(e.target.value) === 1 }))}>
              <Radio value={1}>开（仅「未分类」）</Radio>
              <Radio value={0}>关</Radio>
            </RadioGroup>
          </div>
          <div className="field">
            <span>网易云 Cookie</span>
            <Input value={settings.neteaseCookie} onChange={(v) => setSettings((s) => ({ ...s, neteaseCookie: v }))} placeholder="MUSIC_U=...（提升网易云播放成功率）" />
          </div>
          <div className="field">
            <span>百度网盘 Cookie</span>
            <Input value={settings.baiduCookie} onChange={(v) => setSettings((s) => ({ ...s, baiduCookie: v }))} placeholder="BDUSS=...; STOKEN=...（网盘分享/下载用）" />
          </div>
          <Button theme="solid" type="primary" onClick={saveSettings}>
            保存
          </Button>
          <div className="hint">保存后立即生效；已缓存的旧文件不会自动搬移。</div>

          <div className="divider" />
          <div className="field-title">按文件名校准舞种</div>
          <div className="hint">文件需按《HBDC 规则》命名：舞种-歌曲名-歌手（如「吉特巴-火花-格格」）。匹配到曲库的曲目会直接改用文件名里的舞种。</div>
          <div className="field">
            <span>舞曲文件夹</span>
            <Input value={calibDir} onChange={setCalibDir} placeholder="如 D:\\舞曲库（本机路径）" />
          </div>
          <div className="field">
            <span>递归子目录</span>
            <RadioGroup value={calibRecursive ? 1 : 0} onChange={(e) => setCalibRecursive(Number(e.target.value) === 1)}>
              <Radio value={1}>是</Radio>
              <Radio value={0}>否</Radio>
            </RadioGroup>
          </div>
          <div className="field">
            <span>未匹配的加入曲库</span>
            <RadioGroup value={calibAddMissing ? 1 : 0} onChange={(e) => setCalibAddMissing(Number(e.target.value) === 1)}>
              <Radio value={1}>是（用本地文件播放）</Radio>
              <Radio value={0}>否</Radio>
            </RadioGroup>
          </div>
          <div className="field">
            <span>仅试运行</span>
            <RadioGroup value={calibDryRun ? 1 : 0} onChange={(e) => setCalibDryRun(Number(e.target.value) === 1)}>
              <Radio value={1}>是（不改动）</Radio>
              <Radio value={0}>否（写入）</Radio>
            </RadioGroup>
          </div>
          <Button theme="solid" loading={calibLoading} onClick={runCalibrate}>
            开始校准
          </Button>
          {calibReport ? (
            <div className="calib-report">
              <div>
                扫描 {calibReport.scanned} 个（音频 {calibReport.audio}）· 匹配 {calibReport.matched} · 改舞种 {calibReport.updated} · 未变 {calibReport.unchanged} · 新增 {calibReport.added}
              </div>
              {calibReport.unmatched.length ? (
                <div className="calib-sub">
                  未匹配 {calibReport.unmatched.length} 首：{calibReport.unmatched.slice(0, 8).map((u) => `${u.type}-${u.name}`).join('、')}
                  {calibReport.unmatched.length > 8 ? ' …' : ''}
                </div>
              ) : null}
              {calibReport.unparsed.length ? (
                <div className="calib-sub">文件名不合规 {calibReport.unparsed.length} 个（示例：{calibReport.unparsed.slice(0, 3).map((p) => p.split(/[\\/]/).pop()).join('、')}）</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal title="连接 QQ 音乐" visible={loginOpen} footer={null} width={372} onCancel={() => setLoginOpen(false)}>
        <div style={{ textAlign: 'center' }}>
          {qr ? (
            <>
              <img src={qr.image} style={{ width: 210, height: 210, borderRadius: 12 }} />
              <div className="hint" style={{ marginTop: 10 }}>
                {qrState === 'scanned' ? '已扫码，请在手机上确认' : qrState === 'expired' ? '二维码已过期，请重新获取' : '请用 QQ 扫码登录'}
              </div>
              <div style={{ marginTop: 14 }}>
                <Button size="small" onClick={() => startQr('qq')}>
                  QQ 码
                </Button>
                <Button size="small" style={{ marginLeft: 8 }} onClick={() => startQr('wx')}>
                  微信码
                </Button>
              </div>
            </>
          ) : (
            <div style={{ padding: 44 }}>加载中…</div>
          )}
        </div>
      </Modal>

      {/* 导出长图用的海报（离屏渲染） */}
      <div className="poster-wrap" ref={posterRef}>
        <div className="poster-event">{event.name || '舞会歌单'}</div>
        <div className="poster-meta">{[event.time, event.location].filter(Boolean).join('   ·   ')}</div>
        <div className="poster-sub">
          {setlistName ? `排曲：${setlistName}` : ''}
          {event.host ? `${setlistName ? '   ·   ' : ''}主办：${event.host}` : ''}
        </div>
        <div className="poster-divider" />
        <ol className="poster-list">
          {gen.map((s, i) => (
            <li key={s.mid + i}>
              <span className="p-idx">{String(i + 1).padStart(2, '0')}</span>
              <span className="p-name">{s.name}</span>
              <span className="p-art">{(s.artists || []).join(' / ')}</span>
              <span className="p-type">{s.type}</span>
              <span className="p-dur">{mmss(eff(s.durationMs, s.playMs))}</span>
            </li>
          ))}
        </ol>
        <div className="poster-foot">
          共 {gen.length} 首 · 总时长 {fmt(totalOf(gen))}
          {event.note ? `   ·   ${event.note}` : ''}
        </div>
      </div>
    </div>
  );
}
