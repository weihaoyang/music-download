'use strict';
const aubio = require('aubiojs');
const ffStatic = require('ffmpeg-static');
const fs = require('fs');
console.log('ffmpeg-static path =', ffStatic, 'exists =', ffStatic ? fs.existsSync(ffStatic) : false);
aubio()
  .then((mod) => {
    console.log('aubiojs exports =', Object.keys(mod));
    const Tempo = mod.Tempo;
    const t = new Tempo(1024, 512, 22050);
    console.log('Tempo instance methods =', Object.getOwnPropertyNames(Object.getPrototypeOf(t)));
    const out = t.do(new Float32Array(1024));
    console.log('tempo.do empty =', out);
  })
  .catch((e) => console.error('ERR', e && e.message));
