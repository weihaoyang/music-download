const fs = require('fs');
const path = require('path');
const { analyze } = require('@hdbc/dance-sdk');

(async () => {
  const dir = process.argv[2];
  const files = fs.readdirSync(dir).filter((f) => /\.(mp3|flac|m4a|wav)$/i.test(f));
  for (const f of files) {
    try {
      const r = await analyze(path.join(dir, f));
      console.log(String(r.bpm).padStart(3), 'stab=' + String(r.stability).padEnd(5), 'prom=' + String(r.prominence).padEnd(5), 'os=' + String(r.onsetStrength).padEnd(7), r.suitable ? 'OK ' : 'BAD', String(r.type || '-').padEnd(4), (r.warning || '').slice(0, 20), f);
    } catch (e) {
      console.log('ERR', f, e.message);
    }
  }
})();
