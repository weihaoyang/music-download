/*
 * Frida agent：注入 QQMusic.exe，从内存里抠出「当前有效的登录 cookie」。
 * 思路：QQ 客户端每次发请求都会在内存里拼出 Cookie 头（含 uin / qqmusic_key / qm_keyst），
 * 我们扫描内存里的 "qqmusic_key="，读窗口、抽出该 cookie 串。
 * 不做任何 hook、不改客户端行为。
 */

function toHexPattern(ascii) {
  let out = '';
  for (let i = 0; i < ascii.length; i++) out += (i ? ' ' : '') + ascii.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}

const NEEDLE = toHexPattern('qqmusic_key=');

function extractPairs(run) {
  const pairs = {};
  const re = /([A-Za-z_][A-Za-z0-9_]{1,30})=([A-Za-z0-9_\-\.%*+/=]{1,400})/g;
  let m;
  while ((m = re.exec(run))) {
    if (pairs[m[1]] === undefined) pairs[m[1]] = m[2];
  }
  return pairs;
}

function sniffOnce() {
  const found = new Map(); // key -> pairs
  const ranges = [];
  for (const prot of ['r--', 'rw-']) {
    try {
      for (const r of Process.enumerateRanges(prot)) ranges.push(r);
    } catch (e) {
      /* ignore */
    }
  }
  let scanned = 0;
  for (const r of ranges) {
    const size = r.size; // number
    if (size > 64 * 1024 * 1024) continue; // 跳过超大区间
    if (scanned > 512 * 1024 * 1024) break;
    scanned += size;
    let matches;
    try {
      matches = Memory.scanSync(r.base, size, NEEDLE);
    } catch (e) {
      continue;
    }
    for (const match of matches) {
      const off = match.address.sub(r.base).toInt32();
      const startOff = Math.max(0, off - 3000);
      const len = Math.min(6000, size - startOff);
      if (len <= 0) continue;
      let run;
      try {
        const u8 = new Uint8Array(r.base.add(startOff).readByteArray(len));
        let s = '';
        for (let i = 0; i < u8.length; i++) {
          const c = u8[i];
          s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' ';
        }
        run = s;
      } catch (e) {
        continue;
      }
      run = run.replace(/[^\x20-\x7e]/g, ' ');
      const pairs = extractPairs(run);
      if (!pairs.qqmusic_key && !pairs.qm_keyst) continue;
      if (!pairs.uin && !pairs.qqmusic_uin) continue;
      const key = (pairs.qqmusic_key || pairs.qm_keyst) + '|' + (pairs.uin || pairs.qqmusic_uin);
      if (!found.has(key)) {
        found.set(key, {
          uin: pairs.uin || pairs.qqmusic_uin,
          qqmusic_key: pairs.qqmusic_key || pairs.qm_keyst,
          qm_keyst: pairs.qm_keyst || pairs.qqmusic_key,
          tmeLoginType: pairs.tmeLoginType || pairs.pt_login_type || '1',
          euin: pairs.euin || '',
          pairs,
        });
      }
    }
  }
  return Array.from(found.values());
}

rpc.exports = {
  ping() {
    return { pid: Process.id, arch: Process.arch, platform: Process.platform };
  },
  sniff() {
    const list = sniffOnce();
    // 返回数量与候选；调用方负责校验
    return { count: list.length, candidates: list };
  },
};
