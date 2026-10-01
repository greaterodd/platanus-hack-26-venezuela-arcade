// El Apagón — a storm-drowned llanos metroidvania for the Platanus Hack 26 arcade.
(() => {

// DO NOT replace existing keys — they match the physical arcade cabinet wiring.
const CABINET_KEYS = {
  P1_U: ['w'],
  P1_D: ['s'],
  P1_L: ['a'],
  P1_R: ['d'],
  P1_1: ['u'],
  P1_2: ['i'],
  P1_3: ['o'],
  P1_4: ['j'],
  P1_5: ['k'],
  P1_6: ['l'],
  P2_U: ['ArrowUp'],
  P2_D: ['ArrowDown'],
  P2_L: ['ArrowLeft'],
  P2_R: ['ArrowRight'],
  P2_1: ['r'],
  P2_2: ['t'],
  P2_3: ['y'],
  P2_4: ['f'],
  P2_5: ['g'],
  P2_6: ['h'],
  START1: ['Enter'],
  START2: ['2'],
};

const KEY_TO_ARCADE = {};
for (const [code, keys] of Object.entries(CABINET_KEYS)) {
  for (const key of keys) KEY_TO_ARCADE[key.length === 1 ? key.toLowerCase() : key] = code;
}

// held[code]: button is down. Presses/releases are latched until consumed, so taps
// shorter than a frame still register.
const held = Object.create(null);
const pressed = Object.create(null);
const released = Object.create(null);
let anyPress = null;

const arcadeCode = (e) => KEY_TO_ARCADE[e.key.length === 1 ? e.key.toLowerCase() : e.key];
window.addEventListener('keydown', (e) => {
  const code = arcadeCode(e);
  if (!code) return;
  e.preventDefault();
  if (!held[code]) pressed[code] = true;
  held[code] = true;
  if (anyPress) anyPress(code);
});
window.addEventListener('keyup', (e) => {
  const code = arcadeCode(e);
  if (!code) return;
  if (held[code]) released[code] = true;
  held[code] = false;
});

// Did any of these buttons go down (or up) since the last check? Consumes the latch.
const tap = (...codes) => codes.reduce((hit, c) => (pressed[c] ? ((pressed[c] = false), true) : hit), false);
const untap = (...codes) => codes.reduce((hit, c) => (released[c] ? ((released[c] = false), true) : hit), false);
const down = (...codes) => codes.some((c) => held[c]);
const clearTaps = () => {
  for (const c in pressed) pressed[c] = false;
  for (const c in released) released[c] = false;
};

const BTN = {
  left: ['P1_L'],
  right: ['P1_R'],
  jump: ['P1_2', 'P1_U'],
  use: ['P1_1'],
  next: ['P1_3'],
  prev: ['P1_4'],
  mute: ['P1_6'],
};

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// D minor: i - VI - iv - V (harmonic minor, so the V is major with a C#).
const CHORDS = [
  [50, 53, 57], // Dm
  [46, 50, 53], // Bb
  [43, 46, 50], // Gm
  [45, 49, 52], // A
];
// Eighth-note lead, one row per bar; null = rest.
const MELODY = [
  [69, null, null, 65, 64, null, 62, null],
  [65, null, null, 62, 60, null, 58, null],
  [62, null, 58, null, 67, null, 65, 64],
  [61, null, null, null, 64, null, 57, null],
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicOn = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);

    this.music = ctx.createGain();
    this.music.gain.value = 0.32;
    this.music.connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);

    this.amb = ctx.createGain();
    this.amb.gain.value = 0.5;
    this.amb.connect(this.master);

    const len = ctx.sampleRate * 3;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }

    this.startRain();
  }

  get now() {
    return this.ctx.currentTime;
  }

  startRain() {
    const ctx = this.ctx;
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.white;
    hiss.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    hiss.connect(hp).connect(lp).connect(g).connect(this.amb);
    hiss.start();

    const body = ctx.createBufferSource();
    body.buffer = this.brown;
    body.loop = true;
    const g2 = ctx.createGain();
    g2.gain.value = 0.08;
    body.connect(g2).connect(this.amb);
    body.start();
  }

  thunder(delay = 0.6, power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now + delay;

    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    src.playbackRate.value = 0.6 + Math.random() * 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(2.2 * power, t + 0.08);
    g.gain.setValueAtTime(1.7 * power, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
    src.connect(lp).connect(g).connect(this.amb);
    src.start(t);
    src.stop(t + 4.5);

    if (delay < 0.5) {
      const c = ctx.createBufferSource();
      c.buffer = this.white;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.75 * power, t);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      c.connect(hp).connect(cg).connect(this.amb);
      c.start(t);
      c.stop(t + 0.4);
    }
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextTime = this.now + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    this.musicOn = false;
    clearInterval(this.timer);
  }

  schedule() {
    const eighth = 60 / 72 / 2;
    while (this.nextTime < this.now + 0.15) {
      this.playStep(this.step, this.nextTime, eighth);
      this.nextTime += eighth;
      this.step++;
    }
  }

  playStep(step, t, eighth) {
    const bar = Math.floor(step / 8) % 4;
    const pos = step % 8;
    const cycle = Math.floor(step / 32);
    const chord = CHORDS[bar];

    if (pos === 0) {
      for (const n of chord) {
        this.tone('sawtooth', midi(n), t, eighth * 8, 0.022, 900, 0.35);
        this.tone('sawtooth', midi(n) * 1.004, t, eighth * 8, 0.018, 900, 0.35);
      }
      if (bar === 0) this.bell(midi(38), t, 0.12, 5);
    }

    if (pos % 2 === 0) this.tone('square', midi(chord[0] - 12), t, eighth * 1.6, 0.05, 500, 0.01);

    // Chiptune arpeggio (drops out every 4th cycle for breathing room).
    if (cycle % 4 !== 3) {
      const n = chord[ARP[pos]] + 12;
      this.tone('square', midi(n), t, eighth * 0.7, 0.018, 2500, 0.005);
    }

    // Lead melody plays every other cycle.
    const m = MELODY[bar][pos];
    if (m && cycle % 2 === 1) this.tone('square', midi(m), t, eighth * 1.8, 0.035, 3000, 0.02, true);
  }

  tone(type, freq, t, dur, vol, cutoff = 2000, attack = 0.01, vibrato = false, dest = this.music) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.value = freq * 0.012;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
    }
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  bell(freq, t, vol, len, dest = this.music) {
    // Inharmonic partials of a cast bell.
    const partials = [
      [0.5, 1], [1, 0.8], [1.19, 0.5], [1.5, 0.35], [2, 0.3], [2.74, 0.18], [3.76, 0.1],
    ];
    for (const [ratio, amp] of partials) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len / ratio ** 0.5);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + len + 0.1);
    }
  }

  noiseHit(t, dur, vol, lo, hi, dest = this.sfx) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.5 + Math.random();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(hi, t);
    bp.frequency.exponentialRampToValueAtTime(lo, t + dur);
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  sweep(type, f0, f1, dur, vol, t = this.now) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.ctx) return;
    const t = this.now;
    switch (name) {
      case 'jump':
        this.sweep('square', 220, 440, 0.1, 0.05);
        break;
      case 'land':
        this.noiseHit(t, 0.08, 0.15, 200, 600);
        break;
      case 'step':
        this.noiseHit(t, 0.04, 0.05, 300, 1200);
        break;
      case 'swing':
        this.noiseHit(t, 0.15, 0.25, 500, 3000);
        break;
      case 'poke':
        this.noiseHit(t, 0.08, 0.2, 800, 2500);
        break;
      case 'clang':
        this.tone('square', 1250, t, 0.12, 0.06, 5000, 0.001, false, this.sfx);
        this.tone('square', 1870, t, 0.08, 0.04, 5000, 0.001, false, this.sfx);
        break;
      case 'crumble':
        this.noiseHit(t, 0.6, 0.6, 60, 900);
        this.noiseHit(t + 0.1, 0.4, 0.3, 80, 600);
        break;
      case 'flesh':
        this.noiseHit(t, 0.18, 0.4, 120, 900);
        this.sweep('sawtooth', 160, 60, 0.15, 0.08);
        break;
      case 'hurt':
        this.sweep('square', 600, 90, 0.35, 0.12);
        this.noiseHit(t, 0.25, 0.4, 150, 1200);
        this.glitchNoise(0.25);
        break;
      case 'drop':
        this.sweep('triangle', 900, 200, 0.25, 0.12);
        this.tone('square', 190, t + 0.05, 0.1, 0.05, 2000, 0.001, false, this.sfx);
        break;
      case 'pickup':
        [62, 69, 74].forEach((n, i) => this.tone('square', midi(n + 12), t + i * 0.07, 0.15, 0.06, 4000, 0.002, false, this.sfx));
        break;
      case 'newtool':
        [50, 57, 62, 65, 69].forEach((n, i) => this.tone('square', midi(n + 12), t + i * 0.09, 0.35, 0.06, 4000, 0.002, false, this.sfx));
        this.bell(midi(62), t + 0.4, 0.05, 2.5, this.sfx);
        break;
      case 'checkpoint':
        this.bell(midi(74), t, 0.07, 2.5, this.sfx);
        this.bell(midi(81), t + 0.15, 0.04, 2.0, this.sfx);
        break;
      case 'lost':
        this.sweep('sawtooth', 400, 40, 0.8, 0.08);
        this.glitchNoise(0.5);
        break;
      case 'screech':
        this.sweep('sawtooth', 1800, 700, 0.18, 0.05);
        this.sweep('square', 2400, 1200, 0.12, 0.03);
        break;
      case 'moan':
        this.sweep('sawtooth', 110, 70, 0.9, 0.06);
        break;
      case 'die':
        this.sweep('sawtooth', 300, 30, 0.6, 0.12);
        this.noiseHit(t, 0.4, 0.5, 80, 1500);
        this.glitchNoise(0.3);
        break;
      case 'burn':
        this.noiseHit(t, 0.1, 0.06, 2000, 6000);
        break;
      case 'veil':
        this.sweep('sine', 200, 1600, 0.9, 0.08);
        this.glitchNoise(0.4);
        break;
      case 'death':
        this.sweep('sawtooth', 220, 20, 1.6, 0.15);
        this.glitchNoise(1.0);
        break;
      case 'glitch':
        this.glitchNoise(0.2);
        break;
      case 'greatbell':
        this.bell(midi(38), t, 0.4, 9, this.sfx);
        this.bell(midi(38), t + 2.2, 0.3, 9, this.sfx);
        this.bell(midi(38), t + 4.4, 0.25, 9, this.sfx);
        break;
    }
  }

  glitchNoise(dur) {
    const t = this.now;
    const n = Math.floor(dur / 0.03);
    for (let i = 0; i < n; i++) {
      const f = 80 + Math.random() * 3000;
      this.tone('square', f, t + i * 0.03, 0.028, 0.03, 8000, 0.001, false, this.sfx);
    }
  }
}

const audio = new AudioEngine();

// Procedural art. The world is mostly black, white and bare-earth brown; the only
// bright colours are the child's yellow raincoat and crimson (eyes, blood, a
// little stained glass).

