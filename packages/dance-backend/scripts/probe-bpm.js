'use strict';
const { debugBpm } = require('@hdbc/dance-sdk');
const { spawn } = require('child_process');
const SAMPLE_RATE = 22050;
const BUF = 1024;
function decode(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-t', '60', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'], { windowsHide: true });
    const cs = [];
    let err = '';
    p.stdout.on('data', (d) => cs.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve(Buffer.concat(cs)) : reject(new Error(err.slice(0, 200)))));
  });
}
(async () => {
  const aubio = require('aubiojs');
  const { Tempo } = await aubio();
  const buf = await decode(process.argv[2] || 'data/media/003MAqln4ZUb0u.mp3');
  const pcm = new Float32Array(buf.length / 4);
  for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readFloatLE(i * 4);
  const seq = debugBpm(pcm, Tempo);
  const tail = seq.slice(Math.floor(seq.length / 2));
  console.log('samples =', seq.length);
  console.log('head    =', seq.slice(0, 10).join(', '));
  console.log('tail    =', tail.slice(0, 20).join(', '));
  console.log('unique  =', [...new Set(tail)].slice(0, 20).join(', '));
})();
