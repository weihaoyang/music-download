const fs = require('fs');
const path = require('path');
const { analyze, decode, buildOnset, estimateEnergy, pulseClarity, analyzeTempo } = require('../dist/classifier');
const aubio = require('aubiojs');

(async () => {
  const lib = JSON.parse(fs.readFileSync('data/library.json', 'utf8'));
  const nameOf = {};
  for (const songs of Object.values(lib)) for (const s of songs) if (s.file) nameOf[s.file] = s.name;

  const { Tempo } = await aubio();
  const dir = 'data/media';
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mp3'))) {
    try {
      const p = path.join(dir, f);
      const pcm = await decode(p);
      const onset = buildOnset(pcm);
      const raw = estimateEnergy(pcm, onset);
      const tip = analyzeTempo(pcm, Tempo);
      const r = await analyze(p);
      const clarity = pulseClarity(onset, r.bpm);
      console.log(
        String(r.bpm).padStart(3),
        r.meter,
        'E=' + String(Math.round(raw.energy * 100) / 100).padEnd(4),
        'stab=' + String(r.stability).padEnd(5),
        'clr=' + String(Math.round(clarity * 1000) / 1000).padEnd(6),
        'agr=' + String(Math.round(tip.agreement * 100) / 100).padEnd(5),
        'conf=' + String(Math.round(tip.conf * 100) / 100).padEnd(5),
        'spr=' + String(Math.round(tip.spread * 100) / 100).padEnd(5),
        (r.suitable ? 'OK ' : 'BAD') + ' ' + (r.mood + '/' + String(r.type || '?')).padEnd(8),
        (nameOf[f] || f).slice(0, 22),
      );
    } catch (e) {
      console.log('ERR', f, e.message);
    }
  }
})();