const PAL = {
  '.': null,
  o: '#0c0c0c', // outline
  k: '#000000', // void under the hood
  Y: '#f2c230', // raincoat
  y: '#a8780f', // raincoat shade
  h: '#ffe07a', // raincoat highlight
  s: '#c9c9c9', // pale skin
  r: '#ff1a1a', // red eyes
  R: '#7a0008', // dark red
  1: '#0e0e0e',
  2: '#232323',
  3: '#383838',
  4: '#5a5a5a',
  5: '#8c8c8c',
  6: '#c4c4c4',
  w: '#ffffff',
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Draw ASCII pixel art rows (padded to w) into ctx at (ox, oy).
function drawRows(ctx, rows, w, ox = 0, oy = 0) {
  rows.forEach((row, y) => {
    const r = row.padEnd(w, '.').slice(0, w);
    for (let x = 0; x < w; x++) {
      const col = PAL[r[x]];
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  });
}

// Register a horizontal strip of ASCII frames as a texture with numeric frames.
function sheet(scene, key, frames, w, h) {
  const c = canvas(w * frames.length, h);
  const ctx = c.getContext('2d');
  frames.forEach((rows, i) => drawRows(ctx, rows, w, i * w, 0));
  const tex = scene.textures.addCanvas(key, c);
  frames.forEach((_, i) => tex.add(i, 0, i * w, 0, w, h));
  return tex;
}

function fromCanvas(scene, key, w, h, draw) {
  const c = canvas(w, h);
  draw(c.getContext('2d'), w, h);
  scene.textures.addCanvas(key, c);
}

// Seeded RNG so the art is identical every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CHILD_BODY = [
  '................',
  '.......oo.......',
  '......oYYo......',
  '.....oYhYYo.....',
  '....oYhYYYYo....',
  '....oYYYYYYYo...',
  '...oYYYkkkkYo...',
  '...oYYkkkkkkYo..',
  '...oYYkkkkkkYo..',
  '...oYYYkkkkYYo..',
  '...oyYYYYYYYYo..',
  '..oyYYhYYYYYYo..',
  '..oyYYhYYYYYYYo.',
  '..oyYYYYyYYYYYo.',
  '.oyYYYYYyYYYYYo.',
  '.oyYYYYYyYYYYYYo',
  '.oyYYYYYyYYYYYYo',
  'oyyYYYYYyYYYYYYo',
  'oyyyyyyyyyyyyyyo',
  '.oooooooooooooo.',
];
const LEGS = {
  idle: ['.....os..so.....', '.....os..so.....', '.....os..so.....', '....oss..sso....'],
  run1: ['....os....so....', '...os......so...', '...os.......so..', '..oss.......sso.'],
  run2: ['.....os.so......', '.....os.so......', '.....os.so......', '....ossosso.....'],
  run3: ['.....so..os.....', '....so....os....', '...so.......os..', '..sso.......oss.'],
  jump: ['....os....so....', '...os......so...', '................', '................'],
};

const SHADE_TOP = [
  '................',
  '......1111......',
  '.....133331.....',
  '....13333331....',
  '....1333rr31....',
  '....13333331....',
  '.....133331.....',
  '......1331......',
  '....11133111....',
  '...1333333331...',
  '..133333333331..',
  '..13.133331.31..',
  '.13..133331..31.',
  '.13..133331..31.',
  '.13..133331..31.',
  '13...133331...31',
  '13...133331...31',
  '3....133331....3',
  '3....133331....3',
  '.....133331.....',
  '.....122221.....',
];
const SHADE_LEGS_A = [
  '.....12..21.....', '.....12..21.....', '.....12..21.....', '.....12..21.....',
  '.....12..21.....', '....12....21....', '....12....21....', '....12....21....',
  '...12......21...', '...12......21...', '..111......111..',
];
const SHADE_LEGS_B = [
  '.....12..21.....', '.....12...21....', '....12....21....', '....12.....21...',
  '...12......21...', '...12.......21..', '..12........21..', '..12.........21.',
  '.12..........21.', '.12...........1.', '111..........11.',
];

const BAT = [
  [
    '1..............1',
    '11............11',
    '.11...1..1...11.',
    '.1111.1111.1111.',
    '..111111111111..',
    '...111r11r111...',
    '.....111111.....',
    '......1111......',
  ],
  [
    '................',
    '................',
    '......1..1......',
    '......1111......',
    '....11111111....',
    '..1111r11r1111..',
    '.1111.1111.1111.',
    '11.....11.....11',
  ],
];

const ICONS = {
  flashlight: [
    '................',
    '................',
    '................',
    '..........wwo...',
    '.ooooooooowwwo..',
    '.o3444445o6wwo..',
    '.o3455545o6wwo..',
    '.o3444445o6wwo..',
    '.ooooooooowwwo..',
    '..........wwo...',
  ],
  crowbar: [
    '.............44.',
    '............5..4',
    '...........5...4',
    '..........5.....',
    '.........5......',
    '........5.......',
    '.......5........',
    '......4.........',
    '.....4..........',
    '....4...........',
    '...4............',
    '..4.............',
    '.4R.............',
    '.rR.............',
  ],
  umbrella: [
    '.......1........',
    '......151.......',
    '.....15551......',
    '....1555551.....',
    '...155555551....',
    '..15556555551...',
    '.1555565555551..',
    '.1.1.1.5.1.1.1..',
    '.......5........',
    '.......5........',
    '.......5........',
    '.......5........',
    '.....5.5........',
    '......5.........',
  ],
};

const UMBRELLA_OPEN = [
  '..........1111111111..........',
  '.......1115555555555111.......',
  '.....11555555565555555511.....',
  '...115555555556555555555511...',
  '..15555555555565555555555551..',
  '.1555555555555655555555555551.',
  '155555555555556555555555555551',
  '1.1..1..1..1..5..1..1..1..1.11',
  '..............5...............',
  '..............5...............',
  '..............5...............',
  '..............5...............',
];

const TILE = { DIRT: 0, DIRT_TOP: 1, BEAM: 2, BG: 3, CAVE: 4, ROCK: 5, ROCK_TOP: 6, STONE: 7, STONE_TOP: 8 };
// Rows at/above this are the abandoned church; rows below are cave rock.
const CAVE_Y = 28;

function makeArt(scene) {
  // Player frames: 0 idle, 1-3 run, 4 jump.
  sheet(
    scene,
    'child',
    [LEGS.idle, LEGS.run1, LEGS.run2, LEGS.run3, LEGS.jump].map((l) => [...CHILD_BODY, ...l]),
    16,
    24,
  );
  sheet(scene, 'shade', [[...SHADE_TOP, ...SHADE_LEGS_A], [...SHADE_TOP, ...SHADE_LEGS_B]], 16, 32);
  sheet(scene, 'bat', BAT, 16, 8);
  for (const [k, rows] of Object.entries(ICONS)) sheet(scene, `tool_${k}`, [rows], 16, 16);
  sheet(scene, 'umbrella_open', [UMBRELLA_OPEN], 30, 12);

  fromCanvas(scene, 'eyes', 8, 4, (c) => {
    c.fillStyle = 'rgba(255,0,0,0.35)';
    c.fillRect(0, 0, 8, 4);
    c.fillStyle = PAL.r;
    c.fillRect(1, 1, 2, 2);
    c.fillRect(5, 1, 2, 2);
  });
  fromCanvas(scene, 'eyes_small', 6, 3, (c) => {
    c.fillStyle = PAL.r;
    c.fillRect(0, 1, 1, 1);
    c.fillRect(3, 1, 1, 1);
    c.fillStyle = 'rgba(255,0,0,0.3)';
    c.fillRect(0, 0, 5, 3);
  });

  makeTiles(scene);
  makeProps(scene);
  makeLights(scene);
  makeBackdrops(scene);
  makeLogo(scene);
  makeFx(scene);
}

// Barren-earth terrain: packed dirt up top, cave rock below, ruin stone inside
// the abandoned church. Each tile is 16px wide and drawn at ox on the sheet.
function dirt(c, ox, rand, top) {
  c.fillStyle = '#2c2117';
  c.fillRect(ox, 0, 16, 16);
  const clump = ['#35281a', '#241b12', '#3d2d1c', '#1d150e'];
  for (let i = 0; i < 34; i++) {
    c.fillStyle = clump[Math.floor(rand() * 4)];
    c.fillRect(ox + Math.floor(rand() * 15), Math.floor(rand() * 16), 1 + Math.floor(rand() * 3), 1);
  }
  for (let i = 0; i < 6; i++) {
    c.fillStyle = rand() > 0.5 ? '#5b4a30' : '#6d5a3c';
    c.fillRect(ox + Math.floor(rand() * 15), Math.floor(rand() * 15), 1, 1);
  }
  if (top) {
    c.fillStyle = '#6b573a';
    c.fillRect(ox, 0, 16, 1);
    c.fillStyle = '#4a3826';
    c.fillRect(ox, 1, 16, 1);
    for (let i = 0; i < 5; i++) {
      c.fillStyle = rand() > 0.5 ? '#5d5a2a' : '#3f3d1c';
      c.fillRect(ox + Math.floor(rand() * 15), 0, 1, 1 + Math.floor(rand() * 2));
    }
  }
}

function rock(c, ox, rand, top) {
  c.fillStyle = '#1b1814';
  c.fillRect(ox, 0, 16, 16);
  for (let i = 0; i < 7; i++) {
    c.fillStyle = rand() > 0.5 ? '#282320' : '#33302a';
    const w = 4 + Math.floor(rand() * 9);
    const h = 2 + Math.floor(rand() * 4);
    c.fillRect(ox + Math.floor(rand() * (16 - w)), Math.floor(rand() * (16 - h)), w, h);
  }
  for (let i = 0; i < 5; i++) {
    c.fillStyle = '#0f0d0b';
    c.fillRect(ox + Math.floor(rand() * 16), Math.floor(rand() * 16), 1, 1 + Math.floor(rand() * 3));
  }
  if (top) {
    c.fillStyle = '#4a463e';
    c.fillRect(ox, 0, 16, 1);
    c.fillStyle = '#2a2722';
    c.fillRect(ox, 1, 16, 1);
  }
}

function stone(c, ox, rand, top) {
  c.fillStyle = '#1a1815';
  c.fillRect(ox, 0, 16, 16);
  const cols = ['#3a352e', '#2c2822', '#443d33'];
  for (let i = 0; i < 18; i++) {
    c.fillStyle = cols[Math.floor(rand() * 3)];
    c.fillRect(ox + Math.floor(rand() * 15), Math.floor(rand() * 15), 1 + Math.floor(rand() * 3), 1);
  }
  c.fillStyle = '#0d0c0a';
  c.fillRect(ox, 7, 16, 1);
  c.fillRect(ox + 7, 0, 1, 7);
  c.fillRect(ox + 3, 8, 1, 8);
  if (top) {
    c.fillStyle = '#69625a';
    c.fillRect(ox, 0, 16, 1);
    c.fillStyle = '#3a352e';
    c.fillRect(ox, 1, 16, 1);
  }
}

function wall(c, ox, rand, cave) {
  c.fillStyle = cave ? '#12100d' : '#1a140d';
  c.fillRect(ox, 0, 16, 16);
  for (let i = 0; i < 14; i++) {
    c.fillStyle = cave ? (rand() > 0.5 ? '#1a1712' : '#0d0b09') : rand() > 0.5 ? '#241c12' : '#0f0b07';
    c.fillRect(ox + Math.floor(rand() * 15), Math.floor(rand() * 15), 1 + Math.floor(rand() * 2), 1);
  }
}

function makeTiles(scene) {
  const rand = rng(7);
  fromCanvas(scene, 'tiles', 16 * 9, 16, (c) => {
    dirt(c, 0, rand, false);
    dirt(c, 16, rand, true);
    // dry beam (one-way platform)
    c.fillStyle = '#0c0c0c';
    c.fillRect(32, 0, 16, 6);
    c.fillStyle = '#3f3222';
    c.fillRect(32, 0, 16, 4);
    c.fillStyle = '#6a5535';
    c.fillRect(32, 0, 16, 1);
    c.fillStyle = '#2a2014';
    c.fillRect(34, 2, 5, 1);
    c.fillRect(42, 1, 4, 1);
    c.fillStyle = '#1a1209';
    c.fillRect(33, 4, 2, 5);
    c.fillRect(45, 4, 2, 5);
    wall(c, 48, rand, false);
    wall(c, 64, rand, true);
    rock(c, 80, rand, false);
    rock(c, 96, rand, true);
    stone(c, 112, rand, false);
    stone(c, 128, rand, true);
  });

  fromCanvas(scene, 'cracked', 16, 16, (c) => {
    rock(c, 0, rng(7), false);
    c.fillStyle = '#000';
    [[8, 0], [7, 2], [8, 4], [6, 6], [7, 8], [9, 10], [8, 12], [10, 14], [9, 15]].forEach(([x, y]) => c.fillRect(x, y, 1, 2));
    c.fillRect(3, 5, 4, 1);
    c.fillRect(9, 10, 4, 1);
    c.fillStyle = '#8a8a8a';
    c.fillRect(9, 3, 1, 1);
    c.fillRect(5, 9, 1, 1);
  });

  fromCanvas(scene, 'spikes', 16, 16, (c) => {
    for (let i = 0; i < 4; i++) {
      const x = i * 4;
      for (let y = 0; y < 10; y++) {
        const half = Math.floor((y + 1) / 5);
        c.fillStyle = y < 2 ? '#cfc7b4' : '#6b6152';
        c.fillRect(x + 2 - half, 6 + y, 1 + half * 2, 1);
      }
    }
    c.fillStyle = '#7a0008';
    c.fillRect(2, 8, 1, 2);
    c.fillRect(10, 7, 1, 3);
  });

  fromCanvas(scene, 'veil', 32, 32, (c) => {
    const r = rng(99);
    c.fillStyle = '#000';
    c.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * 32);
      const y = Math.floor(r() * 32);
      const l = 2 + Math.floor(r() * 8);
      c.fillStyle = r() > 0.85 ? '#5a5a5a' : '#1e1e1e';
      c.fillRect(x, y, 1, l);
    }
    c.fillStyle = '#7a0008';
    c.fillRect(12, 9, 1, 1);
    c.fillRect(25, 22, 1, 1);
  });
}

// A leafless llanos tree: recursive limbs, drawn thick and gnarled.
function drawTree(c, x0, y0, len, w, r) {
  const b = (x, y, a, l, w) => {
    if (l < 5 || w < 1) return;
    const x2 = x + Math.cos(a) * l;
    const y2 = y + Math.sin(a) * l;
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x2, y2);
    c.stroke();
    b(x2, y2, a - 0.35 - r() * 0.4, l * 0.72, w * 0.68);
    b(x2, y2, a + 0.3 + r() * 0.4, l * 0.68, w * 0.68);
  };
  b(x0, y0, -Math.PI / 2, len, w);
}

