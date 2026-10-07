/* global React, ReactDOM, htm, SemiUI */
(function () {
  const { useState, useEffect, useRef } = React;
  const h = React.createElement;
  const html = htm.bind(h);
  const S = SemiUI;
  const { Button, Input, Tabs, List, Modal, Tag, Toast, Spin, Select, Empty, Typography, Space, Avatar } = S;
  const TabPane = S.Tabs.TabPane;
  const { Title, Text } = Typography;

  async function api(path, opts) {
    const r = await fetch(path, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.message || j.error || 'HTTP ' + r.status);
    return j;
  }

  function App() {
    const [types, setTypes] = useState([]);
    const [activeType, setActiveType] = useState('');
    const [songs, setSongs] = useState([]);
    const [loadingLib, setLoadingLib] = useState(false);

    const [kw, setKw] = useState('');
    const [results, setResults] = useState([]);
    const [loadingSearch, setLoadingSearch] = useState(false);

    const [importUrl, setImportUrl] = useState('');
    const [importPreview, setImportPreview] = useState(null);
    const [importName, setImportName] = useState('');
    const [loadingImport, setLoadingImport] = useState(false);
    const [cloning, setCloning] = useState(false);

    const [user, setUser] = useState(null);
    const [loginOpen, setLoginOpen] = useState(false);
    const [qr, setQr] = useState(null);
    const [qrState, setQrState] = useState('');
    const pollRef = useRef(null);

    const [playing, setPlaying] = useState(null);
    const audioRef = useRef(null);
    const srcRef = useRef(null);

    useEffect(() => {
      (async () => {
        try {
          const t = await api('/api/library/types');
          setTypes(t.data || []);
          if (t.data && t.data.length) setActiveType(t.data[0].type);
        } catch (e) {
          Toast.error('读取曲库失败：' + e.message);
        }
        try {
          const me = await api('/api/auth/me');
          setUser(me.user);
        } catch (_) {}
      })();
      return () => clearInterval(pollRef.current);
    }, []);

    useEffect(() => {
      if (!activeType) return;
      setLoadingLib(true);
      api('/api/library/list?type=' + encodeURIComponent(activeType))
        .then((r) => setSongs(r.songs || []))
        .catch((e) => Toast.error(e.message))
        .finally(() => setLoadingLib(false));
    }, [activeType]);

    function play(mid, name) {
      api('/api/song/url?mid=' + encodeURIComponent(mid))
        .then((r) => {
          setPlaying({ name, local: r.data.local });
          srcRef.current = r.data.url;
          window.setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.src = srcRef.current;
              audioRef.current.play().catch(() => {});
            }
          }, 0);
          Toast.success(r.data.local ? '播放本地缓存' : '播放 QQ 直链');
        })
        .catch((e) => Toast.error('播放失败：' + e.message));
    }

    function doSearch() {
      if (!kw.trim()) return;
      setLoadingSearch(true);
      api('/api/search?keywords=' + encodeURIComponent(kw))
        .then((r) => setResults(r.items || []))
        .catch((e) => Toast.error(e.message))
        .finally(() => setLoadingSearch(false));
    }

    function doImport() {
      if (!importUrl.trim()) return;
      setLoadingImport(true);
      api('/api/playlist/import?url=' + encodeURIComponent(importUrl))
        .then((r) => {
          setImportPreview(r.data);
          setImportName(r.data.name || '导入歌单');
          Toast.success('解析成功：' + r.data.name + '（' + r.data.songCount + ' 首）');
        })
        .catch((e) => Toast.error('解析失败：' + e.message))
        .finally(() => setLoadingImport(false));
    }

    function doClone() {
      if (!user) {
        setLoginOpen(true);
        startQr('qq');
        return;
      }
      setCloning(true);
      api('/api/playlist/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl, name: importName }),
      })
        .then((r) => Toast.success('已导入到你的歌单：' + r.data.name))
        .catch((e) => Toast.error('导入失败：' + e.message))
        .finally(() => setCloning(false));
    }

    function startQr(type) {
      api('/api/auth/qr/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) })
        .then((r) => {
          setQr(r);
          setQrState('pending');
          clearInterval(pollRef.current);
          pollRef.current = setInterval(() => {
            api('/api/auth/qr/check?type=' + type + '&token=' + encodeURIComponent(r.token))
              .then((st) => {
                setQrState(st.state);
                if (st.state === 'confirmed') {
                  clearInterval(pollRef.current);
                  setUser(st.user);
                  setLoginOpen(false);
                  Toast.success('登录成功：' + ((st.user && (st.user.nickname || st.user.uin)) || ''));
                } else if (st.state === 'expired') {
                  clearInterval(pollRef.current);
                }
              })
              .catch(() => {});
          }, 2000);
        })
        .catch((e) => Toast.error('获取二维码失败：' + e.message));
    }

    function openLogin() {
      setLoginOpen(true);
      setQr(null);
      startQr('qq');
    }

    function logout() {
      api('/api/auth/logout', { method: 'POST' })
        .then(() => {
          setUser(null);
          Toast.info('已退出');
        })
        .catch(() => {});
    }

    function songRow(s) {
      return html`
        <${List.Item}
          key=${s.mid}
          main=${html`
            <div>
              <div style=${{ fontWeight: 500 }}>${s.name}</div>
              <div class="muted">${(s.artists || []).join(' / ')}${s.album ? ' · ' + s.album : ''}</div>
            </div>`}
          extra=${html`
            <${Space}>
              ${s.file ? html`<${Tag} color="green" size="small">已缓存<//>` : null}
              <${Button} size="small" theme="borderless" onClick=${() => play(s.mid, s.name)}>播放<//>
            <//>`}
        />`;
    }

    const typeOptions = types.map((t) => ({ label: t.type + '（' + t.count + '）', value: t.type }));

    return html`
      <div class="app">
        <div class="header">
          <${Title} heading=${4} style=${{ margin: 0 }}>舞曲排曲台<//>
          <div class="header-right">
            ${user
              ? html`<${Space}>
                  <${Avatar} size="small" color="blue">${(user.nickname || user.uin || '?').slice(0, 1)}<//>
                  <${Text}>${user.nickname || user.uin}<//>
                  <${Button} theme="borderless" size="small" onClick=${logout}>退出<//>
                <//>`
              : html`<${Button} theme="solid" onClick=${openLogin}>连接 QQ 音乐<//>`}
          </div>
        </div>

        <${Tabs} type="line">
          <${TabPane} tab="曲库" itemKey="lib">
            <div class="toolbar">
              <${Select} value=${activeType} onChange=${(v) => setActiveType(v)} style=${{ width: 180 }} optionList=${typeOptions} />
              <${Text} class="muted">${songs.filter((s) => s.file).length} / ${songs.length} 已缓存<//>
            </div>
            <${Spin} spinning=${loadingLib}>
              ${songs.length
                ? html`<${List} dataSource=${songs} renderItem=${songRow} />`
                : html`<${Empty} title="暂无曲目" description="管理员端导入歌单后即可在此浏览" />`}
            <//>
          <//>

          <${TabPane} tab="搜索" itemKey="search">
            <div class="toolbar">
              <${Input} value=${kw} onChange=${setKw} onEnterPress=${doSearch} placeholder="搜 QQ 音乐歌曲 / 歌手" style=${{ width: 320 }} />
              <${Button} theme="solid" onClick=${doSearch} loading=${loadingSearch}>搜索<//>
            </div>
            <${List} dataSource=${results} renderItem=${songRow} />
          <//>

          <${TabPane} tab="歌单导入" itemKey="imp">
            <div class="toolbar">
              <${Input} value=${importUrl} onChange=${setImportUrl} placeholder="粘贴 QQ 音乐歌单链接 / 分享短链" style=${{ width: 420 }} />
              <${Button} onClick=${doImport} loading=${loadingImport}>解析<//>
              <${Button} theme="solid" onClick=${doClone} loading=${cloning} disabled=${!importPreview}>克隆到我的歌单<//>
            </div>
            ${importPreview ? html`<div class="muted" style=${{ marginBottom: 8 }}>${importPreview.name} · 共 ${importPreview.songCount} 首（预览 ${importPreview.songs.length}）</div>` : null}
            <${List} dataSource=${importPreview ? importPreview.songs : []} renderItem=${songRow} />
          <//>
        <//>

        <${Modal}
          title="连接 QQ 音乐"
          visible=${loginOpen}
          footer=${null}
          width=${360}
          onCancel=${() => {
            setLoginOpen(false);
            clearInterval(pollRef.current);
          }}
        >
          <div style=${{ textAlign: 'center' }}>
            ${qr
              ? html`
                  <img src=${qr.image} style=${{ width: 200, height: 200 }} />
                  <div class="muted" style=${{ marginTop: 8 }}>
                    ${qrState === 'scanned' ? '已扫码，请在手机上确认' : qrState === 'expired' ? '二维码已过期，请重新获取' : '请用 QQ 扫码登录'}
                  </div>
                  <div style=${{ marginTop: 12 }}>
                    <${Button} size="small" onClick=${() => startQr('qq')}>QQ 码<//>
                    <${Button} size="small" style=${{ marginLeft: 8 }} onClick=${() => startQr('wx')}>微信码<//>
                  </div>`
              : html`<${Spin} />`}
          </div>
        <//>

        <div class="player">
          <div class="player-title">${playing ? playing.name + (playing.local ? ' · 本地缓存' : ' · QQ 直链') : '未播放'}</div>
          <audio ref=${audioRef} controls></audio>
        </div>
      </div>`;
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
