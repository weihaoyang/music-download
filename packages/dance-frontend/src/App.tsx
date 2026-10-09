import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
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
import QRCode from 'qrcode';
import { adminFetch, api, post, getAdminToken, setAdminToken, setQueue as storeQueue, getTheme, setTheme, type ThemeMode, type LibrarySong, type Song, type TaskItem } from './api';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

type SetSong = LibrarySong & { playMs?: number | null };
type GenIssue = { level: 'warn' | 'info'; code: string; message: string; index?: number };
const DEFAULT_ORDER = ['集体舞', '慢四', '吉特巴', '慢三', '平四', '并四', '伦巴', '快三'];

function fmt(ms: number): string {
  return `${Math.round((ms || 0) / 60000)} 分`;
}
function fmtBytes(n: number): string {
  if (!n) return '0';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
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
const IDownload = () => (
  <svg viewBox="0 0 24 24">
    <path d="M11 3h2v8h3.5L12 15.5 7.5 11H11V3zM5 19h14v2H5z" />
  </svg>
);
const IScissors = () => (
  <svg viewBox="0 0 24 24">
    <path d="M9.6 6.5a3 3 0 1 0-1.3 2.5L10.6 11l-2.3 2a3 3 0 1 0 1.3 2.5l2-1.8 6.5 5.3v-2.4l-5.1-4.1 5.1-4.1V6l-6.5 5.3-2-1.8zM6 5.5A1.5 1.5 0 1 1 6 8.5 1.5 1.5 0 0 1 6 5.5zm0 10a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
  </svg>
);
const SOURCE_LABELS: Record<string, string> = {
  qqmusic: 'QQ音乐',
  netease: '网易云',
  local: '本地',
  http: '直链',
};
const SOURCE_OPTIONS = [
  { value: 'qqmusic', label: 'QQ音乐' },
  { value: 'netease', label: '网易云音乐' },
  { value: 'local', label: '本地/社团文件夹' },
  { value: 'http', label: '自建服务器直链' },
];

function IconBtn({ title, danger, onClick, children }: { title: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`iconbtn${danger ? ' danger' : ''}`} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function StatBars({ title, items }: { title: string; items: Array<{ label: string; value: number; sub?: string }> }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="status-card">
      <div className="sc-title">{title}</div>
      <div className="stat-bars">
        {items.length ? (
          items.map((it) => (
            <div className="stat-row" key={it.label}>
              <span className="stat-label" title={it.label}>
                {it.label}
              </span>
              <span className="stat-track">
                <span className="stat-fill" style={{ width: Math.round((it.value / max) * 100) + '%' }} />
              </span>
              <span className="stat-val">
                {it.value}
                {it.sub ? ' · ' + it.sub : ''}
              </span>
            </div>
          ))
        ) : (
          <div className="hint">暂无数据</div>
        )}
      </div>
    </div>
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
  const [srcDefs, setSrcDefs] = useState<Array<{ id: string; label: string; search: boolean }>>([]);
  const [searchSources, setSearchSources] = useState<string[]>([]);
  const [hideInLib, setHideInLib] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);

  const [importUrl, setImportUrl] = useState('');
  const [importPreview, setImportPreview] = useState<{ name: string; songCount: number; songs: Song[] } | null>(null);
  const [importName, setImportName] = useState('');
  const [importType, setImportType] = useState('未分类');
  const [importing, setImporting] = useState(false);

  // 多来源
  const [searchSource, setSearchSource] = useState<'all' | 'qqmusic' | 'netease'>('all');
  const [addType, setAddType] = useState('未分类');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [libPage, setLibPage] = useState(0);
  const [libSort, setLibSort] = useState('default');
  const [selectedMids, setSelectedMids] = useState<Set<string>>(new Set());
  const [batchType, setBatchType] = useState('');
  const [importSource, setImportSource] = useState<'qqmusic' | 'netease' | 'local' | 'http'>('qqmusic');
  const [neInput, setNeInput] = useState('');
  const [localDir, setLocalDir] = useState('');
  const [localRec, setLocalRec] = useState(true);
  const [httpUrls, setHttpUrls] = useState('');
  const [loadingImport, setLoadingImport] = useState(false);
  const [cloning, setCloning] = useState(false);

  const [durationMin, setDurationMin] = useState(120);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [orderText, setOrderText] = useState(DEFAULT_ORDER.join(' '));
  const [mode, setMode] = useState<'weighted' | 'sequential'>('weighted');
  const [autoTrim, setAutoTrim] = useState(true);
  const [alloc, setAlloc] = useState<Array<{ type: string; count: number; ms: number }>>([]);
  const [setlistName, setSetlistName] = useState('');
  const [gen, setGen] = useState<SetSong[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [savedLists, setSavedLists] = useState<Array<{ id: string; name: string; count: number; totalMs: number }>>([]);
  const [generating, setGenerating] = useState(false);
  const [genIssues, setGenIssues] = useState<GenIssue[]>([]);
  const [libStats, setLibStats] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<Array<{ mid: string; name: string; artists: string[]; type: string; coverUrl?: string | null; at: number }>>([]);
  const [dups, setDups] = useState<Array<Array<{ mid: string; name: string; artists: string[]; type: string; source: string; file: boolean; durationMs: number }>> | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [clipOpen, setClipOpen] = useState(false);
  const [clipForm, setClipForm] = useState<{ mid: string; name: string; startS: number; endS: number }>({ mid: '', name: '', startS: 0, endS: 0 });
  const [reqs, setReqs] = useState<Array<{ id: string; name: string; artists: string[]; mid?: string | null; requester?: string | null; note?: string | null; status: string }>>([]);
  const [reqStats, setReqStats] = useState<{ active: number; totalLimit: number; perRequesterLimit: number } | null>(null);
  const [reqPopular, setReqPopular] = useState<Array<{ name: string; artists: string[]; count: number; type?: string | null }>>([]);
  const [reqQr, setReqQr] = useState('');

  const [user, setUser] = useState<{ uin: string; nickname?: string | null; vip?: boolean } | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [qr, setQr] = useState<{ token: string; image: string } | null>(null);
  const [qrState, setQrState] = useState('');
  const pollRef = useRef<number | null>(null);
  const [neLoginOpen, setNeLoginOpen] = useState(false);
  const [neQrImg, setNeQrImg] = useState('');
  const [neState, setNeState] = useState('');
  const nePollRef = useRef<number | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [adminTokenState, setAdminTokenState] = useState(getAdminToken());
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [settings, setSettings] = useState<{ mediaDir: string; mediaQuality: string; autoDownload: boolean; cacheLimitBytes: number; autoClassify: boolean; neteaseCookie: string }>({ mediaDir: '', mediaQuality: '320', autoDownload: true, cacheLimitBytes: 20 * 1024 * 1024 * 1024, autoClassify: true, neteaseCookie: '' });
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
  const [editForm, setEditForm] = useState<{ mid: string; name: string; artists: string; type: string; bpm: number | null; meter: string | null; energy: number | null; mood: string | null; suitable: boolean | null; rights: 'external' | 'club'; edited: boolean }>({ mid: '', name: '', artists: '', type: '', bpm: null, meter: null, energy: null, mood: null, suitable: null, rights: 'external', edited: false });

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
  function loadStatus() {
    api('/api/status').then((r) => setStatus(r as unknown)).catch(() => {});
  }
  function loadStats() {
    api<{ data: any }>('/api/library/stats')
      .then((r) => setLibStats(r.data))
      .catch(() => {});
  }
  function loadHistory() {
    api<{ data: typeof history }>('/api/history?limit=200')
      .then((r) => setHistory(r.data || []))
      .catch(() => {});
  }
  function clearHistory() {
    setAdminToken(adminTokenState);
    adminFetch('/api/history', 'DELETE')
      .then(() => {
        setHistory([]);
        Toast.success('已清空播放历史');
      })
      .catch((e) => Toast.error('清空失败：' + e.message));
  }
  function loadRequests() {
    api<{ data: typeof reqs; stats: typeof reqStats; popular: typeof reqPopular }>('/api/requests')
      .then((r) => {
        setReqs(r.data || []);
        setReqStats(r.stats);
        setReqPopular(r.popular || []);
      })
      .catch(() => {});
    if (!reqQr) QRCode.toDataURL(window.location.origin + '/request', { width: 200, margin: 1 }).then(setReqQr).catch(() => {});
  }
  function setReqStatus(id: string, status: string) {
    setAdminToken(adminTokenState);
    adminFetch('/api/requests/' + encodeURIComponent(id), 'POST', { status })
      .then(() => loadRequests())
      .catch((e) => Toast.error('操作失败：' + e.message));
  }
  function delReq(id: string) {
    setAdminToken(adminTokenState);
    adminFetch('/api/requests/' + encodeURIComponent(id), 'DELETE')
      .then(() => loadRequests())
      .catch((e) => Toast.error('操作失败：' + e.message));
  }
  /** 把一条点歌加入当前排曲（需该曲已在曲库） */
  async function requestToSetlist(r: { mid?: string | null; name: string }, silent = false): Promise<boolean> {
    if (!r.mid) {
      if (!silent) Toast.warning(`《${r.name}》没有曲库 ID，请先把它加入曲库`);
      return false;
    }
    try {
      const res = await api<{ data: LibrarySong }>('/api/library/song?mid=' + encodeURIComponent(r.mid));
      const song = res.data;
      setGen((g) => [...g, { ...song, playMs: null }]);
      if (!silent) Toast.success(`已把《${song.name}》加入排曲`);
      return true;
    } catch {
      if (!silent) Toast.warning(`曲库里没有《${r.name}》，请先把它加入曲库`);
      return false;
    }
  }
  async function addAcceptedToSetlist() {
    const acc = reqs.filter((r) => r.status === 'accepted');
    if (!acc.length) return Toast.warning('没有「已采纳」的点歌');
    let n = 0;
    for (const r of acc) if (await requestToSetlist(r, true)) n++;
    Toast.success(`已把 ${n}/${acc.length} 首加入排曲${n < acc.length ? '（其余曲库里没有，请先入库）' : ''}`);
  }
  function resetReqs() {
    setAdminToken(adminTokenState);
    Modal.confirm({
      title: '清空点歌',
      content: '确定清空本场点歌队列吗？（用于开始新一场舞会）',
      okText: '清空',
      cancelText: '取消',
      onOk: () =>
        adminFetch<{ cleared: number }>('/api/requests/reset', 'POST')
          .then((r) => {
            Toast.success(`已清空 ${r.cleared} 条`);
            loadRequests();
          })
          .catch((e) => Toast.error('失败：' + e.message)),
    });
  }
  function findDuplicates() {
    api<{ count: number; groups: Array<Array<{ mid: string; name: string; artists: string[]; type: string; source: string; file: boolean; durationMs: number }>> }>('/api/library/duplicates')
      .then((r) => {
        setDups(r.groups || []);
        setDupOpen(true);
        Toast.info(r.count ? `发现 ${r.count} 组重复曲目` : '没有发现重复');
      })
      .catch((e) => Toast.error('查重失败：' + e.message));
  }
  function keepOne(group: Array<{ mid: string }>, keepMid: string) {
    setAdminToken(adminTokenState);
    const del = group.filter((x) => x.mid !== keepMid);
    Promise.all(del.map((x) => adminFetch('/api/library/song?mid=' + encodeURIComponent(x.mid), 'DELETE')))
      .then(() => {
        Toast.success(`已保留 1 条，移除 ${del.length} 条重复`);
        findDuplicates();
        loadTypes();
        if (activeType) loadSongs(activeType);
      })
      .catch((e) => Toast.error('操作失败：' + e.message));
  }
  function loadSettings() {
    setAdminToken(adminTokenState);
    adminFetch<{ data: { mediaDir: string; mediaQuality: string; autoDownload: boolean; cacheLimitBytes: number; autoClassify: boolean; neteaseCookie: string } }>('/api/settings', 'GET')
      .then((r) => setSettings({ mediaDir: r.data.mediaDir, mediaQuality: r.data.mediaQuality, autoDownload: r.data.autoDownload, cacheLimitBytes: r.data.cacheLimitBytes ?? 20 * 1024 * 1024 * 1024, autoClassify: r.data.autoClassify !== false, neteaseCookie: r.data.neteaseCookie || '' }))
      .catch((e) => Toast.warning('读取设置失败（检查管理员口令）：' + e.message));
    adminFetch<{ data: { bytes: number; files: number; limit: number } }>('/api/media/usage', 'GET')
      .then((r) => setUsage(r.data))
      .catch(() => setUsage(null));
  }
  function saveSettings() {
    setAdminToken(adminTokenState);
    adminFetch('/api/settings', 'PUT', { mediaDir: settings.mediaDir, mediaQuality: settings.mediaQuality, autoDownload: settings.autoDownload, cacheLimitBytes: settings.cacheLimitBytes, autoClassify: settings.autoClassify, neteaseCookie: settings.neteaseCookie })
      .then(() => {
        Toast.success('设置已保存并生效');
        setSettingsOpen(false);
      })
      .catch((e) => Toast.error('保存失败：' + e.message));
  }
  function exportLibrary() {
    setAdminToken(adminTokenState);
    const tk = adminTokenState || getAdminToken();
    fetch('/api/backup/library', { headers: tk ? { 'x-admin-token': tk } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'dance-library-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        Toast.success('已导出曲库备份');
      })
      .catch((e) => Toast.error('导出失败：' + e.message));
  }
  function pickRestore() {
    restoreInputRef.current?.click();
  }
  function onRestoreFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let collections: unknown;
      try {
        const json = JSON.parse(String(reader.result)) as { collections?: unknown };
        collections = json.collections ?? json;
      } catch {
        Toast.error('不是有效的备份 JSON 文件');
        return;
      }
      Modal.confirm({
        title: restoreMode === 'replace' ? '替换整库？' : '合并导入？',
        content:
          restoreMode === 'replace'
            ? '将清空当前曲库并写入备份内容（磁盘上的音频缓存文件不受影响）。'
            : '只新增备份里当前曲库没有的曲目，其余保持不变。',
        okText: '确认',
        onOk: () => {
          setAdminToken(adminTokenState);
          return adminFetch<{ mode: string; replaced?: number; added?: number; skipped?: number }>('/api/restore/library', 'POST', { collections, mode: restoreMode })
            .then((r) => {
              Toast.success(restoreMode === 'replace' ? `已恢复：${r.replaced} 首` : `已合并：新增 ${r.added}，跳过 ${r.skipped}`);
              loadTypes();
            })
            .catch((err) => Toast.error('恢复失败：' + err.message));
        },
      });
    };
    reader.readAsText(f);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantLiked = params.get('liked');
    const wantType = params.get('type');
    const wantSource = params.get('source');
    if (wantSource) setSourceFilter(wantSource);
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
      if (nePollRef.current) window.clearInterval(nePollRef.current);
    };
  }, []);
  useEffect(() => {
    if (activeType) loadSongs(activeType);
  }, [activeType]);
  useEffect(() => {
    setLibPage(0);
  }, [activeType, sourceFilter, libSort]);
  useEffect(() => {
    setSelectedMids(new Set());
  }, [activeType]);
  useEffect(() => {
    if (activeTab === 'status') loadStatus();
    if (activeTab === 'status') loadHistory();
    if (activeTab === 'stats') loadStats();
    if (activeTab === 'requests') loadRequests();
  }, [activeTab]);
  // 可搜索来源（聚合搜索来源筛选用）
  useEffect(() => {
    api<{ data: Array<{ id: string; label: string; search: boolean }> }>('/api/sources')
      .then((r) => {
        const s = (r.data || []).filter((d) => d.search);
        setSrcDefs(s);
        setSearchSources((cur) => (cur.length ? cur : s.map((d) => d.id)));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!task || task.status === 'done') return;
    const timer = window.setInterval(() => {
      api<{ data: TaskItem }>('/api/tasks/' + task.id)
        .then((r) => {
          setTask(r.data);
          if (r.data.status === 'done') {
            const label = kindLabel(r.data.kind);
            const errs = (r.data as { errors?: Record<string, string> }).errors;
            const firstErr = errs ? Object.values(errs)[0] : '';
            if (r.data.failed > 0) Toast.warning(`${label}完成：成功 ${r.data.done}，失败 ${r.data.failed}${firstErr ? '（' + firstErr + '）' : ''}`);
            else Toast.success(`${label}完成：成功 ${r.data.done}，失败 ${r.data.failed}`);
            if (activeType) loadSongs(activeType);
            loadTypes();
          }
        })
        .catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [task, activeType]);

  type Playable = { mid: string; name: string; artists: string[]; coverUrl?: string | null; playMs?: number | null; type?: string; durationMs?: number; loudness?: number | null; bpm?: number | null; mood?: string | null };
  function openPlayer(songs2: Playable[], index = 0, route = '/play') {
    storeQueue(songs2.map((s) => ({ mid: s.mid, name: s.name, artists: s.artists, coverUrl: s.coverUrl, playMs: s.playMs ?? null, type: s.type, durationMs: s.durationMs, loudness: s.loudness ?? null, bpm: s.bpm ?? null, mood: s.mood ?? null })), index);
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
  function downloadBySource() {
    setAdminToken(adminTokenState);
    adminFetch<{ taskId: string; queued: number }>('/api/library/download', 'POST', { type: '', source: sourceFilter }).then((r) => {
      Toast.info(`已加入缓存队列：${r.queued} 首`);
      if (r.queued > 0) api<{ data: TaskItem }>('/api/tasks/' + r.taskId).then((t) => setTask(t.data)).catch(() => {});
    });
  }
  function clearBySource() {
    setAdminToken(adminTokenState);
    const label = (SOURCE_OPTIONS.find((o) => o.value === sourceFilter) || {}).label || sourceFilter;
    Modal.confirm({
      title: '清空该来源',
      content: `确定清空「${label}」来源的全部曲目吗？（连同其缓存文件；本地文件不会被删）`,
      okText: '清空',
      cancelText: '取消',
      onOk: () => {
        adminFetch<{ removed: number; purged: number }>('/api/library/delete-by-source', 'POST', { source: sourceFilter, purgeFiles: true })
          .then((r) => {
            Toast.success(`已清空「${label}」：${r.removed} 首（删除缓存 ${r.purged}）`);
            loadTypes();
            if (activeType) loadSongs(activeType);
          })
          .catch((e) => Toast.error('清空失败：' + e.message));
      },
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
    setEditForm({ mid: s.mid, name: s.name, artists: (s.artists || []).join(' / '), type: s.type, bpm: s.bpm ?? null, meter: s.meter ?? null, energy: s.energy ?? null, mood: s.mood ?? null, suitable: s.suitable ?? null, rights: s.provenance?.rights ?? 'external', edited: s.provenance?.edited ?? false });
    setEditOpen(true);
  }
  function saveEdit() {
    adminFetch('/api/library/song', 'PUT', {
      mid: editForm.mid,
      name: editForm.name,
      artists: editForm.artists.split(/[/、,，]/).map((x) => x.trim()).filter(Boolean),
      type: editForm.type,
      suitable: editForm.suitable,
      rights: editForm.rights,
      edited: editForm.edited,
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
  function openClip(s: LibrarySong) {
    setClipForm({ mid: s.mid, name: s.name, startS: 0, endS: Math.max(1, Math.round((s.durationMs || 0) / 1000)) });
    setClipOpen(true);
  }
  function doClip() {
    setAdminToken(adminTokenState);
    const startMs = Math.max(0, clipForm.startS) * 1000;
    const endMs = clipForm.endS > clipForm.startS ? clipForm.endS * 1000 : null;
    adminFetch('/api/library/clip', 'POST', { mid: clipForm.mid, startMs, endMs, name: clipForm.name })
      .then(() => {
        Toast.success('已生成剪辑版（该曲目播放版本已替换）');
        setClipOpen(false);
        loadTypes();
        if (activeType) loadSongs(activeType);
      })
      .catch((e) => Toast.error('剪辑失败：' + e.message));
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
  function toggleSelect(mid: string) {
    setSelectedMids((cur) => {
      const next = new Set(cur);
      if (next.has(mid)) next.delete(mid);
      else next.add(mid);
      return next;
    });
  }
  function batchChangeType() {
    const mids = [...selectedMids];
    if (!mids.length) return;
    if (!batchType) return Toast.warning('先选目标舞种');
    setAdminToken(adminTokenState);
    Promise.all(mids.map((mid) => adminFetch('/api/library/song', 'PUT', { mid, type: batchType })))
      .then(() => {
        Toast.success(`已把 ${mids.length} 首改为「${batchType}」`);
        setSelectedMids(new Set());
        setBatchType('');
        loadTypes();
        if (activeType) loadSongs(activeType);
      })
      .catch((e) => Toast.error('批量改舞种失败：' + e.message));
  }
  function batchRemove() {
    const mids = [...selectedMids];
    if (!mids.length) return;
    Modal.confirm({
      title: `移除选中的 ${mids.length} 首？`,
      content: '只删除曲库记录，不删除磁盘上的音频文件。',
      okText: '移除',
      cancelText: '取消',
      onOk: () => {
        setAdminToken(adminTokenState);
        return Promise.all(mids.map((mid) => adminFetch('/api/library/song?mid=' + encodeURIComponent(mid), 'DELETE')))
          .then(() => {
            Toast.success(`已移除 ${mids.length} 首`);
            setSelectedMids(new Set());
            loadTypes();
            if (activeType) loadSongs(activeType);
          })
          .catch((e) => Toast.error('批量移除失败：' + e.message));
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
      searchSource === 'all'
        ? '/api/search/aggregate?keywords=' + encodeURIComponent(kw) + '&limit=15' + (searchSources.length ? '&sources=' + encodeURIComponent(searchSources.join(',')) : '')
        : searchSource === 'netease'
          ? '/api/source/netease/search?type=song&keywords=' + encodeURIComponent(kw) + '&limit=30'
          : '/api/search?keywords=' + encodeURIComponent(kw);
    api<{ items: Array<Record<string, unknown>> }>(path)
      .then((r) => {
        const label = searchSource === 'netease' ? '网易云音乐' : 'QQ音乐';
        const items = (r.items || []).map((x) =>
          searchSource === 'all'
            ? x
            : {
                mid: String(x.mid ?? x.id),
                name: String(x.name ?? ''),
                artists: (x.artists as string[]) || [],
                album: typeof x.album === 'string' ? x.album : ((x.album as { name?: string } | null)?.name ?? null),
                durationMs: Number(x.durationMs ?? 0),
                coverUrl: (x.coverUrl as string) || null,
                source: searchSource,
                sourceLabel: label,
                inLibrary: !!x.inLibrary,
              },
        );
        setResults(items as unknown as Song[]);
      })
      .catch((e) => Toast.error(e.message))
      .finally(() => setLoadingSearch(false));
  }
  function searchItemSource(s: Song): 'qqmusic' | 'netease' {
    const src = (s as unknown as { source?: string }).source;
    if (src === 'netease') return 'netease';
    if (src === 'qqmusic') return 'qqmusic';
    return searchSource === 'netease' ? 'netease' : 'qqmusic';
  }
  function importSearchItem(s: Song) {
    return searchItemSource(s) === 'netease'
      ? adminFetch<{ added: number }>('/api/source/netease/import', 'POST', { type: addType, input: 'https://music.163.com/song?id=' + s.mid })
      : adminFetch<{ added: number }>('/api/source/qqmusic/import', 'POST', { type: addType, songMid: s.mid });
  }
  function addSearchResult(s: Song) {
    setAdminToken(adminTokenState);
    importSearchItem(s)
      .then((r) => {
        Toast.success(r.added ? `已加入「${addType}」` : `「${addType}」中已存在`);
        loadTypes();
      })
      .catch((e) => Toast.error('加入失败：' + e.message));
  }
  function downloadSearchResult(s: Song) {
    setAdminToken(adminTokenState);
    importSearchItem(s)
      .then(() => adminFetch<{ taskId: string; queued: number }>('/api/library/download-song', 'POST', { mid: s.mid }))
      .then((r) => {
        Toast.info(`开始下载「${s.name}」到本地…`);
        loadTypes();
        if (r.taskId) api<{ data: TaskItem }>('/api/tasks/' + r.taskId).then((t) => setTask(t.data)).catch(() => {});
      })
      .catch((e) => Toast.error('下载失败：' + e.message));
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
    post<{ songs: LibrarySong[]; totalMs: number; allocation?: Array<{ type: string; count: number; ms: number }>; issues?: GenIssue[] }>('/api/setlist/generate', { durationMin, weights, mode, fill: true, order: orderArr, autoTrim })
      .then((r) => {
        const list = (r.songs || []).map((s) => ({ ...s, playMs: s.playMs ?? null }));
        setGen(list);
        setGenIssues(r.issues || []);
        setAlloc(r.allocation || []);
        Toast.success(`生成 ${list.length} 首，共 ${fmt(totalOf(list))}`);
      })
      .catch((e) => Toast.error('生成失败：' + e.message))
      .finally(() => setGenerating(false));
  }
  function checkRules() {
    if (!gen.length) return Toast.warning('还没有排曲内容');
    post<{ issues: GenIssue[] }>('/api/setlist/check', { songs: gen, targetMin: durationMin })
      .then((r) => {
        setGenIssues(r.issues || []);
        Toast.info(r.issues && r.issues.length ? `规则检查：${r.issues.length} 条提示` : '规则检查通过 ✓');
      })
      .catch((e) => Toast.error('检查失败：' + e.message));
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
  function openNeLogin() {
    setNeLoginOpen(true);
    startNeQr();
  }
  function startNeQr() {
    post<{ token: string; url: string }>('/api/auth/netease/qr/start', {})
      .then((r) => {
        setNeState('pending');
        QRCode.toDataURL(r.url, { width: 220, margin: 1 }).then(setNeQrImg).catch(() => setNeQrImg(''));
        if (nePollRef.current) window.clearInterval(nePollRef.current);
        nePollRef.current = window.setInterval(() => {
          api<{ state: string; hasCookie: boolean }>('/api/auth/netease/qr/check?token=' + encodeURIComponent(r.token))
            .then((st) => {
              setNeState(st.state);
              if (st.state === 'confirmed') {
                if (nePollRef.current) window.clearInterval(nePollRef.current);
                Toast.success('网易云登录成功');
                setNeLoginOpen(false);
                loadSettings();
              } else if (st.state === 'expired' && nePollRef.current) window.clearInterval(nePollRef.current);
            })
            .catch(() => {});
        }, 2000);
      })
      .catch((e) => Toast.error('获取网易云二维码失败：' + e.message));
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
  const libSongs = useMemo(() => {
    const base = sourceFilter === 'all' ? songs : songs.filter((s) => (s.source || 'qqmusic') === sourceFilter);
    if (libSort === 'default') return base;
    const arr = [...base];
    if (libSort === 'bpm-asc') arr.sort((a, b) => (a.bpm ?? 9999) - (b.bpm ?? 9999));
    else if (libSort === 'bpm-desc') arr.sort((a, b) => (b.bpm ?? -1) - (a.bpm ?? -1));
    else if (libSort === 'plays') arr.sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0));
    else if (libSort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return arr;
  }, [songs, sourceFilter, libSort]);
  const LIB_PAGE = 50;
  const libPageCount = Math.max(1, Math.ceil(libSongs.length / LIB_PAGE));
  const libPageSongs = useMemo(() => libSongs.slice(libPage * LIB_PAGE, libPage * LIB_PAGE + LIB_PAGE), [libSongs, libPage]);
  const orderArr = useMemo(() => orderText.split(/[\s,，、→>/-]+/).filter(Boolean), [orderText]);
  const shownResults = useMemo(() => (hideInLib ? results.filter((r) => !r.inLibrary) : results), [results, hideInLib]);

  function SongRow({ s, list, onAdd, onDownload, onClip, selected, onToggleSelect }: { s: LibrarySong | Song; list: Array<LibrarySong | Song>; onAdd?: () => void; onDownload?: () => void; onClip?: () => void; selected?: boolean; onToggleSelect?: () => void }) {
    const isLib = 'type' in s;
    const lib = s as LibrarySong;
    return (
      <div className={'song' + (onToggleSelect ? ' selectable' : '')}>
        {onToggleSelect ? <input type="checkbox" className="song-pick" checked={!!selected} onChange={onToggleSelect} aria-label="选择" /> : null}
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
          {!isLib && (s as { source?: string }).source ? (
            <span className="chip chip-src">{SOURCE_LABELS[(s as { source?: string }).source as string] || (s as { sourceLabel?: string }).sourceLabel || ''}</span>
          ) : null}
          {!isLib && (s as { inLibrary?: boolean }).inLibrary ? (
            <span className="chip chip-green" title="曲库中已有这首">已在曲库</span>
          ) : null}
          {isLib && lib.source && lib.source !== 'qqmusic' ? (
            <span className="chip chip-src" title={'来源：' + (SOURCE_LABELS[lib.source] || lib.source)}>
              {SOURCE_LABELS[lib.source] || lib.source}
            </span>
          ) : null}
          {isLib && lib.provenance?.rights === 'club' ? (
            <span className="chip chip-club" title={lib.provenance.edited ? '社团自制（已编辑）' : '社团自制'}>
              自制
            </span>
          ) : null}
          {isLib && lib.mood ? <span className={'chip ' + (lib.mood === '欢快' ? 'chip-lively' : lib.mood === '舒缓' ? 'chip-mellow' : 'chip-mid')}>{lib.mood}</span> : null}
          {isLib && lib.suitable === false ? <span className="chip chip-warn" title={lib.warning || '节奏不稳，可能不适合作为舞曲'}>不适合舞曲</span> : null}
          {isLib && lib.needsReview ? <span className="chip chip-review" title="识别置信度低 / 贴近速度边界 / 拍号不明确，建议人工复核">需复核</span> : null}
          {isLib && lib.file ? <span className="chip chip-green">已缓存</span> : null}
          {isLib && lib.playCount ? <span className="chip chip-mid" title={'累计播放 ' + lib.playCount + ' 次'}>已播 {lib.playCount}</span> : null}
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
          {onDownload ? (
            <IconBtn title="下载到本地" onClick={onDownload}>
              <IDownload />
            </IconBtn>
          ) : null}
          {isLib ? (
            <>
              <IconBtn title="编辑" onClick={() => openEdit(lib)}>
                <IEdit />
              </IconBtn>
              <IconBtn title="剪辑" onClick={() => openClip(lib)}>
                <IScissors />
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
                    {libSongs.filter((s) => s.file).length} / {libSongs.length} 已缓存
                  </span>
                  <Select value={activeType} onChange={(v) => setActiveType(v as string)} style={{ width: 160 }} optionList={libFilterOptions} />
                  <Select
                    value={sourceFilter}
                    onChange={(v) => setSourceFilter(v as string)}
                    style={{ width: 130 }}
                    optionList={[{ value: 'all', label: '全部来源' }, ...SOURCE_OPTIONS]}
                  />
                  <Select
                    value={libSort}
                    onChange={(v) => setLibSort(v as string)}
                    style={{ width: 130 }}
                    optionList={[
                      { value: 'default', label: '默认排序' },
                      { value: 'bpm-asc', label: 'BPM ↑' },
                      { value: 'bpm-desc', label: 'BPM ↓' },
                      { value: 'plays', label: '播放次数' },
                      { value: 'name', label: '歌名' },
                    ]}
                  />
                  {sourceFilter !== 'all' ? (
                    <>
                      <Button onClick={downloadBySource}>缓存本来源</Button>
                      <Button theme="borderless" type="danger" onClick={clearBySource}>
                        清空本来源
                      </Button>
                    </>
                  ) : null}
                  <Button onClick={cacheMissing}>缓存缺失音频</Button>
                  <Button theme="solid" type="tertiary" onClick={autoClassify}>
                    自动分类
                  </Button>
                  <Button onClick={cacheClassify}>缓存并分类</Button>
                  <Button onClick={findDuplicates}>查重</Button>
                  <Button onClick={importLiked}>导入「我喜欢」</Button>
                </div>
              </div>
              {selectedMids.size ? (
                <div className="batch-bar">
                  <span className="hint">已选 {selectedMids.size} 首</span>
                  <Select value={batchType} onChange={(v) => setBatchType(v as string)} style={{ width: 150 }} optionList={typeOptions} placeholder="改为舞种" />
                  <Button theme="solid" size="small" onClick={batchChangeType}>
                    应用舞种
                  </Button>
                  <Button theme="borderless" type="danger" size="small" onClick={batchRemove}>
                    移除选中
                  </Button>
                  <Button theme="borderless" size="small" onClick={() => setSelectedMids(new Set())}>
                    取消选择
                  </Button>
                </div>
              ) : null}
              {libSongs.length ? (
                <>
                  <div className="songlist">
                    {libPageSongs.map((s) => (
                      <SongRow key={s.mid} s={s} list={libSongs} selected={selectedMids.has(s.mid)} onToggleSelect={() => toggleSelect(s.mid)} />
                    ))}
                  </div>
                  {libPageCount > 1 ? (
                    <div className="pager">
                      <Button size="small" disabled={libPage <= 0} onClick={() => setLibPage((p) => Math.max(0, p - 1))}>
                        上一页
                      </Button>
                      <span className="hint">
                        第 {libPage + 1} / {libPageCount} 页（每页 {LIB_PAGE}）
                      </span>
                      <Button size="small" disabled={libPage >= libPageCount - 1} onClick={() => setLibPage((p) => Math.min(libPageCount - 1, p + 1))}>
                        下一页
                      </Button>
                    </div>
                  ) : null}
                </>
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
                  <RadioGroup type="button" value={searchSource} onChange={(e) => setSearchSource(e.target.value as 'all' | 'qqmusic' | 'netease')}>
                    <Radio value="all">聚合搜索</Radio>
                    <Radio value="qqmusic">QQ音乐</Radio>
                    <Radio value="netease">网易云音乐</Radio>
                  </RadioGroup>
                  {searchSource === 'all' ? (
                    <Select
                      multiple
                      value={searchSources}
                      onChange={(v) => setSearchSources((v as string[]) || [])}
                      style={{ width: 180 }}
                      optionList={srcDefs.map((d) => ({ value: d.id, label: d.label }))}
                      placeholder="全部来源"
                    />
                  ) : null}
                  <Input value={kw} onChange={setKw} onEnterPress={doSearch} placeholder="歌曲 / 歌手" style={{ width: 230 }} />
                  <Select allowCreate value={addType} onChange={(v) => setAddType(v as string)} style={{ width: 130 }} optionList={typeOptions} placeholder="加入舞种" />
                  <Button theme="solid" type="primary" onClick={doSearch} loading={loadingSearch}>
                    搜索
                  </Button>
                  {results.length ? (
                    <Button theme={hideInLib ? 'solid' : 'borderless'} onClick={() => setHideInLib((v) => !v)} title="只显示曲库里还没有的">
                      隐藏已入库
                    </Button>
                  ) : null}
                </div>
              </div>
              {results.length ? (
                <>
                  <div className="hint" style={{ marginBottom: 8 }}>
                    共 {results.length} 首 · 已在曲库 {results.filter((r) => r.inLibrary).length} · 显示 {shownResults.length}
                  </div>
                  {shownResults.length ? (
                    <div className="songlist">
                      {shownResults.map((s) => (
                        <SongRow key={(s.source || 'x') + ':' + s.mid} s={s} list={shownResults} onAdd={() => addSearchResult(s)} onDownload={() => downloadSearchResult(s)} />
                      ))}
                    </div>
                  ) : (
                    <div className="empty">曲库里都已经有了（取消「隐藏已入库」可查看）</div>
                  )}
                </>
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
                  <RadioGroup type="button" value={importSource} onChange={(e) => setImportSource(e.target.value as 'qqmusic' | 'netease' | 'local' | 'http')}>
                    {SOURCE_OPTIONS.map((o) => (
                      <Radio key={o.value} value={o.value}>
                        {o.label}
                      </Radio>
                    ))}
                  </RadioGroup>
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

              <div className="hint" style={{ marginBottom: 10 }}>
                {importSource === 'qqmusic' && 'QQ：歌单链接导入到默认曲库，可后台缓存；「克隆」写回你的 QQ 账号（需登录）。'}
                {importSource === 'netease' && '网易云：歌单/单曲链接或 ID，导入后播放时再缓存（部分歌需在设置里配 neteaseCookie）。'}
                {importSource === 'local' && '本地/社团文件夹：按《规则》文件名「舞种-歌名-歌手」扫描入库，文件保持原位。'}
                {importSource === 'http' && '自建直链：每行一个音频 URL，播放时下载并转 mp3。'}
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
                <RadioGroup value={autoTrim ? 1 : 0} onChange={(e) => setAutoTrim(Number(e.target.value) === 1)}>
                  <Radio value={1}>自动裁剪 ≤4 分钟</Radio>
                  <Radio value={0}>保留原长</Radio>
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
                  <Button onClick={checkRules} disabled={!gen.length}>
                    规则检查
                  </Button>
                </div>
              </div>

              {gen.length ? (
                <>
                  <div className="hint" style={{ marginBottom: 10 }}>
                    共 {gen.length} 首 · 总时长 {fmt(totalOf(gen))}（拖拽 ⠿ 调顺序，「秒」列裁剪单曲时长）
                  </div>
                  {alloc.length ? (
                    <div className="hint" style={{ marginBottom: 10 }}>
                      时长分配：{alloc.map((a) => `${a.type} ${fmt(a.ms)}（${a.count} 首）`).join('　·　')}
                    </div>
                  ) : null}
                  {genIssues.length ? (
                    <div className="issues">
                      {genIssues.map((it, i) => (
                        <div key={i} className={'issue ' + (it.level === 'warn' ? 'warn' : 'info')}>
                          {it.level === 'warn' ? '⚠ ' : 'ℹ '}
                          {it.message}
                        </div>
                      ))}
                    </div>
                  ) : null}
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

          <TabPane tab="点歌" itemKey="requests">
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">点歌队列</span>
                <div className="panel-actions">
                  {reqStats ? <span className="hint">已点 {reqStats.active}/{reqStats.totalLimit} · 每人 ≤{reqStats.perRequesterLimit}</span> : null}
                  <Button onClick={loadRequests}>刷新</Button>
                  <Button onClick={addAcceptedToSetlist}>已采纳加入排曲</Button>
                  <Button theme="borderless" type="danger" onClick={resetReqs}>
                    清空（新一场）
                  </Button>
                </div>
              </div>
              <div className="req-wrap">
                <div className="req-list">
                  {reqs.length ? (
                    reqs.map((r) => (
                      <div key={r.id} className="req-item">
                        <span className="req-name">{r.name}</span>
                        <span className="req-sub">
                          {(r.artists || []).join('/')}
                          {r.requester ? ' · ' + r.requester : ''}
                          {r.note ? ' · ' + r.note : ''}
                        </span>
                        <span className={'chip ' + (r.status === 'accepted' ? 'chip-green' : r.status === 'rejected' ? 'chip-warn' : r.status === 'played' ? 'chip-gold' : 'chip-mid')}>
                          {r.status === 'accepted' ? '已采纳' : r.status === 'rejected' ? '已拒绝' : r.status === 'played' ? '已播放' : '待处理'}
                        </span>
                        <span className="req-actions">
                          <Button size="small" theme="borderless" onClick={() => requestToSetlist(r).then((ok) => (ok ? setActiveTab('setlist') : undefined))}>
                            →排曲
                          </Button>
                          {r.status !== 'accepted' ? (
                            <Button size="small" onClick={() => setReqStatus(r.id, 'accepted')}>
                              采纳
                            </Button>
                          ) : null}
                          {r.status === 'accepted' ? (
                            <Button size="small" theme="borderless" onClick={() => setReqStatus(r.id, 'played')}>
                              已播
                            </Button>
                          ) : null}
                          {r.status !== 'rejected' ? (
                            <Button size="small" theme="borderless" onClick={() => setReqStatus(r.id, 'rejected')}>
                              拒绝
                            </Button>
                          ) : null}
                          <Button size="small" theme="borderless" type="danger" onClick={() => delReq(r.id)}>
                            删除
                          </Button>
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="empty">还没有人点歌</div>
                  )}
                </div>
                <div className="req-qr">
                  <div className="hint">扫码点歌（手机打开）</div>
                  {reqQr ? <img src={reqQr} alt="点歌二维码" /> : null}
                  <div className="hint">{window.location.origin}/request</div>
                </div>
              </div>
              {reqPopular.length ? (
                <div className="req-popular">
                  <div className="req-pop-title">热门点歌 Top（跨场累计）</div>
                  {reqPopular.map((p, i) => (
                    <div className="req-pop-row" key={p.name + '-' + i}>
                      <span className="req-pop-rank">{i + 1}</span>
                      <span className="req-name">{p.name}</span>
                      <span className="req-sub">{(p.artists || []).join('/')}</span>
                      <span className="chip chip-gold">{p.count} 次</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </TabPane>

          <TabPane tab="统计" itemKey="stats">
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">曲库统计</span>
                <div className="panel-actions">
                  <Button onClick={loadStats}>刷新</Button>
                </div>
              </div>
              {libStats ? (
                <>
                  <div className="status-grid">
                    <div className="status-card">
                      <div className="sc-title">规模</div>
                      <div className="sc-body">
                        共 {libStats.total} 首 · 已缓存 {libStats.cached}
                        {libStats.total ? `（${Math.round((libStats.cached / libStats.total) * 100)}%）` : ''}
                        <br />
                        我喜欢 {libStats.liked} · 已识别 BPM {libStats.analyzed}
                      </div>
                    </div>
                    <div className="status-card">
                      <div className="sc-title">需要关注</div>
                      <div className="sc-body">
                        需复核 {libStats.needsReview} · 不适合舞曲 {libStats.unsuitable}
                        <br />
                        有响度数据 {libStats.loudness}
                      </div>
                    </div>
                  </div>
                  <div className="stat-grid">
                    <StatBars
                      title="舞种分布"
                      items={(libStats.byType as Array<{ type: string; count: number; cached: number }>)
                        .filter((t) => t.type !== '__liked__' && t.count > 0)
                        .sort((a, b) => b.count - a.count)
                        .map((t) => ({ label: t.type, value: t.count, sub: `缓存 ${t.cached}` }))}
                    />
                    <StatBars title="BPM 分布" items={(libStats.bpm as Array<{ range: string; count: number }>).filter((b) => b.count > 0).map((b) => ({ label: b.range, value: b.count }))} />
                    <StatBars title="曲风分布" items={(libStats.mood as Array<{ mood: string; count: number }>).filter((m) => m.count > 0).map((m) => ({ label: m.mood, value: m.count }))} />
                    <StatBars
                      title="来源分布"
                      items={(libStats.bySource as Array<{ source: string; count: number }>).map((s) => ({ label: SOURCE_LABELS[s.source] || s.source, value: s.count }))}
                    />
                  </div>
                  <div className="status-card" style={{ marginTop: 12 }}>
                    <div className="sc-title">最常播放 Top</div>
                    <div className="sc-body">
                      {(libStats.topPlayed as Array<{ mid: string; name: string; artists: string[]; type: string; playCount: number }>).length ? (
                        (libStats.topPlayed as Array<{ mid: string; name: string; artists: string[]; type: string; playCount: number }>).map((s, i) => (
                          <div key={s.mid}>
                            {i + 1}. {s.name} — {(s.artists || []).join('/')} · {s.type} · 已播 {s.playCount}
                          </div>
                        ))
                      ) : (
                        <span className="hint">还没有播放记录</span>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty">加载中…</div>
              )}
            </div>
          </TabPane>

          <TabPane tab="状态" itemKey="status">
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">系统状态</span>
                <div className="panel-actions">
                  <Button onClick={loadStatus}>刷新</Button>
                </div>
              </div>
              {status ? (
                <div className="status-grid">
                  <div className="status-card">
                    <div className="sc-title">缓存</div>
                    <div className="sc-body">
                      {fmtBytes(status.cache.bytes)} / {status.cache.limit > 0 ? fmtBytes(status.cache.limit) : '不限'}（{status.cache.files} 个文件）
                    </div>
                  </div>
                  <div className="status-card">
                    <div className="sc-title">曲库</div>
                    <div className="sc-body">
                      共 {status.library.total} 首 · 我喜欢 {status.library.liked}
                      <br />
                      {Object.entries(status.library.byType as Record<string, number>)
                        .filter(([, c]) => c > 0)
                        .map(([t, c]) => `${t} ${c}`)
                        .join(' · ')}
                    </div>
                  </div>
                  <div className="status-card">
                    <div className="sc-title">来源</div>
                    <div className="sc-body">
                      {(status.sources as Array<{ label: string; auth: boolean }>).map((s) => s.label + (s.auth ? ' ✓' : ' ✗')).join(' · ')}
                      <br />
                      按来源：{Object.entries(status.library.bySource as Record<string, number>).map(([k, c]) => `${k} ${c}`).join(' · ')}
                    </div>
                  </div>
                  <div className="status-card">
                    <div className="sc-title">环境</div>
                    <div className="sc-body">
                      ffmpeg {status.deps.ffmpeg ? '✓' : '✗'} · 登录 {status.sessions} · 已存排曲 {status.setlists}
                    </div>
                  </div>
                  <div className="status-card">
                    <div className="sc-title">最近任务</div>
                    <div className="sc-body">
                      {(status.tasks as Array<{ kind: TaskItem['kind']; done: number; total: number; failed: number; error?: string }>)
                        .map((t) => `${kindLabel(t.kind)} ${t.done}/${t.total}${t.failed ? `（失败 ${t.failed}${t.error ? '：' + t.error : ''}）` : ''}`)
                        .join('　') || '无'}
                    </div>
                  </div>
                  <div className="status-card">
                    <div className="sc-title">运行</div>
                    <div className="sc-body">
                      {Math.round(status.uptimeMs / 60000)} 分钟
                      <br />
                      {status.mediaDir}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty">加载中…</div>
              )}
              <div className="panel-head" style={{ marginTop: 18 }}>
                <span className="panel-title">最近播放（{history.length}）</span>
                <div className="panel-actions">
                  <Button size="small" onClick={loadHistory}>
                    刷新
                  </Button>
                  <Button size="small" type="danger" onClick={clearHistory}>
                    清空
                  </Button>
                </div>
              </div>
              {history.length ? (
                <div className="history-list">
                  {history.map((h, i) => (
                    <div className="history-row" key={h.mid + '-' + h.at + '-' + i}>
                      <span className="chip chip-gold">{h.type}</span>
                      <span className="history-name">{h.name}</span>
                      <span className="history-artist">{(h.artists || []).join(' / ')}</span>
                      <span className="history-time">{new Date(h.at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">暂无播放记录</div>
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
          <div className="field">
            <span>归属</span>
            <RadioGroup value={editForm.rights} onChange={(e) => setEditForm((f) => ({ ...f, rights: e.target.value as 'external' | 'club' }))}>
              <Radio value="external">外部引进</Radio>
              <Radio value="club">社团自制</Radio>
            </RadioGroup>
          </div>
          <div className="field">
            <span>是否编辑过</span>
            <RadioGroup value={editForm.edited ? 1 : 0} onChange={(e) => setEditForm((f) => ({ ...f, edited: Number(e.target.value) === 1 }))}>
              <Radio value={0}>否</Radio>
              <Radio value={1}>是（剪辑/编辑）</Radio>
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

      <Modal title="剪辑音频" visible={clipOpen} onOk={doClip} onCancel={() => setClipOpen(false)} okText="生成剪辑版" width={420}>
        <div className="settings-form">
          <div className="field">
            <span>名称</span>
            <Input value={clipForm.name} onChange={(v) => setClipForm((f) => ({ ...f, name: v }))} />
          </div>
          <div className="field">
            <span>起点（秒）</span>
            <InputNumber value={clipForm.startS} min={0} step={5} style={{ width: 140 }} onChange={(v) => setClipForm((f) => ({ ...f, startS: Number(v) || 0 }))} />
          </div>
          <div className="field">
            <span>终点（秒）</span>
            <InputNumber value={clipForm.endS} min={1} step={5} style={{ width: 140 }} onChange={(v) => setClipForm((f) => ({ ...f, endS: Number(v) || 0 }))} />
          </div>
          <div className="hint">用 ffmpeg 剪出 [起点, 终点)，作为该曲目的播放版本（替换 file、标「已编辑」，来源保留）。需先缓存该曲目。</div>
        </div>
      </Modal>

      <Modal title="重复曲目（跨来源）" visible={dupOpen} footer={null} width={600} onCancel={() => setDupOpen(false)}>
        {dups && dups.length ? (
          dups.map((g, gi) => (
            <div key={gi} className="dup-group">
              {g.map((s) => (
                <div key={s.mid} className="dup-row">
                  <span className={'chip ' + (s.source === 'qqmusic' ? 'chip-gold' : 'chip-src')}>{SOURCE_LABELS[s.source] || s.source}</span>
                  <span className="dup-name">
                    {s.name} · {(s.artists || []).join('/')} · {s.type}
                    {s.file ? ' · 已缓存' : ''}
                  </span>
                  <Button size="small" onClick={() => keepOne(g, s.mid)}>
                    保留此条
                  </Button>
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="empty">没有发现重复曲目</div>
        )}
      </Modal>

      <Modal title="设置（管理员）" visible={settingsOpen} footer={null} width={480} onCancel={() => setSettingsOpen(false)}>
        <div className="settings-form">
          <div className="field">
            <span>管理员口令</span>
            <Input value={adminTokenState} onChange={setAdminTokenState} placeholder="config.json 里的 adminToken（编辑员可填 editorToken）" />
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
            <Input value={settings.neteaseCookie} onChange={(v) => setSettings((s) => ({ ...s, neteaseCookie: v }))} placeholder="MUSIC_U=...（可点右侧「扫码登录」自动获取）" />
            <Button size="small" style={{ marginLeft: 8 }} onClick={openNeLogin}>
              扫码登录
            </Button>
          </div>
          <Button theme="solid" type="primary" onClick={saveSettings}>
            保存
          </Button>
          <div className="hint">保存后立即生效；已缓存的旧文件不会自动搬移。</div>

          <div className="divider" />
          <div className="field-title">曲库备份 / 恢复</div>
          <div className="hint">导出/恢复整库元数据（不含磁盘上的音频缓存文件）。恢复可选「合并」或「替换」。</div>
          <div className="panel-actions" style={{ marginTop: 8 }}>
            <Button onClick={exportLibrary}>导出备份（JSON）</Button>
            <RadioGroup type="button" value={restoreMode} onChange={(e) => setRestoreMode(e.target.value as 'merge' | 'replace')}>
              <Radio value="merge">合并</Radio>
              <Radio value="replace">替换</Radio>
            </RadioGroup>
            <Button onClick={pickRestore}>恢复备份…</Button>
            <input ref={restoreInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onRestoreFile} />
          </div>

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

      <Modal title="网易云扫码登录" visible={neLoginOpen} footer={null} width={360} onCancel={() => setNeLoginOpen(false)}>
        <div style={{ textAlign: 'center' }}>
          {neQrImg ? (
            <img src={neQrImg} style={{ width: 220, height: 220, borderRadius: 12 }} />
          ) : (
            <div style={{ padding: 44 }}>加载中…</div>
          )}
          <div className="hint" style={{ marginTop: 10 }}>
            {neState === 'scanned' ? '已扫码，请在手机上确认' : neState === 'expired' ? '二维码已过期，请重新获取' : '请用「网易云音乐」App 扫码登录'}
          </div>
          <div style={{ marginTop: 14 }}>
            <Button size="small" onClick={startNeQr}>
              重新获取
            </Button>
          </div>
        </div>
      </Modal>

      <Modal title="连接 QQ 音乐" visible={loginOpen} footer={null} width={372} onCancel={() => setLoginOpen(false)}>
        <div style={{ textAlign: 'center' }}>
          <div className="hint" style={{ marginBottom: 12, textAlign: 'left' }}>
            扫码仅用于你个人账号的功能（我的歌单 / 克隆到我的歌单 / 把「我喜欢」导入你名下）。曲库浏览 / 下载 / 播放走客户端镜像的会员账号，无需扫码。
          </div>
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