function makeProps(scene) {
  fromCanvas(scene, 'grave', 14, 18, (c) => {
    c.fillStyle = '#0c0c0c';
    c.fillRect(1, 3, 12, 15);
    c.fillRect(3, 1, 8, 2);
    c.fillStyle = '#4a4a4a';
    c.fillRect(2, 4, 10, 14);
    c.fillRect(4, 2, 6, 2);
    c.fillStyle = '#6a6a6a';
    c.fillRect(2, 4, 1, 12);
    c.fillStyle = '#1a1a1a';
    c.fillRect(6, 6, 2, 7);
    c.fillRect(4, 8, 6, 2);
  });
  fromCanvas(scene, 'cross', 12, 24, (c) => {
    c.fillStyle = '#0c0c0c';
    c.fillRect(4, 0, 4, 24);
    c.fillRect(0, 5, 12, 4);
    c.fillStyle = '#555';
    c.fillRect(5, 1, 2, 23);
    c.fillRect(1, 6, 10, 2);
  });
  fromCanvas(scene, 'tree', 70, 112, (c) => {
    c.strokeStyle = '#241a10';
    c.lineCap = 'round';
    drawTree(c, 35, 112, 38, 7, rng(3));
  });
  fromCanvas(scene, 'scrub', 26, 12, (c) => {
    const r = rng(17);
    c.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const x = 2 + r() * 22;
      c.strokeStyle = r() > 0.5 ? '#4a4520' : '#33300f';
      c.beginPath();
      c.moveTo(x, 12);
      c.lineTo(x + (r() - 0.5) * 8, 12 - 3 - r() * 8);
      c.stroke();
    }
  });
  fromCanvas(scene, 'stalagmite', 20, 24, (c) => {
    const sp = (col, w) => {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(10, 0);
      c.lineTo(10 + w, 24);
      c.lineTo(10 - w, 24);
      c.closePath();
      c.fill();
    };
    sp('#0c0a08', 9);
    sp('#2f2a23', 7);
    sp('#464039', 4);
  });
  // Candle (2 flame frames); flame drawn separately in makeFx.
  fromCanvas(scene, 'candle', 4, 10, (c) => {
    c.fillStyle = '#d8d8d8';
    c.fillRect(0, 2, 4, 8);
    c.fillStyle = '#9a9a9a';
    c.fillRect(3, 2, 1, 8);
    c.fillStyle = '#fff';
    c.fillRect(1, 1, 1, 3);
    c.fillStyle = '#000';
    c.fillRect(2, 0, 1, 2);
  });
  fromCanvas(scene, 'candelabra', 22, 30, (c) => {
    c.fillStyle = '#2a2a2a';
    c.fillRect(10, 8, 2, 20);
    c.fillRect(6, 28, 10, 2);
    c.fillRect(2, 8, 18, 2);
    c.fillRect(2, 4, 2, 6);
    c.fillRect(18, 4, 2, 6);
    c.fillStyle = '#d8d8d8';
    c.fillRect(2, 0, 2, 4);
    c.fillRect(10, 1, 2, 7);
    c.fillRect(18, 0, 2, 4);
  });
  ['shrine', 'shrine_lit'].forEach((key, lit) =>
    fromCanvas(scene, key, 24, 22, (c) => {
      c.fillStyle = '#0c0c0c';
      c.fillRect(2, 10, 20, 12);
      c.fillStyle = '#4a4a4a';
      c.fillRect(3, 11, 18, 11);
      c.fillStyle = '#6a6a6a';
      c.fillRect(3, 11, 18, 1);
      c.fillStyle = '#7a0008';
      c.fillRect(11, 14, 2, 6);
      c.fillRect(9, 16, 6, 2);
      c.fillStyle = '#d8d8d8';
      c.fillRect(5, 4, 3, 7);
      c.fillRect(11, 2, 3, 9);
      c.fillRect(17, 5, 3, 6);
      if (!lit) {
        c.fillStyle = '#000';
        c.fillRect(6, 3, 1, 1);
        c.fillRect(12, 1, 1, 1);
        c.fillRect(18, 4, 1, 1);
      }
    }),
  );
  fromCanvas(scene, 'window', 32, 72, (c) => {
    const arch = () => {
      c.beginPath();
      c.moveTo(2, 72);
      c.lineTo(2, 24);
      c.quadraticCurveTo(2, 4, 16, 0);
      c.quadraticCurveTo(30, 4, 30, 24);
      c.lineTo(30, 72);
      c.closePath();
    };
    c.fillStyle = '#0a0a0a';
    arch();
    c.fill();
    c.save();
    arch();
    c.clip();
    const r = rng(11);
    for (let y = 0; y < 72; y += 6) {
      for (let x = 4; x < 30; x += 6) {
        const p = r();
        c.fillStyle = p > 0.88 ? '#6a0008' : p > 0.5 ? '#3a3a3a' : '#262626';
        c.fillRect(x, y, 5, 5);
      }
    }
    c.fillStyle = '#0a0a0a';
    c.fillRect(15, 0, 2, 72);
    c.fillRect(0, 36, 32, 2);
    c.restore();
    c.strokeStyle = '#555';
    c.lineWidth = 1;
    arch();
    c.stroke();
  });
  fromCanvas(scene, 'rose', 64, 64, (c) => {
    c.fillStyle = '#0a0a0a';
    c.beginPath();
    c.arc(32, 32, 31, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.fillStyle = i % 3 === 0 ? '#6a0008' : '#333';
      c.beginPath();
      c.arc(32 + Math.cos(a) * 19, 32 + Math.sin(a) * 19, 8, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#7a0008';
    c.beginPath();
    c.arc(32, 32, 8, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#5a5a5a';
    c.beginPath();
    c.arc(32, 32, 30, 0, Math.PI * 2);
    c.stroke();
  });
  fromCanvas(scene, 'pillar', 20, 16, (c) => {
    c.fillStyle = '#101010';
    c.fillRect(0, 0, 20, 16);
    c.fillStyle = '#222';
    c.fillRect(2, 0, 16, 16);
    c.fillStyle = '#2e2e2e';
    c.fillRect(4, 0, 3, 16);
    c.fillStyle = '#161616';
    c.fillRect(13, 0, 3, 16);
  });
  fromCanvas(scene, 'vault', 128, 48, (c) => {
    c.strokeStyle = '#262626';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(0, 48);
    c.quadraticCurveTo(0, 6, 64, 0);
    c.quadraticCurveTo(128, 6, 128, 48);
    c.stroke();
    c.strokeStyle = '#181818';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(12, 48);
    c.quadraticCurveTo(14, 14, 64, 8);
    c.quadraticCurveTo(114, 14, 116, 48);
    c.stroke();
  });
  fromCanvas(scene, 'bell', 48, 52, (c) => {
    c.fillStyle = '#0c0c0c';
    c.beginPath();
    c.moveTo(20, 2);
    c.lineTo(28, 2);
    c.quadraticCurveTo(38, 4, 39, 22);
    c.quadraticCurveTo(40, 38, 47, 46);
    c.lineTo(1, 46);
    c.quadraticCurveTo(8, 38, 9, 22);
    c.quadraticCurveTo(10, 4, 20, 2);
    c.fill();
    c.fillStyle = '#6a6a6a';
    c.beginPath();
    c.moveTo(21, 4);
    c.lineTo(27, 4);
    c.quadraticCurveTo(36, 6, 37, 22);
    c.quadraticCurveTo(38, 37, 44, 44);
    c.lineTo(4, 44);
    c.quadraticCurveTo(10, 37, 11, 22);
    c.quadraticCurveTo(12, 6, 21, 4);
    c.fill();
    c.fillStyle = '#9a9a9a';
    c.fillRect(15, 10, 3, 28);
    c.fillStyle = '#3a3a3a';
    c.fillRect(31, 10, 3, 30);
    c.fillRect(6, 40, 36, 2);
    c.fillStyle = '#1a1a1a';
    c.fillRect(22, 44, 4, 8);
    c.fillStyle = '#7a0008';
    c.fillRect(20, 20, 8, 2);
    c.fillRect(23, 16, 2, 10);
  });
}

function makeLights(scene) {
  fromCanvas(scene, 'light', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  // Flashlight cone, origin at left-middle, pointing right.
  fromCanvas(scene, 'cone', 256, 160, (c) => {
    const img = c.createImageData(256, 160);
    const spread = 0.42; // radians half-angle
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 256; x++) {
        const dx = x;
        const dy = y - 80;
        const d = Math.hypot(dx, dy);
        const a = Math.abs(Math.atan2(dy, dx + 0.001));
        let v = 0;
        if (a < spread && d < 256) {
          const edge = 1 - Math.pow(a / spread, 3);
          const fall = 1 - Math.pow(d / 256, 2.4);
          v = Math.max(0, edge * fall);
          if (d < 14) v = Math.max(v, 1 - d / 14);
        }
        const i = (y * 256 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.floor(v * 255);
      }
    }
    c.putImageData(img, 0, 0);
  });
}

// Title logo letters: polylines on a 4x6 grid, stroked thick so no font is needed.
const GLYPHS = {
  E: [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  L: [[0, 0, 0, 6, 4, 6]],
  A: [[0, 6, 1.3, 0, 2.7, 0, 4, 6], [0.8, 4, 3.2, 4]],
  P: [[0, 6, 0, 0, 4, 0, 4, 3.2, 0, 3.2]],
  G: [[4, 0, 0, 0, 0, 6, 4, 6, 4, 3.2, 2.2, 3.2]],
  O: [[0, 0, 4, 0, 4, 6, 0, 6, 0, 0, 4, 0]],
  N: [[0, 6, 0, 0, 4, 6, 4, 0]],
};

// Arcade-chrome logo: slanted block letters, cool sky above the horizon, fire below.
function makeLogo(scene) {
  fromCanvas(scene, 'logo', 480, 150, (c) => {
    c.lineJoin = 'round';
    const word = (text, x, y, u, sw) => {
      const chrome = c.createLinearGradient(0, -sw / 2, 0, u * 6 + sw / 2);
      [
        [0, '#2a1590'],
        [0.32, '#8f7bff'],
        [0.5, '#ffffff'],
        [0.5, '#8a0010'],
        [0.78, '#ff5a1a'],
        [1, '#ffe14a'],
      ].forEach(([at, col]) => chrome.addColorStop(at, col));
      // drop shadow, white rim, dark keyline, chrome face
      [
        [sw + 8, '#000', 4],
        [sw + 8, '#fff', 0],
        [sw + 3, '#16093f', 0],
        [sw, chrome, 0],
      ].forEach(([lw, style, off]) => {
        c.lineWidth = lw;
        c.strokeStyle = style;
        [...text].forEach((ch, i) => {
          c.setTransform(1, 0, -0.3, 1, x + i * (u * 4 + sw + u) + off, y + off);
          for (const line of GLYPHS[ch]) {
            c.beginPath();
            for (let k = 0; k < line.length; k += 2) c.lineTo(line[k] * u, line[k + 1] * u);
            c.stroke();
          }
        });
      });
    };
    word('EL', 214, 14, 5, 8);
    word('APAGON', 56, 64, 11, 15);
  });
}

function makeBackdrops(scene) {
  fromCanvas(scene, 'sky', 640, 480, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 480);
    g.addColorStop(0, '#04050a');
    g.addColorStop(0.55, '#141118');
    g.addColorStop(0.8, '#2a1d19');
    g.addColorStop(1, '#3c2b1c');
    c.fillStyle = g;
    c.fillRect(0, 0, 640, 480);
    const r = rng(21);
    for (let i = 0; i < 56; i++) {
      const x = r() * 700 - 30;
      const y = r() * 260;
      const w = 60 + r() * 140;
      c.fillStyle = `rgba(${r() > 0.5 ? '34,30,30' : '16,14,18'},0.5)`;
      c.beginPath();
      c.ellipse(x, y, w / 2, 8 + r() * 14, 0, 0, Math.PI * 2);
      c.fill();
    }
  });

  // Far savanna: flat horizon, a ragged treeline and one church ruin.
  fromCanvas(scene, 'hills', 640, 480, (c) => {
    const r = rng(5);
    c.fillStyle = '#0a0908';
    c.fillRect(0, 340, 640, 140);
    c.beginPath();
    c.moveTo(0, 352);
    for (let x = 0; x <= 640; x += 32) c.lineTo(x, 340 - r() * 10);
    c.lineTo(640, 480);
    c.lineTo(0, 480);
    c.closePath();
    c.fill();
    for (let x = 8; x < 640; x += 26 + r() * 50) {
      c.fillStyle = '#060605';
      const h = 18 + r() * 26;
      c.fillRect(x, 340 - h, 2, h + 6);
      c.beginPath();
      c.ellipse(x + 1, 340 - h, 9 + r() * 8, 5 + r() * 5, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#0d0c0b';
    c.fillRect(150, 296, 30, 44);
    c.beginPath();
    c.moveTo(144, 296);
    c.lineTo(165, 272);
    c.lineTo(186, 296);
    c.closePath();
    c.fill();
    c.fillRect(146, 288, 38, 3);
    c.fillStyle = '#2a0008';
    c.fillRect(162, 312, 6, 12);
  });

  // Nearer grove of dry trees and scrub, darker than the horizon.
  fromCanvas(scene, 'grove', 640, 480, (c) => {
    const r = rng(8);
    c.fillStyle = '#050504';
    c.fillRect(0, 430, 640, 50);
    for (let x = -10; x < 660; x += 80 + r() * 90) drawTree(c, x, 440, 40 + r() * 40, 4 + r() * 3, r);
    c.lineWidth = 1;
    for (let x = 0; x < 640; x += 5 + r() * 9) {
      c.strokeStyle = '#0b0a08';
      c.beginPath();
      c.moveTo(x, 442);
      c.lineTo(x + (r() - 0.5) * 10, 442 - 8 - r() * 16);
      c.stroke();
    }
  });
}

function makeFx(scene) {
  fromCanvas(scene, 'drop', 4, 14, (c) => {
    c.strokeStyle = 'rgba(220,220,220,0.9)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(3.5, 0);
    c.lineTo(0.5, 14);
    c.stroke();
  });
  fromCanvas(scene, 'px', 2, 2, (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 2, 2);
  });
  fromCanvas(scene, 'blood', 3, 3, (c) => {
    c.fillStyle = '#c00010';
    c.fillRect(0, 0, 3, 3);
    c.fillStyle = '#ff1a1a';
    c.fillRect(0, 0, 1, 1);
  });
  [0, 1, 2].forEach((v) =>
    fromCanvas(scene, `splat${v}`, 14, 4, (c) => {
      const r = rng(40 + v);
      c.fillStyle = '#8a0010';
      c.fillRect(2, 2, 10, 2);
      for (let i = 0; i < 9; i++) {
        c.fillStyle = r() > 0.5 ? '#b0000e' : '#5a0008';
        c.fillRect(Math.floor(r() * 14), 1 + Math.floor(r() * 3), 1 + Math.floor(r() * 3), 1);
      }
    }),
  );
  fromCanvas(scene, 'chunk', 4, 4, (c) => {
    c.fillStyle = '#4a4a4a';
    c.fillRect(0, 0, 4, 4);
    c.fillStyle = '#777';
    c.fillRect(0, 0, 2, 1);
  });
  fromCanvas(scene, 'smoke', 6, 6, (c) => {
    c.fillStyle = 'rgba(180,180,180,0.6)';
    c.beginPath();
    c.arc(3, 3, 3, 0, Math.PI * 2);
    c.fill();
  });
  sheet(
    scene,
    'flame',
    [
      ['..w..', '.www.', '.wrw.', '.wrw.', '..r..'],
      ['...w.', '..ww.', '.wwr.', '.wrw.', '..r..'],
    ],
    5,
    5,
  );
  const heart = ['.RR.RR.', 'RrrRrrR', 'RrrrrrR', '.RrrrR.', '..RrR..', '...R...'];
  const empty = ['.44.44.', '4..4..4', '4.....4', '.4...4.', '..4.4..', '...4...'];
  sheet(scene, 'heart', [heart, empty], 7, 6);
}

// The whole map, built from rectangles on a tile grid.
//
// Route (each gate needs a tool):
//   Graveyard ──veil(flashlight)──▶ Nave ──climb──▶ Gallery (crowbar)
//   Nave floor ──cracked stone(crowbar)──▶ Crypt ──veil──▶ Umbrella ──shaft──▶ Nave
//   Gallery ──chasm(glide: umbrella)──▶ Belfry ──cracked wall──▶ ──veil──▶ Great Bell
//
// Entity coordinates are in tiles; `y` is the row the entity stands on
// (the top of the ground under it), so its feet are at y * 16.

const T = 16;
const W = 150;
const H = 40;

const EMPTY = 0;
const SOLID = 1;
const BEAM = 2; // one-way platform

function buildWorld() {
  const grid = Array.from({ length: H }, () => new Array(W).fill(EMPTY));
  const interior = Array.from({ length: H }, () => new Array(W).fill(0));
  const ents = [];

  const fill = (x1, y1, x2, y2, v = SOLID, g = grid) => {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) g[y][x] = v;
  };
  const beam = (x1, x2, y) => fill(x1, y, x2, y, BEAM);
  const e = (type, x, y, extra = {}) => ents.push({ type, x, y, ...extra });
  const cracked = (x1, y1, x2, y2) => {
    fill(x1, y1, x2, y2, EMPTY);
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) e('cracked', x, y);
  };
  const spikes = (x1, x2, y, abyss = false) => {
    for (let x = x1; x <= x2; x++) e('spikes', x, y, { abyss });
  };

  // World shell
  fill(0, 0, 1, H - 1);
  fill(W - 2, 0, W - 1, H - 1);
  fill(0, H - 2, W - 1, H - 1);

  // Llanos flatlands: dry earth, leafless trees and low scrub.
  fill(2, 26, 33, 37);
  fill(12, 25, 16, 25);
  fill(24, 24, 27, 25);
  e('player', 5, 26);
  e('shrine', 8, 26, { lit: true });
  e('tree', 3, 26);
  e('tree', 12, 25);
  e('tree', 21, 26, { flip: true });
  e('tree', 29, 26, { flip: true });
  e('scrub', 10, 26);
  e('scrub', 18, 26);
  e('scrub', 24, 24);
  e('scrub', 31, 26);
  e('grave', 14, 25);
  e('cross', 25, 24);
  e('shade', 20, 26);
  e('candle', 11, 26);
  e('candle', 30, 26);

  // Abandoned church facade with a veiled door.
  fill(34, 0, 35, 20);
  fill(34, 26, 35, 37);
  e('veil', 34, 21, { w: 2, h: 5 });

  // Nave
  fill(36, 0, 89, 3); // vaulted ceiling
  fill(36, 26, 89, 27); // floor (the crypt lies below)
  fill(88, 0, 89, 6); // right wall, upper
  fill(88, 11, 89, 37); // right wall, lower (opening at rows 7-10 onto the chasm)
  fill(36, 4, 87, 25, 1, interior);

  beam(40, 45, 23);
  beam(49, 53, 20);
  beam(56, 60, 17);
  beam(63, 67, 14);
  beam(70, 87, 11); // gallery

  e('shrine', 38, 26);
  e('tool', 78, 11, { tool: 'crowbar' });
  cracked(44, 26, 46, 27); // way down into the crypt
  e('shade', 58, 26);
  e('shade', 78, 26);
  e('bat', 55, 12);
  e('bat', 74, 7);
  e('candelabra', 41, 26);
  e('candelabra', 62, 26);
  e('candelabra', 72, 26);
  e('candle', 71, 11);
  e('candle', 86, 11);
  for (let x = 39; x <= 84; x += 9) e('pillar', x, 4, { h: 22 });
  for (const x of [43.5, 52.5, 70.5, 79.5]) e('window', x, 5);
  e('rose', 61.5, 5);
  for (let x = 39; x < 84; x += 9) e('vault', x, 4);

  // Crypt
  fill(36, 36, 87, 37); // crypt floor
  fill(55, 36, 59, 37, EMPTY); // spike pit
  fill(67, 36, 71, 37, EMPTY); // spike pit
  spikes(55, 59, 38);
  spikes(67, 71, 38);
  fill(36, 28, 87, 37, 1, interior);
  e('veil', 62, 28, { w: 2, h: 8 });
  e('shrine', 49, 36);
  e('tool', 82, 36, { tool: 'umbrella' });
  e('shade', 52, 36);
  e('shade', 77, 36);
  e('bat', 75, 31);
  e('candle', 40, 36);
  e('candle', 65, 36);
  e('candle', 80, 36);
  e('stalagmite', 38, 36);
  e('stalagmite', 44, 36);
  e('stalagmite', 74, 36);
  // Shaft back up to the nave.
  fill(85, 26, 87, 27, EMPTY);
  beam(85, 87, 33);
  beam(85, 87, 30);
  beam(85, 87, 27);

  // Chasm
  spikes(90, 107, 38, true);

  // Belfry tower
  fill(108, 17, 147, 37); // base
  fill(106, 17, 107, 17); // stone lip outside the door
  fill(108, 0, 109, 12); // outer wall (door at rows 13-16)
  fill(108, 0, 147, 1); // roof
  fill(110, 2, 147, 16, 1, interior);
  fill(110, 9, 141, 9); // floor between levels
  beam(142, 147, 9);
  beam(142, 146, 14);
  beam(142, 146, 11);
  cracked(128, 10, 129, 16);
  e('shrine', 112, 17);
  e('shade', 121, 17);
  e('shade', 137, 17);
  e('veil', 130, 2, { w: 2, h: 7 });
  e('bat', 138, 5);
  e('bat', 124, 4);
  e('candle', 116, 17);
  e('candle', 126, 9);
  e('candle', 140, 9);
  e('window', 118, 11);
  e('window', 138, 11);
  e('window', 137, 3);
  e('bell', 117, 2);

  return { grid, interior, ents };
}

// Digital-glitch camera filter: RGB split, tear bands, datamosh blocks,
// pixel-sort streaks, scanline corruption and film grain.
// `intensity` 0..1 drives how broken the picture gets.
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uMainSampler;
uniform vec2 resolution;
uniform float time;
uniform float intensity;
varying vec2 outTexCoord;

float rand(vec2 co) {
  vec3 p = fract(vec3(co.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = outTexCoord;
  float I = intensity;
  float t = mod(floor(time * 14.0), 251.0);

  float band = floor(uv.y * 28.0);
  float br = rand(vec2(band, t));
  float tear = step(1.0 - I * 0.4, br) * (rand(vec2(band + 7.0, t)) - 0.5) * 0.16 * I;

  float line = floor(uv.y * resolution.y);
  float lj = step(1.0 - I * 0.05, rand(vec2(line * 0.37 + t * 3.1, t + 2.0))) * (rand(vec2(line * 1.7, t)) - 0.5) * 0.06;
  uv.x += tear + lj;

  vec2 blk = floor(uv * vec2(20.0, 12.0));
  if (rand(blk + vec2(t * 0.37, t * 0.11)) > 1.0 - I * 0.14) {
    uv += (vec2(rand(blk + 1.3), rand(blk + 2.1)) - 0.5) * 0.08 * (0.5 + I);
  }

  float split = 0.0012 + I * 0.014;
  vec2 dir = vec2(split, split * 0.35 * sin(time * 9.0));
  vec4 base = texture2D(uMainSampler, uv);
  float cr = texture2D(uMainSampler, uv + dir).r;
  float cb = texture2D(uMainSampler, uv - dir).b;
  vec4 col = vec4(cr, base.g, cb, base.a);

  float colId = floor(uv.x * resolution.x / 2.0);
  float sortOn = step(1.0 - I * 0.3, rand(vec2(colId * 0.13, band + t)));
  if (sortOn > 0.5) {
    vec4 m = col;
    for (int i = 1; i < 12; i++) {
      vec4 s = texture2D(uMainSampler, uv + vec2(0.0, float(i) * 3.0 / resolution.y));
      if (luma(s.rgb) > luma(m.rgb)) { m = s; }
    }
    col = mix(col, m, 0.9);
  }

  col.rgb *= 0.86 + 0.14 * sin(outTexCoord.y * resolution.y * 3.14159);

  float cl = step(1.0 - max(0.0, I - 0.12) * 0.03, rand(vec2(line * 0.37 + t * 13.1, t * 7.3 + 5.0)));
  col.rgb = mix(col.rgb, vec3(rand(vec2(line, t))), cl * 0.7);

  col.rgb += (rand(outTexCoord * resolution + t * 17.0) - 0.5) * (0.05 + I * 0.1);

  gl_FragColor = col;
}
`;

// Phaser 3 post-pipeline (registered in the game config) that runs FRAG over a
// whole camera. Each camera gets its own instance; `ctl` is the Glitch controller feeding it.
class GlitchPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game) {
    super({ game, name: 'Glitch', fragShader: FRAG });
  }

  onPreRender() {
    const c = this.ctl;
    this.set2f('resolution', this.renderer.width, this.renderer.height);
    this.set1f('time', c ? c.time : 0);
    this.set1f('intensity', c ? c.intensity : 0);
  }
}

class Glitch {
  constructor(base = 0.04) {
    this.time = 0;
    this.base = base;
    this.intensity = base;
    this.spike = 0;
  }

  // Momentary burst; decays back to `base`.
  hit(amount) {
    this.spike = Math.max(this.spike, amount);
  }

  tick(dt) {
    this.time += dt;
    this.spike *= Math.pow(0.04, dt); // fast exponential decay
    this.intensity = Math.min(1, this.base + this.spike);
  }
}

// Adds glitch + vignette to a camera and returns the glitch controller.
// On the canvas renderer the controller still works, it just draws nothing.
function addCameraFx(camera, base) {
  const glitch = new Glitch(base);
  if (camera.scene.game.renderer.type !== Phaser.WEBGL) return glitch;
  camera.setPostPipeline('Glitch');
  camera.getPostPipeline('Glitch').ctl = glitch;
  camera.postFX.addVignette(0.5, 0.5, 0.9, 0.55);
  return glitch;
}

// `flash` (0..1) is how lit the world is right now — the game uses it to lift the darkness.
class Storm {
  constructor(scene, { rainBackDepth = 40, rainFrontDepth = 62, flashDepth = 55, minGap = 4000, maxGap = 10000 } = {}) {
    this.scene = scene;
    this.flash = 0;
    this.minGap = minGap;
    this.maxGap = maxGap;
    this.onStrike = null;
    const { width, height } = scene.scale;

    this.sky = scene.add.image(0, 0, 'sky').setOrigin(0).setScrollFactor(0).setDepth(-30);
    this.skyFlash = scene.add.rectangle(0, 0, width, height, 0xffffff).setOrigin(0).setScrollFactor(0).setDepth(-29).setAlpha(0);
    this.bolt = scene.add.graphics().setScrollFactor(0).setDepth(-28);

    this.rain = scene.add
      .particles(0, 0, 'drop', {
        x: { min: -60, max: width + 120 },
        y: -20,
        lifespan: 1000,
        speedY: { min: 520, max: 640 },
        speedX: { min: -135, max: -115 },
        alpha: { min: 0.25, max: 0.55 },
        scaleY: { min: 0.7, max: 1.3 },
        quantity: 5,
        frequency: 16,
      })
      .setScrollFactor(0)
      .setDepth(rainBackDepth);

    this.rainFront = scene.add
      .particles(0, 0, 'drop', {
        x: { min: -60, max: width + 120 },
        y: -20,
        lifespan: 750,
        speedY: { min: 700, max: 800 },
        speedX: { min: -170, max: -150 },
        alpha: { min: 0.1, max: 0.22 },
        scale: { min: 1.2, max: 1.6 },
        quantity: 2,
        frequency: 20,
      })
      .setScrollFactor(0)
      .setDepth(rainFrontDepth);

    this.flashRect = scene.add.rectangle(0, 0, width, height, 0xffffff).setOrigin(0).setScrollFactor(0).setDepth(flashDepth).setAlpha(0);

    this.schedule();
  }

  schedule() {
    this.scene.time.delayedCall(Phaser.Math.Between(this.minGap, this.maxGap), () => {
      this.strike();
      this.schedule();
    });
  }

  strike(power = Phaser.Math.FloatBetween(0.6, 1)) {
    const { width } = this.scene.scale;
    this.drawBolt(Phaser.Math.Between(40, width - 40));
    this.flash = power;
    this.scene.time.delayedCall(80, () => (this.flash = 0.15));
    this.scene.time.delayedCall(150, () => {
      this.flash = power;
      this.drawBolt(Phaser.Math.Between(40, width - 40));
    });
    audio.thunder(Phaser.Math.FloatBetween(0.15, 1.4), power);
    if (this.onStrike) this.onStrike(power);
  }

  drawBolt(x) {
    const g = this.bolt;
    g.clear();
    const seg = (x0, y0, len, width, depth) => {
      let x1 = x0;
      let y1 = y0;
      g.lineStyle(width, 0xffffff, 1);
      g.beginPath();
      g.moveTo(x1, y1);
      for (let i = 0; i < len; i++) {
        x1 += Phaser.Math.Between(-14, 14);
        y1 += Phaser.Math.Between(8, 18);
        g.lineTo(x1, y1);
        if (depth < 2 && Math.random() < 0.15) {
          g.strokePath();
          seg(x1, y1, Math.floor(len / 3), Math.max(1, width - 1), depth + 1);
          g.lineStyle(width, 0xffffff, 1);
          g.beginPath();
          g.moveTo(x1, y1);
        }
      }
      g.strokePath();
    };
    seg(x, 0, 21, 2, 0);
  }

  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.bolt.setAlpha(this.flash > 0.3 ? 1 : this.flash * 3);
    this.skyFlash.setAlpha(this.flash * 0.45);
    this.flashRect.setAlpha(this.flash * 0.18);
  }
}

class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    makeArt(this);

    const frames = (key, list) => list.map((frame) => ({ key, frame }));
    this.anims.create({ key: 'child-idle', frames: frames('child', [0]), frameRate: 1 });
    this.anims.create({ key: 'child-run', frames: frames('child', [1, 2, 3, 2]), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'child-jump', frames: frames('child', [4]), frameRate: 1 });
    this.anims.create({ key: 'shade-walk', frames: frames('shade', [0, 1]), frameRate: 3, repeat: -1 });
    this.anims.create({ key: 'bat-fly', frames: frames('bat', [0, 1]), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'flame', frames: frames('flame', [0, 1]), frameRate: 7, repeat: -1 });

    this.scene.start('Title');
  }
}

class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    const { width, height } = this.scale;
    this.starting = false;
    this.glitch = addCameraFx(this.cameras.main, 0.08);
    this.storm = new Storm(this, { minGap: 2500, maxGap: 6000 });
    this.storm.onStrike = (p) => this.glitch.hit(0.5 * p);

    this.add.tileSprite(0, 84, width, height, 'hills').setOrigin(0).setScrollFactor(0).setDepth(-22);
    this.add.tileSprite(0, 70, width, height, 'grove').setOrigin(0).setScrollFactor(0).setDepth(-21);

    this.add.image(width / 2, height - 36, 'child', 0).setOrigin(0.5, 1).setScale(2).setDepth(10);
    this.add.rectangle(0, height - 36, width, 36, 0x050505).setOrigin(0).setDepth(9);
    this.add.image(width / 2 - 120, height - 36, 'shade', 0).setOrigin(0.5, 1).setScale(2).setDepth(8).setAlpha(0.8);
    this.add.image(width / 2 + 150, height - 36, 'shade', 1).setOrigin(0.5, 1).setScale(2).setDepth(8).setAlpha(0.8).setFlipX(true);
    this.eyes = [
      this.add.image(width / 2 - 118, height - 36 - 55, 'eyes').setScale(2).setDepth(12),
      this.add.image(width / 2 + 148, height - 36 - 55, 'eyes').setScale(2).setDepth(12),
    ];

    const serif = 'Georgia, "Times New Roman", serif';
    this.titleShadow = this.add.image(width / 2 + 3, 98, 'logo').setTintFill(0xb00010).setDepth(20);
    this.title = this.add.image(width / 2, 96, 'logo').setDepth(21);
    this.add
      .text(width / 2, 186, 'a storm over the venezuelan plains', { fontFamily: serif, fontSize: '14px', color: '#8c8c8c', fontStyle: 'italic' })
      .setOrigin(0.5)
      .setDepth(21);

    this.add
      .text(
        width / 2,
        240,
        'STICK  move      BUTTON 1  use tool (hold: focus flashlight)\nBUTTON 2  jump / hold to glide      BUTTON 3 / 4  switch tool\n\nGet hit and you drop your tool \u2014 grab it back before it fades.',
        { fontFamily: 'monospace', fontSize: '11px', color: '#9a9a9a', align: 'center', lineSpacing: 4 },
      )
      .setOrigin(0.5)
      .setDepth(21);

    this.prompt = this.add
      .text(width / 2, 326, '[ PRESS START ]', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(21);

    const start = () => {
      if (this.starting) return;
      this.starting = true;
      audio.init();
      audio.startMusic();
      audio.play('glitch');
      this.glitch.hit(1);
      this.storm.strike(1);
      this.cameras.main.fadeOut(700, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Game'));
    };
    anyPress = start;
    this.events.once('shutdown', () => (anyPress = null));
    this.input.once('pointerdown', start);
  }

  update(time, delta) {
    const dt = delta / 1000;
    this.storm.update(dt);
    this.glitch.tick(dt);
    this.prompt.setAlpha(Math.floor(time / 500) % 2 ? 0.35 : 1);

    const g = this.glitch.intensity;
    const jitter = Math.random() < 0.06 + g * 0.3 ? Phaser.Math.Between(-6, 6) : 0;
    this.title.x = this.scale.width / 2 + jitter;
    this.titleShadow.x = this.scale.width / 2 + 3 - jitter * 1.5 + (Math.random() < 0.05 ? 8 : 0);
    for (const e of this.eyes) e.setAlpha(0.6 + Math.random() * 0.4 + this.storm.flash);
  }
}

const RUN = 130;
const JUMP = 360;
const GLIDE_FALL = 36;
const MAX_HEARTS = 3;
const DROP_TIME = 5000; // how long a dropped tool waits on the ground
const BASE_DARK = 0.8;
const HUD_LINGER = 4000; // ms the HUD stays up after a tool change or a hit
const TOOLS = ['flashlight', 'crowbar', 'umbrella'];
const TOOL_NAMES = { flashlight: 'FLASHLIGHT', crowbar: 'CROWBAR', umbrella: 'UMBRELLA' };

class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
    this.world = buildWorld();
    this.cracked = new Map(); // "x,y" -> sprite
    this.lights = []; // static light sources {x, y, r, flicker}
    this.decals = [];
    this.hintsShown = new Set();
    this.dead = false;
    this.won = false;
    this.hearts = MAX_HEARTS;
    this.inventory = new Set(['flashlight']);
    this.found = new Set(['flashlight']);
    this.equipped = 'flashlight';
    this.facing = 1;
    this.invulnUntil = 0;
    this.stunUntil = 0;
    this.lastGround = 0;
    this.jumpPressedAt = -1e9;
    this.attackCooldown = 0;
    this.swingUntil = 0;
    this.gliding = false;
    this.stepTimer = 0;
    this.flicker = 1;

    const cam = this.cameras.main;
    this.glitch = addCameraFx(cam, 0.04);
    this.storm = new Storm(this);
    this.storm.onStrike = (p) => this.glitch.hit(0.35 * p);
    cam.fadeIn(900, 0, 0, 0);

    this.buildBackdrop();
    this.buildTilemaps();
    this.buildFx();
    this.buildEntities();
    this.buildPlayer();
    this.buildDarkness();
    this.buildHud();
    this.buildInput();

    this.physics.world.setBounds(0, 0, W * T, H * T);
    cam.setBounds(0, 0, W * T, H * T);
    cam.startFollow(this.player, true, 0.12, 0.12, 0, 30);

    this.time.delayedCall(900, () => this.hint('start', 'STICK move \u00b7 BUTTON 2 jump \u00b7 your FLASHLIGHT burns what hides in the dark'));
  }

  buildBackdrop() {
    const { width, height } = this.scale;
    this.hills = this.add.tileSprite(0, 0, width, height, 'hills').setOrigin(0).setScrollFactor(0).setDepth(-22);
    this.grove = this.add.tileSprite(0, 0, width, height, 'grove').setOrigin(0).setScrollFactor(0).setDepth(-21);
  }

  buildTilemaps() {
    const { grid, interior } = this.world;
    // The mound is layered: dirt on the surface, ruin stone in the church
    // above row CAVE_Y, and bare cave rock below it.
    const solidTile = (x, y, top) => {
      if (x >= 34 && y < CAVE_Y) return top ? TILE.STONE_TOP : TILE.STONE;
      if (y >= CAVE_Y) return top ? TILE.ROCK_TOP : TILE.ROCK;
      return top ? TILE.DIRT_TOP : TILE.DIRT;
    };
    const bgTile = (x, y) => (y >= CAVE_Y ? TILE.CAVE : x >= 34 ? TILE.STONE : TILE.BG);

    const data = grid.map((row, y) =>
      row.map((v, x) => {
        if (v === SOLID) return solidTile(x, y, y > 0 && grid[y - 1][x] !== SOLID);
        if (v === BEAM) return TILE.BEAM;
        return -1;
      }),
    );
    const bgData = interior.map((row, y) => row.map((v, x) => (v ? bgTile(x, y) : -1)));

    const bgMap = this.make.tilemap({ data: bgData, tileWidth: T, tileHeight: T });
    bgMap.createLayer(0, bgMap.addTilesetImage('tiles', 'tiles', T, T, 0, 0), 0, 0).setDepth(-10);

    const map = this.make.tilemap({ data, tileWidth: T, tileHeight: T });
    this.layer = map.createLayer(0, map.addTilesetImage('tiles', 'tiles', T, T, 0, 0), 0, 0).setDepth(0);
    this.layer.setCollision([TILE.DIRT, TILE.DIRT_TOP, TILE.ROCK, TILE.ROCK_TOP, TILE.STONE, TILE.STONE_TOP]);
    this.layer.forEachTile((t) => {
      if (t.index === TILE.BEAM) t.setCollision(false, false, true, false);
    });
  }

  buildFx() {
    this.bloodFx = this.add
      .particles(0, 0, 'blood', {
        emitting: false,
        lifespan: { min: 500, max: 1100 },
        speed: { min: 60, max: 240 },
        angle: { min: 200, max: 340 },
        gravityY: 700,
        scale: { start: 1, end: 0.4 },
      })
      .setDepth(20);
    this.smokeFx = this.add
      .particles(0, 0, 'smoke', {
        emitting: false,
        lifespan: 600,
        speedY: { min: -60, max: -20 },
        speedX: { min: -20, max: 20 },
        alpha: { start: 0.6, end: 0 },
        scale: { start: 0.6, end: 1.6 },
      })
      .setDepth(21);
    this.emberFx = this.add
      .particles(0, 0, 'px', {
        emitting: false,
        lifespan: 500,
        speed: { min: 20, max: 80 },
        angle: { min: 220, max: 320 },
        tint: [0xff1a1a, 0xffffff],
        scale: { start: 1, end: 0 },
      })
      .setDepth(61);
    this.debrisFx = this.add
      .particles(0, 0, 'chunk', {
        emitting: false,
        lifespan: 900,
        speed: { min: 40, max: 200 },
        angle: { min: 200, max: 340 },
        gravityY: 800,
        rotate: { min: 0, max: 360 },
      })
      .setDepth(20);
    this.splashFx = this.add
      .particles(0, 0, 'px', {
        emitting: false,
        lifespan: 220,
        speedY: { min: -70, max: -30 },
        speedX: { min: -40, max: 40 },
        gravityY: 400,
        scale: { start: 0.6, end: 0.2 },
        alpha: { start: 0.6, end: 0 },
        tint: 0xbbbbbb,
      })
      .setDepth(15);
    this.glitchFx = this.add
      .particles(0, 0, 'px', {
        emitting: false,
        lifespan: 500,
        speed: { min: 20, max: 120 },
        tint: [0xff1a1a, 0xffffff, 0x000000],
        scaleX: { min: 1, max: 5 },
        scaleY: 0.5,
      })
      .setDepth(61);
  }

  buildEntities() {
    this.shades = this.physics.add.group();
    this.bats = this.physics.add.group({ allowGravity: false });
    this.pickups = this.physics.add.group();
    this.crackedGroup = this.physics.add.staticGroup();
    this.spikeGroup = this.physics.add.staticGroup();
    this.veilGroup = this.physics.add.staticGroup();
    this.veils = [];
    this.shrines = [];

    for (const ent of this.world.ents) {
      const px = ent.x * T + T / 2;
      const py = ent.y * T;
      switch (ent.type) {
        case 'player':
          this.spawn = { x: px, y: py };
          break;
        case 'shrine': {
          const s = this.add.image(px, py, ent.lit ? 'shrine_lit' : 'shrine').setOrigin(0.5, 1).setDepth(2);
          const shrine = { sprite: s, x: px, y: py, lit: !!ent.lit, flames: [] };
          if (ent.lit) this.lightShrine(shrine, true);
          this.shrines.push(shrine);
          if (ent.lit) this.checkpoint = shrine;
          break;
        }
        case 'tree':
          this.add.image(px, py + 2, 'tree').setOrigin(0.5, 1).setDepth(-3).setFlipX(!!ent.flip);
          break;
        case 'grave':
        case 'cross':
          this.add.image(px, py + 1, ent.type).setOrigin(0.5, 1).setDepth(-2);
          break;
        case 'scrub':
          this.add.image(px, py + 1, 'scrub').setOrigin(0.5, 1).setDepth(-2);
          break;
        case 'stalagmite':
          this.add.image(px, py + 1, 'stalagmite').setOrigin(0.5, 1).setDepth(-1);
          break;
        case 'candle':
          this.add.image(px, py, 'candle').setOrigin(0.5, 1).setDepth(-1);
          this.addFlame(px, py - 10, 34);
          break;
        case 'candelabra':
          this.add.image(px, py, 'candelabra').setOrigin(0.5, 1).setDepth(-1);
          this.addFlame(px - 8, py - 30, 0);
          this.addFlame(px, py - 29, 0);
          this.addFlame(px + 8, py - 30, 0);
          this.lights.push({ x: px, y: py - 28, r: 70, flicker: true });
          break;
        case 'pillar':
          this.add.tileSprite(px, ent.y * T, 20, ent.h * T, 'pillar').setOrigin(0.5, 0).setDepth(-8);
          break;
        case 'vault':
          this.add.image(px, ent.y * T, 'vault').setOrigin(0, 0).setDisplaySize(9 * T, 48).setDepth(-7);
          break;
        case 'window':
          this.add.image(ent.x * T, ent.y * T, 'window').setOrigin(0.5, 0).setDepth(-7);
          break;
        case 'rose':
          this.add.image(ent.x * T, ent.y * T, 'rose').setOrigin(0.5, 0).setDepth(-7);
          break;
        case 'bell':
          this.bell = this.add.image(ent.x * T, ent.y * T, 'bell').setOrigin(0.5, 0).setDepth(-1);
          this.add.rectangle(ent.x * T, ent.y * T - 4, 60, 6, 0x1a1a1a).setDepth(-2);
          this.bellZone = new Phaser.Geom.Rectangle(ent.x * T - 56, ent.y * T, 112, 7 * T);
          this.lights.push({ x: ent.x * T, y: ent.y * T + 30, r: 50, flicker: false });
          break;
        case 'cracked': {
          const c = this.crackedGroup.create(ent.x * T + 8, ent.y * T + 8, 'cracked');
          c.tx = ent.x;
          c.ty = ent.y;
          this.cracked.set(`${ent.x},${ent.y}`, c);
          break;
        }
        case 'spikes': {
          const s = this.spikeGroup.create(px, py - 8, 'spikes');
          s.body.setSize(14, 8).setOffset(1, 8);
          s.abyss = ent.abyss;
          break;
        }
        case 'veil': {
          const v = this.add.tileSprite(ent.x * T, ent.y * T, ent.w * T, ent.h * T, 'veil').setOrigin(0).setDepth(3);
          this.veilGroup.add(v);
          v.strength = 1;
          v.rect = new Phaser.Geom.Rectangle(ent.x * T, ent.y * T, ent.w * T, ent.h * T);
          this.veils.push(v);
          break;
        }
        case 'tool':
          this.spawnPickup(ent.tool, px, py - 10, 0, 0, null);
          break;
        case 'shade':
          this.spawnShade(px, py);
          break;
        case 'bat':
          this.spawnBat(px, ent.y * T + 8);
          break;
      }
    }

    this.physics.add.collider(this.shades, this.layer);
    this.physics.add.collider(this.shades, this.crackedGroup);
    this.physics.add.collider(this.shades, this.veilGroup);
    this.physics.add.collider(this.pickups, this.layer);
    this.physics.add.collider(this.pickups, this.crackedGroup);
  }

  addFlame(x, y, r) {
    this.add.sprite(x, y, 'flame').setOrigin(0.5, 1).setDepth(60).play({ key: 'flame', startFrame: Phaser.Math.Between(0, 1) });
    if (r) this.lights.push({ x, y, r, flicker: true });
  }

  lightShrine(shrine, silent) {
    shrine.lit = true;
    shrine.sprite.setTexture('shrine_lit');
    for (const dx of [-5, 1, 7]) this.addFlame(shrine.x + dx - 0.5, shrine.y - 17 + (dx === 1 ? -2 : 0), 0);
    const l = { x: shrine.x, y: shrine.y - 16, r: 80, flicker: true };
    this.lights.push(l);
    if (this.dark) {
      l.glow = this.add.image(l.x, l.y, 'light').setBlendMode(Phaser.BlendModes.ADD).setDepth(45).setScale(88 / 64);
    }
    if (!silent) {
      audio.play('checkpoint');
      this.message('The candles remember you.');
    }
  }

  spawnShade(x, y) {
    const s = this.shades.create(x, y, 'shade', 0);
    s.setOrigin(0.5, 1).setDepth(12);
    s.body.setSize(10, 28).setOffset(3, 4);
    s.kind = 'shade';
    s.hp = 3;
    s.dir = Math.random() < 0.5 ? -1 : 1;
    s.chasing = false;
    s.stunUntil = 0;
    s.burning = 0;
    s.eyes = this.add.image(x, y, 'eyes').setDepth(60);
    s.play('shade-walk');
    return s;
  }

  spawnBat(x, y) {
    const b = this.bats.create(x, y, 'bat', 0);
    b.setDepth(12);
    b.body.setAllowGravity(false);
    b.body.setSize(12, 6).setOffset(2, 1);
    b.kind = 'bat';
    b.hp = 1;
    b.home = { x, y };
    b.state = 'hover';
    b.t = Math.random() * 10;
    b.stateUntil = 0;
    b.burning = 0;
    b.eyes = this.add.image(x, y, 'eyes_small').setDepth(60);
    b.play('bat-fly');
    return b;
  }

  spawnPickup(tool, x, y, vx, vy, expires) {
    const p = this.pickups.create(x, y, `tool_${tool}`);
    p.setDepth(14);
    p.body.setSize(12, 12);
    p.setBounce(0.35);
    p.setDragX(160);
    p.setVelocity(vx, vy);
    p.tool = tool;
    p.expires = expires;
    p.pickableAt = this.time.now + (expires ? 500 : 0);
    return p;
  }

  buildPlayer() {
    const p = (this.player = this.physics.add.sprite(this.spawn.x, this.spawn.y, 'child', 0));
    p.setOrigin(0.5, 1).setDepth(10);
    p.body.setSize(10, 20).setOffset(3, 4);
    p.setCollideWorldBounds(true);
    p.body.setMaxVelocityY(620);

    this.held = this.add.image(p.x, p.y, 'tool_flashlight').setDepth(11);
    this.umbrellaOpen = this.add.image(p.x, p.y, 'umbrella_open').setDepth(11).setVisible(false);

    this.physics.add.collider(p, this.layer);
    this.physics.add.collider(p, this.crackedGroup);
    this.physics.add.collider(p, this.veilGroup);
    this.physics.add.overlap(p, this.shades, (_, m) => this.onMonsterTouch(m));
    this.physics.add.overlap(p, this.bats, (_, m) => this.onMonsterTouch(m));
    this.physics.add.overlap(p, this.spikeGroup, (_, s) => this.onSpikes(s));
    this.physics.add.overlap(p, this.pickups, (_, item) => this.collect(item));
  }

  buildDarkness() {
    const { width, height } = this.scale;
    this.dark = this.add.renderTexture(0, 0, width, height).setOrigin(0).setScrollFactor(0).setDepth(50);
    // Additive glow under the darkness so light visibly lights the rain and stone.
    const ADD = Phaser.BlendModes.ADD;
    this.coneGlow = this.add.image(0, 0, 'cone').setOrigin(0, 0.5).setBlendMode(ADD).setDepth(45).setVisible(false);
    this.auraGlow = this.add.image(0, 0, 'light').setBlendMode(ADD).setDepth(45).setAlpha(0.1);
    for (const l of this.lights) {
      l.glow = this.add.image(l.x, l.y, 'light').setBlendMode(ADD).setDepth(45).setScale((l.r * 1.1) / 64).setAlpha(0.14);
    }
    this.dropBars = this.add.graphics().setDepth(61);
  }

  buildHud() {
    // The HUD lives in its own scene so the darkness, vignette and glitch
    // filters never dim it. It fades out on its own when nothing changes.
    this.hud = this.scene.get('Hud');
    this.scene.launch('Hud');
    this.events.once('shutdown', () => this.scene.stop('Hud'));
  }

  buildInput() {
    // Ignore whatever was pressed on the title screen.
    clearTaps();
  }

  tileAt(px, py) {
    const tx = Math.floor(px / T);
    const ty = Math.floor(py / T);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return SOLID;
    if (this.cracked.has(`${tx},${ty}`)) return SOLID;
    return this.world.grid[ty][tx];
  }

  solidAt(px, py) {
    return this.tileAt(px, py) === SOLID;
  }

  lineOfSight(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(d / 8);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  groundBelow(x, y) {
    for (let ty = Math.floor(y / T); ty < H; ty++) {
      const v = this.tileAt(x, ty * T + 1);
      if (v === SOLID || v === BEAM) return ty * T;
    }
    return null;
  }

  message(text, ms = 3500) {
    if (this.hud) this.hud.showMessage(text, ms);
  }

  hint(id, text, ms) {
    if (this.hintsShown.has(id)) return;
    this.hintsShown.add(id);
    this.message(text, ms);
  }

  bleed(x, y, n, decals = 2) {
    this.bloodFx.emitParticleAt(x, y, n);
    for (let i = 0; i < decals; i++) {
      const dx = x + Phaser.Math.Between(-18, 18);
      const gy = this.groundBelow(dx, y);
      if (gy === null || gy - y > 120) continue;
      const d = this.add.image(dx, gy, `splat${Phaser.Math.Between(0, 2)}`).setOrigin(0.5, 1).setDepth(4);
      d.setFlipX(Math.random() < 0.5);
      this.decals.push(d);
      if (this.decals.length > 80) this.decals.shift().destroy();
    }
  }

  equip(tool) {
    if (tool && !this.inventory.has(tool)) return;
    if (tool === this.equipped) return;
    this.equipped = tool;
    audio.play('poke');
    if (this.hud) this.hud.pulse();
  }

  cycleTool(dir) {
    const owned = TOOLS.filter((t) => this.inventory.has(t));
    if (!owned.length) return;
    const i = owned.indexOf(this.equipped);
    this.equip(owned[(i + dir + owned.length) % owned.length]);
  }

  collect(item) {
    if (this.dead || this.time.now < item.pickableAt) return;
    const tool = item.tool;
    const first = !this.found.has(tool);
    this.found.add(tool);
    this.inventory.add(tool);
    this.equipped = tool;
    if (this.hud) this.hud.pulse();
    item.destroy();
    if (first) {
      audio.play('newtool');
      this.glitch.hit(0.4);
      if (tool === 'crowbar') this.message('CROWBAR \u2014 press BUTTON 1 to swing. Cracked rock gives way.', 5000);
      if (tool === 'umbrella') this.message('UMBRELLA \u2014 hold BUTTON 2 while falling to glide.', 5000);
    } else {
      audio.play('pickup');
      this.message(`Got your ${TOOL_NAMES[tool]} back.`, 1800);
    }
  }

  dropTool(dir) {
    const tool = this.equipped;
    this.inventory.delete(tool);
    this.equipped = null;
    this.spawnPickup(tool, this.player.x, this.player.y - 14, -dir * Phaser.Math.Between(40, 90), -220, this.time.now + DROP_TIME);
    audio.play('drop');
    if (this.hud) this.hud.pulse();
    if (!this.hintsShown.has('drop')) {
      this.hint('drop', `You dropped the ${TOOL_NAMES[tool]}! Grab it before the dark takes it back.`, 3500);
    } else {
      this.message(`Dropped the ${TOOL_NAMES[tool]}!`, 1500);
    }
  }

  // A dropped tool that timed out crawls back to the last lit shrine.
  reclaim(item) {
    this.glitchFx.emitParticleAt(item.x, item.y, 24);
    audio.play('lost');
    this.glitch.hit(0.3);
    const cp = this.checkpoint;
    item.setPosition(cp.x + 16, cp.y - 10);
    item.setVelocity(0, 0);
    item.expires = null;
    item.setAlpha(1);
    this.message(`The dark took your ${TOOL_NAMES[item.tool]}... it waits by the candles.`, 3500);
  }

  updateTools(dt, time) {
    const p = this.player;
    const useDown = tap(...BTN.use);
    const useHeld = down(...BTN.use);
    const f = this.facing;
    this.attackCooldown -= dt;
    this.focus = false;
    this.cone = null;

    this.umbrellaOpen.setVisible(this.gliding);
    this.held.setVisible(!!this.equipped && !this.gliding && !this.dead);
    if (!this.equipped) return;

    this.held.setTexture(`tool_${this.equipped}`).setFlipX(f < 0);
    const swingT = Math.max(0, (this.swingUntil - time) / 180);

    switch (this.equipped) {
      case 'flashlight': {
        this.held.setPosition(p.x + f * 8, p.y - 11).setScale(0.6).setRotation(0);
        this.focus = useHeld;
        if (Math.random() < 0.008) this.flicker = 0;
        this.flicker = Math.min(1, this.flicker + dt * 6);
        if (this.flicker > 0.5 && !this.dead) {
          this.cone = {
            x: p.x + f * 12,
            y: p.y - 11,
            angle: f > 0 ? 0 : Math.PI,
            range: this.focus ? 270 : 190,
            half: this.focus ? 0.2 : 0.4,
            power: this.focus ? 2.4 : 1,
          };
          this.shineCone(this.cone, dt);
        }
        break;
      }
      case 'crowbar': {
        const ang = swingT > 0 ? Phaser.Math.Linear(1.9, -1.2, 1 - swingT) : 0.5;
        this.held.setPosition(p.x + f * 7, p.y - 10).setScale(0.8).setRotation(f * ang);
        if (useDown && this.attackCooldown <= 0) {
          this.attackCooldown = 0.38;
          this.swingUntil = time + 180;
          audio.play('swing');
          const box = new Phaser.Geom.Rectangle(f > 0 ? p.x + 2 : p.x - 32, p.y - 28, 30, 46);
          this.strike(box, 2, 220, true);
        }
        break;
      }
      case 'umbrella': {
        const thrust = swingT > 0 ? 8 * swingT : 0;
        this.held.setPosition(p.x + f * (6 + thrust), p.y - 10).setScale(0.7).setRotation(f * 1.57);
        if (useDown && this.attackCooldown <= 0) {
          this.attackCooldown = 0.4;
          this.swingUntil = time + 180;
          audio.play('poke');
          const box = new Phaser.Geom.Rectangle(f > 0 ? p.x + 2 : p.x - 28, p.y - 18, 26, 12);
          this.strike(box, 1, 320, false);
        }
        break;
      }
    }
    if (this.gliding) this.umbrellaOpen.setPosition(p.x, p.y - 30);
  }

  // Melee hit on everything inside `box`.
  strike(box, dmg, knock, breaks) {
    let hitSomething = false;
    const hitMonster = (m) => {
      if (!m.active || m.dying) return;
      if (Phaser.Geom.Intersects.RectangleToRectangle(box, m.getBounds())) {
        this.damage(m, dmg, this.facing * knock);
        hitSomething = true;
      }
    };
    this.shades.getChildren().slice().forEach(hitMonster);
    this.bats.getChildren().slice().forEach(hitMonster);

    let clang = false;
    for (const c of [...this.cracked.values()]) {
      if (Phaser.Geom.Intersects.RectangleToRectangle(box, c.getBounds())) {
        if (breaks) this.crumble(c.tx, c.ty);
        else clang = true;
      }
    }
    if (clang) audio.play('clang');
    if (hitSomething) this.cameras.main.shake(80, 0.004);
  }

  // Break a cracked block and, a beat later, everything cracked touching it.
  crumble(tx, ty) {
    const key = `${tx},${ty}`;
    const c = this.cracked.get(key);
    if (!c) return;
    this.cracked.delete(key);
    this.debrisFx.emitParticleAt(c.x, c.y, 8);
    c.destroy();
    if (!this.crumbling) {
      this.crumbling = true;
      audio.play('crumble');
      this.cameras.main.shake(250, 0.008);
      this.glitch.hit(0.3);
      this.time.delayedCall(300, () => (this.crumbling = false));
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (this.cracked.has(`${tx + dx},${ty + dy}`)) this.time.delayedCall(60, () => this.crumble(tx + dx, ty + dy));
    }
  }

  inCone(cone, x, y) {
    const dx = x - cone.x;
    const dy = y - cone.y;
    const d = Math.hypot(dx, dy);
    if (d > cone.range) return false;
    const diff = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - cone.angle));
    return diff < cone.half && this.lineOfSight(cone.x, cone.y, x, y);
  }

  shineCone(cone, dt) {
    const burn = (m) => {
      if (!m.active || m.dying) return;
      const cy = m.kind === 'shade' ? m.y - 18 : m.y;
      if (this.inCone(cone, m.x, cy)) {
        m.burning = 0.15;
        m.hp -= dt * cone.power * (m.kind === 'bat' ? 2.5 : 1.1);
        if (Math.random() < 0.3) this.smokeFx.emitParticleAt(m.x, cy, 1);
        if (Math.random() < 0.15) this.emberFx.emitParticleAt(m.x, cy, 1);
        if (!m.shriekAt || this.time.now > m.shriekAt) {
          m.shriekAt = this.time.now + 900;
          audio.play(m.kind === 'bat' ? 'screech' : 'burn');
        }
        if (m.hp <= 0) this.kill(m);
      }
    };
    this.shades.getChildren().slice().forEach(burn);
    this.bats.getChildren().slice().forEach(burn);

    for (const v of this.veils) {
      if (v.strength <= 0) continue;
      let lit = false;
      for (const off of [-0.6, -0.3, 0, 0.3, 0.6]) {
        const a = cone.angle + off * cone.half;
        for (let d = 8; d < cone.range && !lit; d += 8) {
          const x = cone.x + Math.cos(a) * d;
          const y = cone.y + Math.sin(a) * d;
          if (v.rect.contains(x, y)) lit = true;
          else if (this.solidAt(x, y)) break;
        }
        if (lit) break;
      }
      if (!lit) continue;
      v.strength -= dt * (this.focus ? 0.9 : 0.35);
      v.hurt = 0.2;
      if (Math.random() < 0.2) this.glitchFx.emitParticleAt(v.rect.centerX, Phaser.Math.Between(v.rect.top, v.rect.bottom), 1);
      if (Math.random() < 0.05) audio.play('burn');
      if (v.strength <= 0) this.dissolveVeil(v);
      else this.hint('veil-focus', 'It recoils from the light... hold BUTTON 1 to focus the beam.');
    }
  }

  dissolveVeil(v) {
    audio.play('veil');
    this.glitch.hit(0.6);
    for (let i = 0; i < 40; i++) {
      this.glitchFx.emitParticleAt(Phaser.Math.Between(v.rect.left, v.rect.right), Phaser.Math.Between(v.rect.top, v.rect.bottom), 1);
    }
    this.veils = this.veils.filter((o) => o !== v);
    v.body.enable = false;
    this.tweens.add({ targets: v, alpha: 0, scaleX: 0.2, duration: 400, onComplete: () => v.destroy() });
  }

  damage(m, dmg, knockX) {
    m.hp -= dmg;
    this.bleed(m.x, m.kind === 'shade' ? m.y - 18 : m.y, 14, 1);
    audio.play('flesh');
    m.setTint(0xff4444);
    this.time.delayedCall(120, () => m.active && m.clearTint());
    if (m.kind === 'shade') {
      m.stunUntil = this.time.now + 350;
      m.setVelocity(knockX, -140);
    } else {
      m.setVelocity(knockX, -60);
    }
    if (m.hp <= 0) this.kill(m);
  }

  kill(m) {
    if (m.dying) return;
    m.dying = true;
    m.body.enable = false;
    const cy = m.kind === 'shade' ? m.y - 16 : m.y;
    this.bleed(m.x, cy, m.kind === 'shade' ? 45 : 20, m.kind === 'shade' ? 4 : 2);
    audio.play('die');
    this.glitch.hit(0.3);
    this.cameras.main.shake(120, 0.006);
    this.tweens.add({ targets: m.eyes, alpha: 0, y: m.eyes.y + 12, duration: 900, onComplete: () => m.eyes.destroy() });
    this.tweens.add({
      targets: m,
      alpha: 0,
      scaleY: m.kind === 'shade' ? 0.1 : 1,
      angle: m.kind === 'bat' ? 180 : 0,
      duration: 500,
      onComplete: () => m.destroy(),
    });
  }

  onMonsterTouch(m) {
    if (m.dying || !m.active) return;
    this.hurt(m.x);
  }

  onSpikes(s) {
    if (this.dead) return;
    this.hurt(this.player.x + (Math.random() - 0.5));
    if (s.abyss) {
      if (!this.dead && !this.falling) {
        this.falling = true;
        this.time.delayedCall(350, () => {
          this.falling = false;
          if (!this.dead) this.respawnAtCheckpoint();
        });
      }
    } else if (this.player.body.velocity.y >= 0) {
      this.player.setVelocityY(-340);
    }
  }

  updateShade(s, dt, time) {
    if (s.dying) return;
    const p = this.player;
    const onGround = s.body.blocked.down;
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    const sees =
      !this.dead && Math.abs(dx) < 170 && Math.abs(dy) < 50 && this.lineOfSight(s.x, s.y - 26, p.x, p.y - 12);

    if (sees && !s.chasing) audio.play('moan');
    s.chasing = sees;
    if (!s.chasing && s.dir === 0) s.dir = s.flipX ? -1 : 1;
    s.burning = Math.max(0, s.burning - dt);

    if (time < s.stunUntil) {
      // knocked back; let physics carry it
    } else if (onGround) {
      if (s.chasing) s.dir = Math.sign(dx) || s.dir;
      // Turn at walls and ledges (unless chasing straight at the player on the same level).
      const ahead = s.x + s.dir * 8;
      const floor = this.tileAt(ahead, s.y + 2);
      const wall = s.dir > 0 ? s.body.blocked.right : s.body.blocked.left;
      if (wall || (floor !== SOLID && floor !== BEAM)) {
        if (s.chasing) s.dir = 0;
        else s.dir = -s.dir;
      }
      let speed = s.chasing ? 64 : 26;
      if (s.burning > 0) speed *= 0.2;
      s.setVelocityX(s.dir * speed);
    }
    if (s.dir) s.setFlipX(s.dir < 0);
    s.anims.timeScale = s.chasing ? 2.5 : 1;

    const shake = s.burning > 0 ? Phaser.Math.Between(-1, 1) : 0;
    s.eyes.setPosition(s.x + (s.flipX ? -1 : 1) + shake, s.y - 27.5);
    s.eyes.setAlpha(s.burning > 0 ? 0.4 + Math.random() * 0.6 : 1);
    s.setAlpha(s.burning > 0 ? 0.6 + Math.random() * 0.4 : 1);
  }

  updateBat(b, dt, time) {
    if (b.dying) return;
    b.t += dt;
    b.burning = Math.max(0, b.burning - dt);
    const p = this.player;
    const px = p.x;
    const py = p.y - 12;
    const d = Phaser.Math.Distance.Between(b.x, b.y, px, py);

    if (b.burning > 0) {
      b.state = 'return';
      b.stateUntil = time + 1200;
      const a = Math.atan2(b.y - py, b.x - px);
      b.setVelocity(Math.cos(a) * 120, Math.sin(a) * 120);
    } else if (b.state === 'hover') {
      const tx = b.home.x + Math.sin(b.t * 1.3) * 34;
      const ty = b.home.y + Math.sin(b.t * 2.7) * 10;
      b.setVelocity((tx - b.x) * 3, (ty - b.y) * 3);
      if (!this.dead && d < 150 && time > b.stateUntil && this.lineOfSight(b.x, b.y, px, py)) {
        b.state = 'dive';
        b.stateUntil = time + 900;
        const a = Math.atan2(py - b.y, px - b.x);
        b.setVelocity(Math.cos(a) * 165, Math.sin(a) * 165);
        audio.play('screech');
      }
    } else if (b.state === 'dive') {
      if (time > b.stateUntil) {
        b.state = 'return';
        b.stateUntil = time + 1500;
      }
    } else {
      const a = Math.atan2(b.home.y - b.y, b.home.x - b.x);
      b.setVelocity(Math.cos(a) * 90, Math.sin(a) * 90);
      if (Phaser.Math.Distance.Between(b.x, b.y, b.home.x, b.home.y) < 10 || time > b.stateUntil) {
        b.state = 'hover';
        b.stateUntil = time + 1500;
      }
    }
    b.setFlipX(b.body.velocity.x < 0);
    b.eyes.setPosition(b.x, b.y + 1.5);
  }

  // Returns false if the hit was ignored.
  hurt(srcX) {
    const time = this.time.now;
    if (this.dead || this.won || time < this.invulnUntil) return false;
    const p = this.player;
    this.invulnUntil = time + 1400;
    this.stunUntil = time + 260;
    const dir = Math.sign(p.x - srcX) || -this.facing;
    p.setVelocity(dir * 170, -230);
    this.bleed(p.x, p.y - 12, 22, 2);
    audio.play('hurt');
    this.glitch.hit(0.7);
    this.cameras.main.shake(160, 0.012);
    if (this.hud) this.hud.pulse();

    if (this.equipped) {
      this.dropTool(dir);
    } else {
      this.hearts--;
      if (this.hearts <= 0) this.die();
    }
    return true;
  }

  die() {
    this.dead = true;
    const p = this.player;
    this.bleed(p.x, p.y - 12, 60, 5);
    p.setVisible(false);
    p.body.enable = false;
    audio.play('death');
    this.glitch.hit(1.2);
    this.cameras.main.shake(400, 0.02);
    if (this.hud) this.hud.big('THEY FOUND YOU');
    this.time.delayedCall(2200, () => {
      if (this.hud) this.hud.clearBig();
      this.hearts = MAX_HEARTS;
      this.dead = false;
      p.setVisible(true);
      p.body.enable = true;
      this.respawnAtCheckpoint();
    });
  }

  respawnAtCheckpoint() {
    const cp = this.checkpoint;
    this.player.setPosition(cp.x - 14, cp.y - 1);
    this.player.setVelocity(0, 0);
    this.invulnUntil = this.time.now + 1500;
    this.glitch.hit(0.6);
    audio.play('glitch');
    if (this.hud) this.hud.pulse();
  }

  updatePlayer(dt, time) {
    const p = this.player;
    if (this.dead || this.won) {
      if (!this.dead) p.setVelocityX(0);
      clearTaps();
      return;
    }

    const left = down(...BTN.left);
    const right = down(...BTN.right);
    const jumpDown = tap(...BTN.jump);
    const jumpHeld = down(...BTN.jump);
    const jumpUp = untap(...BTN.jump);
    const grounded = p.body.blocked.down;

    if (grounded) {
      if (!this.wasGrounded && this.lastVy > 220) audio.play('land');
      this.lastGround = time;
    }
    this.wasGrounded = grounded;
    this.lastVy = p.body.velocity.y;

    if (time > this.stunUntil) {
      const dir = (right ? 1 : 0) - (left ? 1 : 0);
      p.setVelocityX(dir * RUN);
      if (dir) this.facing = dir;
    }

    if (jumpDown) this.jumpPressedAt = time;
    if (time - this.jumpPressedAt < 120 && time - this.lastGround < 110) {
      p.setVelocityY(-JUMP);
      this.jumpPressedAt = -1e9;
      this.lastGround = -1e9;
      audio.play('jump');
    }
    if (jumpUp && p.body.velocity.y < 0) p.setVelocityY(p.body.velocity.y * 0.45);

    this.gliding = this.equipped === 'umbrella' && !grounded && jumpHeld && p.body.velocity.y > 0;
    if (this.gliding) p.setVelocityY(Math.min(p.body.velocity.y, GLIDE_FALL));

    if (tap(...BTN.prev)) this.cycleTool(-1);
    if (tap(...BTN.next)) this.cycleTool(1);
    if (tap(...BTN.mute)) audio.music.gain.value = audio.music.gain.value > 0 ? 0 : 0.32;

    p.setFlipX(this.facing < 0);
    if (!grounded) p.anims.play('child-jump', true);
    else if (Math.abs(p.body.velocity.x) > 5) {
      p.anims.play('child-run', true);
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.28;
        audio.play('step');
      }
    } else p.anims.play('child-idle', true);

    p.setAlpha(time < this.invulnUntil ? (Math.floor(time / 70) % 2 ? 0.3 : 1) : 1);

    for (const s of this.shrines) {
      if (Math.abs(p.x - s.x) < 18 && Math.abs(p.y - s.y) < 24) {
        if (!s.lit) this.lightShrine(s);
        this.checkpoint = s;
        this.hearts = MAX_HEARTS;
      }
    }

    if (p.x > 27 * T && p.x < 34 * T) this.hint('veil', 'A veil of living shadow. Shine the flashlight on it.');
    if (p.x > 84 * T && p.x < 90 * T && p.y < 12 * T && !this.found.has('umbrella')) {
      this.hint('chasm', 'Too far to jump... if only something could slow the fall.', 4000);
    }
    if (this.found.has('crowbar') && p.x > 40 * T && p.x < 48 * T && p.y > 20 * T && p.y < 27 * T && this.cracked.has('45,26')) {
      this.hint('floor', 'The floor here is cracked...');
    }
    if (p.x < 130 * T && p.x > 110 * T && p.y < 9 * T) this.hint('bell', 'The great bell. Ring it.');

    if (this.bellZone && !this.won && this.bellZone.contains(p.x, p.y - 10)) this.win();
  }

  updatePickups(time) {
    this.dropBars.clear();
    for (const item of this.pickups.getChildren().slice()) {
      if (!item.expires) {
        item.setAlpha(1);
        continue;
      }
      const left = item.expires - time;
      if (left <= 0) {
        this.reclaim(item);
        continue;
      }
      item.setAlpha(left < 2000 ? (Math.floor(time / 80) % 2 ? 0.25 : 1) : 1);
      const w = 20 * (left / DROP_TIME);
      this.dropBars.fillStyle(0x000000, 0.8).fillRect(item.x - 11, item.y - 16, 22, 4);
      this.dropBars.fillStyle(left < 2000 ? 0xff1a1a : 0xffffff, 1).fillRect(item.x - 10, item.y - 15, w, 2);
    }
  }

  updateRainSplashes() {
    const cam = this.cameras.main;
    for (let i = 0; i < 4; i++) {
      const x = cam.scrollX + Math.random() * cam.width;
      const top = Math.max(0, Math.floor(cam.scrollY / T));
      const bottom = Math.min(H, top + Math.ceil(cam.height / T) + 1);
      for (let ty = top; ty < bottom; ty++) {
        const v = this.tileAt(x, ty * T + 1);
        if (v === SOLID || v === BEAM) {
          this.splashFx.emitParticleAt(x, ty * T, 2);
          break;
        }
      }
    }
  }

  updateDarkness(time) {
    const cam = this.cameras.main;
    const sx = cam.scrollX;
    const sy = cam.scrollY;
    const dark = this.dark;
    const alpha = BASE_DARK * (1 - 0.93 * Math.min(1, this.storm.flash * 1.4));
    const onScreen = (x, y, r) => x + r > sx && x - r < sx + cam.width && y + r > sy && y - r < sy + cam.height;
    const light = (x, y, r, a = 1) => {
      if (!onScreen(x, y, r)) return;
      dark.stamp('light', null, x - sx, y - sy, { scale: r / 64, alpha: a, erase: true });
    };

    dark.clear();
    dark.fill(0x000000, alpha);

    const p = this.player;
    if (!this.dead) light(p.x, p.y - 12, 74);
    this.auraGlow.setPosition(p.x, p.y - 12).setScale(0.8).setVisible(!this.dead);
    for (const l of this.lights) {
      const f = l.flicker ? 0.9 + Math.sin(time / 90 + l.x) * 0.05 + Math.random() * 0.05 : 1;
      light(l.x, l.y, l.r * f, 1);
      if (l.glow) l.glow.setAlpha(0.12 * f + this.storm.flash * 0.1);
    }
    for (const item of this.pickups.getChildren()) light(item.x, item.y, 26, 0.7);

    const c = this.cone;
    if (c) {
      // The cone texture is 256px long with a 0.42 rad half-angle; stretch it to fit.
      const scaleX = c.range / 256;
      dark.stamp('cone', null, c.x - sx, c.y - sy, {
        originX: 0,
        originY: 0.5,
        scaleX,
        scaleY: scaleX * (Math.tan(c.half) / Math.tan(0.42)),
        rotation: c.angle,
        alpha: this.flicker,
        erase: true,
      });
      this.coneGlow
        .setVisible(true)
        .setPosition(c.x, c.y)
        .setScale(scaleX, scaleX * (Math.tan(c.half) / Math.tan(0.42)))
        .setRotation(c.angle)
        .setAlpha((this.focus ? 0.4 : 0.26) * this.flicker);
    } else {
      this.coneGlow.setVisible(false);
    }
  }

  updateDread() {
    let nearest = Infinity;
    for (const m of [...this.shades.getChildren(), ...this.bats.getChildren()]) {
      if (m.dying) continue;
      nearest = Math.min(nearest, Phaser.Math.Distance.Between(m.x, m.y, this.player.x, this.player.y));
    }
    this.glitch.base = 0.04 + Math.max(0, 1 - nearest / 140) * 0.14 + (this.equipped ? 0 : 0.03);
  }

  updateParallax() {
    const cam = this.cameras.main;
    this.hills.tilePositionX = cam.scrollX * 0.1;
    this.hills.y = 10 - cam.scrollY * 0.06;
    this.grove.tilePositionX = cam.scrollX * 0.25;
    this.grove.y = 21 - cam.scrollY * 0.15;
  }

  win() {
    this.won = true;
    this.player.setVelocity(0, 0);
    audio.play('greatbell');
    this.glitch.hit(1);
    this.cameras.main.shake(1200, 0.01);
    this.tweens.add({ targets: this.bell, angle: { from: -14, to: 14 }, duration: 1100, yoyo: true, repeat: 2, ease: 'Sine.inOut' });
    [0, 700, 1500, 2300].forEach((d) => this.time.delayedCall(d, () => this.storm.strike(1)));

    const { width, height } = this.scale;
    const white = this.add.rectangle(0, 0, width, height, 0xffffff).setOrigin(0).setScrollFactor(0).setDepth(200).setAlpha(0);
    this.tweens.add({ targets: white, alpha: 1, delay: 2600, duration: 2200 });
    const lines = [
      this.add.text(width / 2, height / 2 - 22, 'THE BELL TOLLS.', { fontFamily: 'Georgia, serif', fontSize: '32px', color: '#000000', fontStyle: 'bold' }),
      this.add.text(width / 2, height / 2 + 18, 'the rain forgets you... for now', { fontFamily: 'Georgia, serif', fontSize: '15px', color: '#8a0010', fontStyle: 'italic' }),
    ];
    lines.forEach((t, i) => {
      t.setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, delay: 4800 + i * 1200, duration: 1200 });
    });
    this.time.delayedCall(11000, () => {
      this.cameras.main.fadeOut(1500, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Title'));
    });
  }

  update(time, delta) {
    const dt = Math.min(delta, 50) / 1000;

    this.updatePlayer(dt, time);
    this.updateTools(dt, time);
    for (const s of this.shades.getChildren().slice()) this.updateShade(s, dt, time);
    for (const b of this.bats.getChildren().slice()) this.updateBat(b, dt, time);
    for (const v of this.veils) {
      v.tilePositionY -= dt * 20;
      v.tilePositionX = Math.sin(time / 300) * 3;
      v.hurt = Math.max(0, (v.hurt || 0) - dt);
      v.setAlpha(0.35 + 0.65 * v.strength * (v.hurt > 0 ? 0.6 + Math.random() * 0.4 : 1));
    }
    this.updatePickups(time);
    this.updateRainSplashes();
    this.storm.update(dt);
    this.updateParallax();
    this.updateDread();
    this.glitch.tick(dt);
    this.updateDarkness(time);

    // HUD text shivers with the glitch.
    if (this.hud && this.hud.msg) {
      const gi = this.glitch.intensity;
      this.hud.msg.x = this.scale.width / 2 + (Math.random() < gi ? Phaser.Math.Between(-4, 4) : 0);
      if (this.hud.bigText.alpha) this.hud.bigText.x = this.scale.width / 2 + Phaser.Math.Between(-6, 6) * gi;
    }
  }
}

// Heads-up display, rendered in its own unfiltered scene so the darkness,
// vignette and glitch never wash it out. It reads live state from the game
// scene and fades away when nothing has changed for a while.
class HudScene extends Phaser.Scene {
  constructor() {
    super('Hud');
  }

  create() {
    this.game = this.scene.get('Game');
    const { width, height } = this.scale;
    this.heartIcons = [];
    for (let i = 0; i < MAX_HEARTS; i++) {
      this.heartIcons.push(this.add.image(14 + i * 18, 14, 'heart', 0).setScale(2));
    }
    this.slotGfx = this.add.graphics();
    this.slotIcons = TOOLS.map((t, i) => this.add.image(width - 86 + i * 28, 16, `tool_${t}`));
    this.slotUnknown = TOOLS.map((_, i) =>
      this.add.text(width - 86 + i * 28, 16, '?', { fontFamily: 'monospace', fontSize: '12px', color: '#8a8a8a' }).setOrigin(0.5),
    );
    this.toolLabel = this.add
      .text(width - 12, 34, '', { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' })
      .setOrigin(1, 0);
    this.panel = this.add.container(0, 0, [
      ...this.heartIcons,
      this.slotGfx,
      ...this.slotIcons,
      ...this.slotUnknown,
      this.toolLabel,
    ]);
    this.msg = this.add
      .text(width / 2, height - 22, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffffff',
        backgroundColor: '#000000cc',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.bigText = this.add
      .text(width / 2, height / 2, '', { fontFamily: 'Georgia, serif', fontSize: '34px', color: '#ff1a1a', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setAlpha(0);
    this.hideAt = this.time.now + HUD_LINGER;
  }

  pulse() {
    this.hideAt = this.time.now + HUD_LINGER;
  }

  showMessage(text, ms = 3500) {
    this.msg.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.msg);
    this.tweens.add({ targets: this.msg, alpha: 0, delay: ms, duration: 600 });
  }

  big(text) {
    this.bigText.setText(text).setAlpha(1);
  }

  clearBig() {
    this.bigText.setAlpha(0);
  }

  update(time, delta) {
    const g = this.game;
    if (!g || !g.player) return;

    this.heartIcons.forEach((h, i) => h.setFrame(i < g.hearts ? 0 : 1));
    const { width } = this.scale;
    const gr = this.slotGfx.clear();
    const dropped = new Set(g.pickups.getChildren().filter((i) => i.expires).map((i) => i.tool));
    TOOLS.forEach((t, i) => {
      const x = width - 86 + i * 28;
      const eq = g.equipped === t;
      gr.fillStyle(0x0a0d12, 0.92).fillRect(x - 12, 4, 24, 24);
      gr.lineStyle(eq ? 2 : 1, eq ? 0xff2a2a : 0xc8d0d8, 1).strokeRect(x - 12, 4, 24, 24);
      const has = g.inventory.has(t);
      const known = g.found.has(t);
      this.slotUnknown[i].setVisible(!known);
      this.slotIcons[i].setVisible(known);
      this.slotIcons[i].setAlpha(has ? 1 : dropped.has(t) ? (Math.floor(g.time.now / 150) % 2 ? 0.3 : 0.65) : 0.3);
    });
    this.toolLabel.setText(g.equipped ? TOOL_NAMES[g.equipped] : 'EMPTY HANDS');
    this.toolLabel.setColor(g.equipped ? '#ffffff' : '#ff3b3b');

    // Fade the panel out once the linger window lapses.
    const want = time < this.hideAt ? 1 : 0;
    this.panel.alpha = Phaser.Math.Linear(this.panel.alpha, want, Math.min(1, delta / 160));
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game-root',
  width: 640,
  height: 480,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  pipeline: { Glitch: GlitchPipeline },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 900 }, debug: false },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, TitleScene, GameScene, HudScene],
});
})();
