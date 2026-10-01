// El Apagón — a gothic-horror metroidvania for the Platanus Hack 26 arcade.

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

const { PI, abs, atan2, ceil, cos, floor, hypot, max, min, random, round, sign, sin, tan } = Math;
const between = Phaser.Math.Between;

const KEY_TO_ARCADE = {};
for (const [code, keys] of Object.entries(CABINET_KEYS)) {
  for (const key of keys) KEY_TO_ARCADE[key.length === 1 ? key.toLowerCase() : key] = code;
}

// held[code]: button is down. Presses/releases are latched until consumed, so taps
// shorter than a frame still register.
const held = {};
let pressed = {};
let released = {};
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

// Did this button go down (or up) since the last check? Consumes the latch.
const tap = (c) => pressed[c] && !(pressed[c] = false);
const untap = (c) => released[c] && !(released[c] = false);
const down = (c) => held[c];
const clearTaps = () => (pressed = {}, released = {});

const B_LEFT = 'P1_L';
const B_RIGHT = 'P1_R';
const B_UP = 'P1_U';
const B_DOWN = 'P1_D';
const B_JUMP = 'P1_1';
const B_USE = 'P1_2';
const B_PREV = 'P1_5';
const B_NEXT = 'P1_6';
const B_MUTE = 'P1_4';

// Audio: everything is synthesised on one shared context, built on the first press.

const midi = (m) => 440 * 2 ** ((m - 69) / 12);

// D minor: i - VI - iv - V (harmonic minor, so the V is major with a C#).
const CHORDS = [
  [50, 53, 57], // Dm
  [46, 50, 53], // Bb
  [43, 46, 50], // Gm
  [45, 49, 52], // A
];
// Eighth-note lead, one row per bar; 0 = rest.
const MELODY = [
  [69, 0, 0, 65, 64, 0, 62, 0],
  [65, 0, 0, 62, 60, 0, 58, 0],
  [62, 0, 58, 0, 67, 0, 65, 64],
  [61, 0, 0, 0, 64, 0, 57, 0],
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2];

// Oscillator shapes, by index.
const WAVES = ['square', 'sawtooth', 'sine', 'triangle'];
const SQUARE = 0;
const SAW = 1;
const SINE = 2;
const TRIANGLE = 3;

// ac: the context. master/music/sfx/amb: mix buses. white/brown: 3s noise buffers.
let ac, master, music, sfx, amb, white, brown, musicStep, musicAt, musicTimer;

const now = () => ac.currentTime;
const chain = (...nodes) => nodes.reduce((a, b) => (a.connect(b), b));
const gain = (v, dest) => {
  const g = ac.createGain();
  if (v) g.gain.value = v;
  if (dest) g.connect(dest);
  return g;
};
const filter = (type, freq) => {
  const f = ac.createBiquadFilter();
  f.type = type + 'pass';
  if (freq) f.frequency.value = freq;
  return f;
};
const osc = (wave, freq) => {
  const o = ac.createOscillator();
  o.type = WAVES[wave];
  if (freq) o.frequency.value = freq;
  return o;
};
const noise = (buffer, loop) => {
  const s = ac.createBufferSource();
  s.buffer = buffer;
  if (loop) s.loop = true;
  return s;
};
// Set `param` to v0 at t0, then glide exponentially to v1 at t1.
const slide = (param, v0, t0, v1, t1) => {
  param.setValueAtTime(v0, t0);
  param.exponentialRampToValueAtTime(v1, t1);
};
const run = (node, t, end) => {
  node.start(t);
  node.stop(end);
};

function initAudio() {
  if (ac) return ac.resume();
  ac = new AudioContext();

  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(ac.destination);

  master = gain(0.9, comp);
  music = gain(0.32, master);
  sfx = gain(0.7, master);
  amb = gain(0.5, master);

  const len = ac.sampleRate * 3;
  white = ac.createBuffer(1, len, ac.sampleRate);
  brown = ac.createBuffer(1, len, ac.sampleRate);
  const w = white.getChannelData(0);
  const b = brown.getChannelData(0);
  for (let i = 0, last = 0; i < len; i++) {
    w[i] = random() * 2 - 1;
    last = (last + 0.02 * w[i]) / 1.02;
    b[i] = last * 3.5;
  }

  // Rain: a hiss plus a low rumble, looping for good.
  const hiss = noise(white, true);
  chain(hiss, filter('high', 900), filter('low', 7000), gain(0.16), amb);
  hiss.start();
  const body = noise(brown, true);
  chain(body, gain(0.22), amb);
  body.start();
}

function thunder(delay = 0.6, power = 1) {
  if (!ac) return;
  const t = now() + delay;

  const src = noise(brown);
  src.playbackRate.value = 0.6 + random() * 0.3;
  const lp = filter('low');
  slide(lp.frequency, 900, t, 90, t + 3.5);
  const g = gain();
  slide(g.gain, 0.0001, t, 1.6 * power, t + 0.08);
  slide(g.gain, 1.2 * power, t + 0.5, 0.0001, t + 4.2);
  chain(src, lp, g, amb);
  run(src, t, t + 4.5);

  // A close strike also cracks.
  if (delay < 0.5) {
    const c = noise(white);
    const hp = filter('high', 1500);
    const cg = gain();
    slide(cg.gain, 0.5 * power, t, 0.0001, t + 0.35);
    chain(c, hp, cg, amb);
    run(c, t, t + 0.4);
  }
}

const EIGHTH = 60 / 72 / 2;

function startMusic() {
  if (!ac || musicTimer) return;
  musicStep = 0;
  musicAt = now() + 0.1;
  musicTimer = setInterval(() => {
    while (musicAt < now() + 0.15) {
      playStep(musicStep++, musicAt);
      musicAt += EIGHTH;
    }
  }, 25);
}

function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = 0;
}

function playStep(step, t) {
  const bar = floor(step / 8) % 4;
  const pos = step % 8;
  const cycle = floor(step / 32);
  const chord = CHORDS[bar];

  if (!pos) {
    for (const n of chord) {
      tone(SAW, midi(n), t, EIGHTH * 8, 0.022, 900, 0.35);
      tone(SAW, midi(n) * 1.004, t, EIGHTH * 8, 0.018, 900, 0.35);
    }
    if (!bar) bell(midi(38), t, 0.12, 5);
  }

  if (pos % 2 === 0) tone(SQUARE, midi(chord[0] - 12), t, EIGHTH * 1.6, 0.05, 500);

  // Chiptune arpeggio (drops out every 4th cycle for breathing room).
  if (cycle % 4 !== 3) tone(SQUARE, midi(chord[ARP[pos]] + 12), t, EIGHTH * 0.7, 0.018, 2500, 0.005);

  // Lead melody plays every other cycle.
  const m = MELODY[bar][pos];
  if (m && cycle % 2) tone(SQUARE, midi(m), t, EIGHTH * 1.8, 0.035, 3000, 0.02, music, true);
}

function tone(wave, freq, t, dur, vol, cutoff = 2000, attack = 0.01, dest = music, vibrato) {
  const o = osc(wave, freq);
  if (vibrato) {
    const lfo = osc(SINE, 5.5);
    chain(lfo, gain(freq * 0.012), o.frequency);
    run(lfo, t, t + dur + 0.1);
  }
  const f = filter('low', cutoff);
  const g = gain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  slide(g.gain, vol, t + max(attack, dur * 0.6), 0.0001, t + dur);
  chain(o, f, g, dest);
  run(o, t, t + dur + 0.05);
}

// Inharmonic partials of a cast bell: [frequency ratio, amplitude].
const PARTIALS = [[0.5, 1], [1, 0.8], [1.19, 0.5], [1.5, 0.35], [2, 0.3], [2.74, 0.18], [3.76, 0.1]];

function bell(freq, t, vol, len, dest = music) {
  for (const [ratio, amp] of PARTIALS) {
    const o = osc(SINE, freq * ratio);
    const g = gain();
    slide(g.gain, 0.0001, t, vol * amp, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len / ratio ** 0.5);
    chain(o, g, dest);
    run(o, t, t + len + 0.1);
  }
}

function noiseHit(t, dur, vol, lo, hi) {
  const src = noise(white);
  src.playbackRate.value = 0.5 + random();
  const bp = filter('band');
  slide(bp.frequency, hi, t, lo, t + dur);
  bp.Q.value = 0.8;
  const g = gain();
  slide(g.gain, vol, t, 0.0001, t + dur);
  chain(src, bp, g, sfx);
  src.start(t, random() * 2);
  src.stop(t + dur + 0.05);
}

function sweep(wave, f0, f1, dur, vol, t = now()) {
  const o = osc(wave);
  slide(o.frequency, f0, t, f1, t + dur);
  const g = gain();
  slide(g.gain, vol, t, 0.0001, t + dur);
  chain(o, g, sfx);
  run(o, t, t + dur + 0.05);
}

// A short square blip on the sfx bus.
const blip = (freq, t, dur, vol, cutoff, attack) => tone(SQUARE, freq, t, dur, vol, cutoff, attack, sfx);
const arpeggio = (notes, t, gap, dur) => notes.forEach((n, i) => blip(midi(n + 12), t + i * gap, dur, 0.06, 4000, 0.002));

function glitchNoise(dur, t = now()) {
  for (let i = 0; i < floor(dur / 0.03); i++) blip(80 + random() * 3000, t + i * 0.03, 0.028, 0.03, 8000, 0.001);
}

const SFX = {
  jump: () => sweep(SQUARE, 220, 440, 0.1, 0.05),
  land: (t) => noiseHit(t, 0.08, 0.15, 200, 600),
  step: (t) => noiseHit(t, 0.04, 0.05, 300, 1200),
  swing: (t) => noiseHit(t, 0.15, 0.25, 500, 3000),
  poke: (t) => noiseHit(t, 0.08, 0.2, 800, 2500),
  clang: (t) => {
    blip(1250, t, 0.12, 0.06, 5000, 0.001);
    blip(1870, t, 0.08, 0.04, 5000, 0.001);
  },
  crumble: (t) => {
    noiseHit(t, 0.6, 0.6, 60, 900);
    noiseHit(t + 0.1, 0.4, 0.3, 80, 600);
  },
  flesh: (t) => {
    noiseHit(t, 0.18, 0.4, 120, 900);
    sweep(SAW, 160, 60, 0.15, 0.08);
  },
  hurt: (t) => {
    sweep(SQUARE, 600, 90, 0.35, 0.12);
    noiseHit(t, 0.25, 0.4, 150, 1200);
    glitchNoise(0.25);
  },
  drop: (t) => {
    sweep(TRIANGLE, 900, 200, 0.25, 0.12);
    blip(190, t + 0.05, 0.1, 0.05, 2000, 0.001);
  },
  pickup: (t) => arpeggio([62, 69, 74], t, 0.07, 0.15),
  newtool: (t) => {
    arpeggio([50, 57, 62, 65, 69], t, 0.09, 0.35);
    bell(midi(62), t + 0.4, 0.05, 2.5, sfx);
  },
  checkpoint: (t) => {
    bell(midi(74), t, 0.07, 2.5, sfx);
    bell(midi(81), t + 0.15, 0.04, 2, sfx);
  },
  lost: () => {
    sweep(SAW, 400, 40, 0.8, 0.08);
    glitchNoise(0.5);
  },
  screech: () => {
    sweep(SAW, 1800, 700, 0.18, 0.05);
    sweep(SQUARE, 2400, 1200, 0.12, 0.03);
  },
  moan: () => sweep(SAW, 110, 70, 0.9, 0.06),
  die: (t) => {
    sweep(SAW, 300, 30, 0.6, 0.12);
    noiseHit(t, 0.4, 0.5, 80, 1500);
    glitchNoise(0.3);
  },
  burn: (t) => noiseHit(t, 0.1, 0.06, 2000, 6000),
  veil: () => {
    sweep(SINE, 200, 1600, 0.9, 0.08);
    glitchNoise(0.4);
  },
  death: () => {
    sweep(SAW, 220, 20, 1.6, 0.15);
    glitchNoise(1);
  },
  glitch: () => glitchNoise(0.2),
  shot: (t) => {
    noiseHit(t, 0.25, 0.9, 100, 5000);
    sweep(SQUARE, 300, 50, 0.2, 0.15);
  },
  greatbell: (t) => [0.4, 0.3, 0.25].forEach((v, i) => bell(midi(38), t + i * 2.2, v, 9, sfx)),
};

const sound = (name) => ac && SFX[name](now());

// A run of sine notes with vibrato: El Silbon's whistle, and his death.
const whistleNotes = (notes, base, gap, dur, vol, attack) =>
  ac && notes.forEach((n, i) => tone(SINE, midi(base + n), now() + i * gap, dur, vol, 4000, attack, sfx, true));
// A rising do-re-mi-fa-sol-la-si.
const whistle = (vol, base, gap = 0.32) => whistleNotes([0, 2, 4, 5, 7, 9, 11], base, gap, gap * 1.3, vol, 0.05);

// Procedural art. The world is strictly black & white; the only colours are the
// child's yellow raincoat and crimson (eyes, blood, a little stained glass).

// Palette: one char per colour, then its hex. Two hex digits are a grey.
//   o outline, k black, 1-6 greys, s pale skin, w white
//   Y/y/h raincoat, shade, highlight; r red eyes; R dark red; c umbrella canopy
const PAL = {};
for (const e of 'o0c k00 10e 223 338 45a 58c 6c4 sc9 wff a05 b0a d0b f10 i16 j18 l1a m1c n1e p22 q26 t2a u2e v33 x3a z4a A55 B6a C77 D8a E9a Fb0 Gd0 Hd8 Ie6 Yf2c230 ya8780f hffe07a rff1a1a R7a0008 cc00010 Jd9a520 K8a6410 L8a5a36 M2a1a10 Ne8c21a O8a7410 P6a0008 Q3a0004 S8a0010 Tb0000e U5a0008'.split(' ')) {
  PAL[e[0]] = '#' + e.slice(1).padEnd(6, e.slice(1));
}
const grey = (v) => '#' + v.toString(16).padStart(2, '0').repeat(3);

let textures; // the texture manager, set by makeArt
let pen; // 2D context of the texture being drawn

// Draw a new canvas texture; `frames` splits it into that many equal columns.
function fromCanvas(key, w, h, draw, frames = 0) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  pen = c.getContext('2d');
  draw();
  const tex = textures.addCanvas(key, c);
  for (let i = 0; i < frames; i++) tex.add(i, 0, (i * w) / frames, 0, w / frames, h);
}

// Fill and stroke colour: a palette char, or any canvas style.
const ink = (k) => (pen.fillStyle = pen.strokeStyle = PAL[k] || k);
const box = (k, x, y, w, h) => {
  ink(k);
  pen.fillRect(x, y, w, h);
};
const circle = (x, y, r, stroke) => {
  pen.beginPath();
  pen.arc(x, y, r, 0, PI * 2);
  stroke ? pen.stroke() : pen.fill();
};
const path = (d) => new Path2D(d);

// Rect art. Groups are separated by spaces: a palette char, then 4 chars per
// filled rect (x, y, w, h) in base 62: 0-9, a-z = 10-35, A-Z = 36-61.
const b62 = (ch) => parseInt(ch, 36) + (ch > '9' && ch < 'a' ? 26 : 0);
function rects(spec, ox = 0) {
  for (const g of spec.split(' ')) {
    ink(g[0]);
    for (let i = 1; i < g.length; i += 4) pen.fillRect(ox + b62(g[i]), b62(g[i + 1]), b62(g[i + 2]), b62(g[i + 3]));
  }
}

// Pixel art: one palette char per pixel, '.' is empty. Every picture starts with
// a newline so pictures can be stacked with `+`; trailing empty pixels are left off.
// `frames` are drawn side by side, `w` apart, and become numbered texture frames.
function sheet(key, frames, w, h) {
  fromCanvas(
    key,
    w * frames.length,
    h,
    () => frames.forEach((rows, i) => rows.split('\n').forEach((row, y) => [...row].forEach((ch, x) => PAL[ch] && box(ch, i * w + x, y - 1, 1, 1)))),
    frames.length,
  );
}

// Seeded RNG so the art is identical every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CHILD_BODY = `

.......oo
......oYYo
.....oYhYYo
....oYhYYYYo
....oYYYYYYYo
...oYYYkkkkYo
...oYYkkkkkkYo
...oYYkkkkkkYo
...oYYYkkkkYYo
...oyYYYYYYYYo
..oyYYhYYYYYYo
..oyYYhYYYYYYYo
..oyYYYYyYYYYYo
.oyYYYYYyYYYYYo
.oyYYYYYyYYYYYYo
.oyYYYYYyYYYYYYo
oyyYYYYYyYYYYYYo
oyyyyyyyyyyyyyyo
.oooooooooooooo`;
// idle, run 1-3, jump
const CHILD_LEGS = [
  `
.....os..so
.....os..so
.....os..so
....oss..sso`,
  `
....os....so
...os......so
...os.......so
..oss.......sso`,
  `
.....os.so
.....os.so
.....os.so
....ossosso`,
  `
.....so..os
....so....os
...so.......os
..sso.......oss`,
  `
....os....so
...os......so`,
];

const SHADE_TOP = `

......1111
.....133331
....13333331
....1333rr31
....13333331
.....133331
......1331
....11133111
...1333333331
..133333333331
..13.133331.31
.13..133331..31
.13..133331..31
.13..133331..31
13...133331...31
13...133331...31
3....133331....3
3....133331....3
.....133331
.....122221`;
const SHADE_LEGS = [
  `
.....12..21
.....12..21
.....12..21
.....12..21
.....12..21
....12....21
....12....21
....12....21
...12......21
...12......21
..111......111`,
  `
.....12..21
.....12...21
....12....21
....12.....21
...12......21
...12.......21
..12........21
..12.........21
.12..........21
.12...........1
111..........11`,
];

const BAT = [
  `
1..............1
11............11
.11...1..1...11
.1111.1111.1111
..111111111111
...111r11r111
.....111111
......1111`,
  `


......1..1
......1111
....11111111
..1111r11r1111
.1111.1111.1111
11.....11.....11`,
];

const ICONS = {
  flashlight: `



..........wwo
.ooooooooowwwo
.o3444445o6wwo
.o3455545o6wwo
.o3444445o6wwo
.ooooooooowwwo
..........wwo`,
  crowbar: `
.............44
............5..4
...........5...4
..........5
.........5
........5
.......5
......4
.....4
....4
...4
..4
.4R
.rR`,
  umbrella: `
.......1
......1c1
.....1ccc1
....1ccccc1
...1ccccccc1
..1cccrccccc1
.1ccccrcccccc1
.1.1.1.5.1.1.1
.......5
.......5
.......5
.......5
.....5.5
......5`,
  revolver: `




...4666666666
..44555555556
..4444444
..455.3
..445
.445
.44`,
};

const UMBRELLA_OPEN = `
..........1111111111
.......111cccccccccc111
.....11cccccccrcccccccc11
...11cccccccccrcccccccccc11
..1cccccccccccrcccccccccccc1
.1ccccccccccccrccccccccccccc1
1cccccccccccccrcccccccccccccc1
1.1..1..1..1..5..1..1..1..1.11
..............5
..............5
..............5
..............5`;

const FLAME = [
  `
..w
.www
.wrw
.wrw
..r`,
  `
...w
..ww
.wwr
.wrw
..r`,
];
// full, empty
const HEART = [
  `
.RR.RR
RrrRrrR
RrrrrrR
.RrrrR
..RrR
...R`,
  `
.44.44
4..4..4
4.....4
.4...4
..4.4
...4`,
];

// Tile frames in the 'tiles' strip.
const TILE_BRICK = 0;
const TILE_BRICK_TOP = 1;
const TILE_BEAM = 2;
const TILE_BG = 3;
const TILE_BG_ALT = 4;

// Textures that are nothing but filled rects: key -> [width, height, rects].
const RECT_ART = {
  campesino: [16, 26, 'J5063 Y13e2 K5261 L5565 o9711 M6941 F4a88 53b16cb16 Lch12 z5i279i27 L5p219p21'], // straw hat, pale shirt, rolled trousers
  bone: [8, 4, 'I116200246024'],
  grave: [14, 18, 'o13cf3182 z24ae4262 B241c l66274862'],
  cross: [12, 24, 'o404o05c4 A512n16a2'],
  candle: [4, 10, 'H0248 E3218 w1113 k2012'], // the flame is a separate sprite
  candelabra: [22, 30, 'ta82k6sa228i22426i426 H2024a127i024'],
  shrine_lit: [24, 22, 'o2akc z3bib B3bi1 Rbe269g62 H5437b239h536'],
  shrine: [24, 22, 'o2akc z3bib B3bi1 Rbe269g62 H5437b239h536 k6311c111i411'],
  pillar: [20, 16, 'f00kg p20gg u403g id03g'],
  px: [2, 2, 'w0022'],
  blood: [3, 3, 'c0033 r0011'],
  chunk: [4, 4, 'z0044 C0021'],
};

function makeArt(scene) {
  textures = scene.textures;

  // Player frames: 0 idle, 1-3 run, 4 jump.
  sheet('child', CHILD_LEGS.map((l) => CHILD_BODY + l), 16, 24);
  sheet('shade', SHADE_LEGS.map((l) => SHADE_TOP + l), 16, 32);
  sheet('bat', BAT, 16, 8);
  for (const k in ICONS) sheet('tool_' + k, [ICONS[k]], 16, 16);
  sheet('umbrella_open', [UMBRELLA_OPEN], 30, 12);
  sheet('flame', FLAME, 5, 5);
  sheet('heart', HEART, 7, 6);
  for (const k in RECT_ART) fromCanvas(k, RECT_ART[k][0], RECT_ART[k][1], () => rects(RECT_ART[k][2]));

  // El Silbon: a gaunt, too-tall man under a wide hat, a sack of bones on his back. Two walk frames.
  fromCanvas(
    'silbon',
    48,
    56,
    () => {
      for (const i of [0, 1]) {
        // sack, hat, face, coat, arms, then the legs in mid-stride
        rects('41k59 t2n114q118287 48281 x29k2 B29k1 s9b66 k9b62 5ah41 z8i8g m9i6g t6j2kgj2k s6D22gD22 ' + ['t9y2mdy2m 48T41dT41', 't7y2mfy2m 46T41fT41'][i], i * 24);
      }
    },
    2,
  );

  fromCanvas('eyes', 8, 4, () => {
    box('rgba(255,0,0,0.35)', 0, 0, 8, 4);
    rects('r11225122');
  });
  fromCanvas('eyes_small', 6, 3, () => {
    rects('r01113111');
    box('rgba(255,0,0,0.3)', 0, 0, 5, 3);
  });

  makeTiles();
  makeProps();
  makeLights();
  makeBackdrops();
  makeFont(scene);
  makeLogo();
  makeFx();
}

// One 16px tile of brickwork at `ox`; `base` and `mortar` are grey levels.
function brick(ox, rand, base, mortar, top) {
  box(grey(mortar), ox, 0, 16, 16);
  [0, 5, 10].forEach((y, i) => {
    for (let x = i % 2 ? -4 : 0; x < 16; x += 8) {
      const x0 = max(0, x + 1);
      box(grey(base + floor(rand() * 14) - 7), ox + x0, y + 1, min(16, x + 8) - x0, i === 2 ? 5 : 4);
    }
  });
  // speckle
  for (let i = 0; i < 10; i++) box(grey(base + (rand() > 0.5 ? 14 : -10)), ox + floor(rand() * 16), floor(rand() * 16), 1, 1);
  // rain-slick top edge
  if (top) rects('E00g1 401g1 G3031b021', ox);
}

function makeTiles() {
  const rand = rng(7);
  fromCanvas('tiles', 80, 16, () => {
    brick(0, rand, 0x3a, 0x14);
    brick(16, rand, 0x3a, 0x14, true);
    // wooden beam (one-way)
    rects('o00g6 z00g4 C00g1 t2251a141 l1425d425', 32);
    // background walls (dark, low contrast)
    brick(48, rand, 0x1c, 0x0d);
    brick(64, rand, 0x16, 0x0a);
  });

  fromCanvas('cracked', 16, 16, () => {
    brick(0, rand, 0x4a, 0x1a);
    rects('k801272128412661278129a128c12ae129f1235419a41 D93115911');
    // yellow paint daubed across it: this stone can be broken
    for (let i = 0; i < 12; i++) box('N', 2 + i, 13 - i, 2, 2);
    rects('N1132cd32 O4e12d413');
  });

  fromCanvas('spikes', 16, 16, () => {
    for (let i = 0; i < 4; i++) {
      for (let y = 0; y < 10; y++) {
        const half = floor((y + 1) / 5);
        box(y < 2 ? 'I' : '5', i * 4 + 2 - half, 6 + y, 1 + half * 2, 1);
      }
    }
    rects('R2812a713');
  });

  fromCanvas('veil', 32, 32, () => {
    const r = rng(99);
    box('k', 0, 0, 32, 32);
    for (let i = 0; i < 70; i++) {
      const x = floor(r() * 32);
      const y = floor(r() * 32);
      const l = 2 + floor(r() * 8);
      box(r() > 0.85 ? '4' : 'n', x, y, 1, l);
    }
    rects('Rc911pm11');
  });
}

function makeProps() {
  fromCanvas('tree', 70, 110, () => {
    ink('a');
    pen.lineCap = 'round';
    const r = rng(3);
    const branch = (x, y, a, len, w) => {
      if (len < 5 || w < 1) return;
      const x2 = x + cos(a) * len;
      const y2 = y + sin(a) * len;
      pen.lineWidth = w;
      pen.beginPath();
      pen.moveTo(x, y);
      pen.lineTo(x2, y2);
      pen.stroke();
      branch(x2, y2, a - 0.35 - r() * 0.4, len * 0.72, w * 0.68);
      branch(x2, y2, a + 0.3 + r() * 0.4, len * 0.68, w * 0.68);
    };
    branch(35, 110, -PI / 2, 36, 7);
  });
  fromCanvas('window', 32, 72, () => {
    const arch = path('M2 72L2 24Q2 4 16 0Q30 4 30 24L30 72Z');
    ink('b');
    pen.fill(arch);
    pen.save();
    pen.clip(arch);
    const r = rng(11);
    for (let y = 0; y < 72; y += 6) {
      for (let x = 4; x < 30; x += 6) {
        const p = r();
        box(p > 0.88 ? 'P' : p > 0.5 ? 'x' : 'q', x, y, 5, 5);
      }
    }
    rects('bf02AfA2A0Aw2');
    pen.restore();
    ink('A');
    pen.stroke(arch);
  });
  fromCanvas('rose', 64, 64, () => {
    ink('b');
    circle(32, 32, 31);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2;
      ink(i % 3 ? 'v' : 'P');
      circle(32 + cos(a) * 19, 32 + sin(a) * 19, 8);
    }
    ink('R');
    circle(32, 32, 8);
    ink('4');
    circle(32, 32, 30, true);
  });
  fromCanvas('vault', 128, 48, () => {
    ink('q');
    pen.lineWidth = 4;
    pen.stroke(path('M0 48Q0 6 64 0Q128 6 128 48'));
    ink('j');
    pen.lineWidth = 2;
    pen.stroke(path('M12 48Q14 14 64 8Q114 14 116 48'));
  });
  fromCanvas('bell', 48, 52, () => {
    ink('o');
    pen.fill(path('M20 2L28 2Q38 4 39 22Q40 38 47 46L1 46Q8 38 9 22Q10 4 20 2'));
    ink('B');
    pen.fill(path('M21 4L27 4Q36 6 37 22Q38 37 44 44L4 44Q10 37 11 22Q12 6 21 4'));
    rects('Efa3s xva3u6EA2 lmI48 Rkk82ng2a');
  });
}

// Fill the whole canvas with a gradient: stops are offset, colour, offset, colour...
function gradient(g, ...stops) {
  for (let i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], PAL[stops[i + 1]] || stops[i + 1]);
  return g;
}

function makeLights() {
  fromCanvas('light', 128, 128, () =>
    box(
      gradient(pen.createRadialGradient(64, 64, 0, 64, 64, 64), 0, 'rgba(255,255,255,0.85)', 0.45, 'rgba(255,255,255,0.55)', 0.75, 'rgba(255,255,255,0.22)', 1, 'rgba(255,255,255,0)'),
      0,
      0,
      128,
      128,
    ),
  );
  // Flashlight cone, origin at left-middle, pointing right.
  fromCanvas('cone', 256, 160, () => {
    const img = pen.createImageData(256, 160);
    const spread = 0.42; // radians half-angle
    img.data.fill(255);
    for (let i = 0; i < 256 * 160; i++) {
      const x = i % 256;
      const dy = floor(i / 256) - 80;
      const d = hypot(x, dy);
      const a = abs(atan2(dy, x + 0.001));
      let v = 0;
      if (a < spread && d < 256) {
        v = max(0, (1 - (a / spread) ** 3) * (1 - (d / 256) ** 2.4));
        if (d < 14) v = max(v, 0.6 * (1 - d / 14));
      }
      img.data[i * 4 + 3] = floor(v * 255);
    }
    pen.putImageData(img, 0, 0);
  });
}

// 5x7 pixel font, one base-32 digit per row; drawn 2px wide for chunky 8-bit stems.
const FONT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?&-:/() Ñ¡¿';
const FONT =
  'ehhvhhhuhhuhhuehgggheuhhhhhuvgguggvvggugggehgjhhehhhvhhhe44444e1111hhehikokihggggggvhrrhhhhhppljjhehhhhheuhhugggehhhliduhhukihehge1hev444444hhhhhhehhhhaa4hhhhrrhhha4ahhhha4444v1248gvehjlphe4c4444eeh168gveh161he26aiv22vgu11heegguhhev124444ehhehheehhf11e000008800004484444404eh124048kk8lid000e000044044011248gg248884284222480000000ehpljhh40444444048ghe';

// Title logo letters: brush strokes [x1, y1, x2, y2, ...] on a 4x6 grid, heavy at the start, thin at the tip.
const O = [0, 0, 0, 6, 0, 0, 4, -0.3, 4, 0, 4, 6, 0, 6, 4, 5.7];
const GLYPHS = {
  E: [0, 0, 0, 6, 0, 0, 4, -0.4, 0, 3, 3, 2.7, 0, 6, 4, 5.6],
  L: [0, 0, 0, 6, 0, 6, 4, 5.6],
  A: [2, 0, 0, 6, 2, 0, 4, 6, 0.6, 4, 3.4, 3.7],
  P: [0, 0, 0, 6, 0, 0, 4, -0.3, 4, 0, 4, 3, 4, 3, 0, 3.3],
  G: [4, 0, 0, 0.3, 0, 0, 0, 6, 0, 6, 4, 5.7, 4, 6, 4, 3.2, 4, 3.2, 2, 3.4],
  O,
  o: [...O, 3.4, -2.8, 1.8, -1.5], // O with acute accent
  N: [0, 0, 0, 6, 0, 0, 4, 6, 4, 0, 4, 6],
};

// Brush logo: slanted tapering strokes, blood red with a white rim. Drawn small with
// hard edges and shown at LOGO_SCALE, so it is as chunky as the rest of the art.
const LOGO_SCALE = 3;
function makeLogo() {
  fromCanvas('logo', 160, 50, () => {
    const word = (text, x, y, u, sw) => {
      // white rim, then the red face
      for (const lw of [2, 0]) {
        pen.lineWidth = lw;
        ink(lw ? 'w' : 'r');
        [...text].forEach((ch, i) => {
          pen.setTransform(1, 0, -0.3, 1, x + i * (u * 5 + sw), y);
          const g = GLYPHS[ch];
          for (let k = 0; k < g.length; k += 4) {
            const [ax, ay, bx, by] = g.slice(k, k + 4).map((v) => v * u);
            const s = sw / 2 / hypot(bx - ax, by - ay);
            const dx = (bx - ax) * s;
            const dy = (by - ay) * s;
            const stroke = path(
              `M${ax - dx - dy} ${ay - dy + dx}L${ax - dx + dy} ${ay - dy - dx}L${bx + (dx + dy) * 0.4} ${by + (dy - dx) * 0.4}L${bx + (dx - dy) * 0.4} ${by + (dy + dx) * 0.4}Z`,
            );
            lw ? pen.stroke(stroke) : pen.fill(stroke);
          }
        });
      }
    };
    word('EL', 71, 5, 1.7, 2.7);
    word('APAGoN', 19, 21, 3.7, 5);
    // No soft edges: every pixel is either there or not.
    const img = pen.getImageData(0, 0, 160, 50);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 127 ? 255 : 0;
    pen.putImageData(img, 0, 0);
  });
}

function makeFont(scene) {
  fromCanvas('font', FONT_CHARS.length * 8, 8, () => {
    ink('w');
    [...FONT].forEach((d, i) => {
      for (let b = 0; b < 5; b++) if ((parseInt(d, 32) << b) & 16) pen.fillRect(floor(i / 7) * 8 + b, i % 7, 2, 1);
    });
  });
  scene.cache.bitmapFont.add('font', Phaser.GameObjects.RetroFont.Parse(scene, { image: 'font', width: 8, height: 8, chars: FONT_CHARS }));
}

function label(scene, x, y, text, tint = 0xffffff, scale = 1) {
  return scene.add.bitmapText(x, y, 'font', text, 8 * scale, 1).setOrigin(0.5).setTint(tint);
}

function makeBackdrops() {
  fromCanvas('sky', 640, 480, () => {
    box(gradient(pen.createLinearGradient(0, 0, 0, 480), 0, 'a', 0.6, 'i', 1, 'q'), 0, 0, 640, 480);
    const r = rng(21);
    for (let i = 0; i < 60; i++) {
      const x = r() * 700 - 30;
      const y = r() * 270;
      const w = 60 + r() * 140;
      ink(`rgba(${r() > 0.5 ? '40,40,40' : '20,20,20'},0.5)`);
      pen.beginPath();
      pen.ellipse(x, y, w / 2, 8 + r() * 14, 0, 0, PI * 2);
      pen.fill();
    }
  });

  fromCanvas('spires', 640, 480, () => {
    const r = rng(5);
    for (let x = 0; x < 640; ) {
      const w = 30 + r() * 60;
      const h = 124 + r() * 140;
      const top = 480 - h;
      box('d', x, top, w, h);
      // spire
      pen.fill(path(`M${x + w * 0.2} ${top}L${x + w / 2} ${top - 30 - r() * 60}L${x + w * 0.8} ${top}`));
      // pinnacles
      pen.fillRect(x, top - 10, 3, 10);
      pen.fillRect(x + w - 3, top - 10, 3, 10);
      // dim windows
      if (r() > 0.4) {
        ink(r() > 0.8 ? 'Q' : 'm');
        circle(x + w / 2, top + 30, 6);
      }
      x += w + r() * 20;
    }
  });

  fromCanvas('buttress', 640, 480, () => {
    const r = rng(8);
    box('a', 0, 420, 640, 60);
    for (let x = 0; x < 640; x += 160) {
      const h = 140 + r() * 60;
      const y = 480 - h;
      pen.fillRect(x + 10, y, 26, h);
      // pinnacle, then the flying arch
      pen.fill(path(`M${x + 23} ${y - 40}L${x + 10} ${y}L${x + 36} ${y}`));
      pen.fill(path(`M${x + 36} ${y + 20}Q${x + 100} ${y + 10} ${x + 150} 420L${x + 140} 420Q${x + 95} ${y + 30} ${x + 36} ${y + 34}`));
    }
  });
}

function makeFx() {
  fromCanvas('drop', 4, 14, () => {
    ink('rgba(220,220,220,0.9)');
    pen.beginPath();
    pen.moveTo(3.5, 0);
    pen.lineTo(0.5, 14);
    pen.stroke();
  });
  // Free-aim crosshair.
  fromCanvas('reticle', 11, 11, () => {
    ink('rgba(255,255,255,0.9)');
    circle(5, 5, 4, true);
    rects('r5012591205219521');
  });
  for (const v of [0, 1, 2]) {
    fromCanvas('splat' + v, 14, 4, () => {
      const r = rng(40 + v);
      rects('S22a2');
      for (let i = 0; i < 9; i++) box(r() > 0.5 ? 'T' : 'U', floor(r() * 14), 1 + floor(r() * 3), 1 + floor(r() * 3), 1);
    });
  }
  fromCanvas('smoke', 6, 6, () => {
    ink('rgba(180,180,180,0.6)');
    circle(3, 3, 3);
  });
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
const W = 192;
const ARENA_X = 150; // first column of the ruins where El Silbon is fought
const ARENA_Y = 30;
const H = 40;
const SCREEN_W = 640;
const SCREEN_H = 480;

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
  const inside = (x1, y1, x2, y2) => fill(x1, y1, x2, y2, 1, interior);
  const beam = (x1, x2, y) => fill(x1, y, x2, y, BEAM);
  // One entity; `a` and `b` are whatever that type needs (see buildEntities).
  const one = (type, x, y, a, b) => ents.push({ type, x, y, a, b });
  // Plain entities of one type: e(type, x, y, x, y, ...).
  const e = (type, ...at) => {
    for (let i = 0; i < at.length; i += 2) one(type, at[i], at[i + 1]);
  };
  const cracked = (x1, y1, x2, y2) => {
    fill(x1, y1, x2, y2, EMPTY);
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) one('cracked', x, y);
  };
  const spikes = (x1, x2, y, abyss) => {
    for (let x = x1; x <= x2; x++) one('spikes', x, y, abyss);
  };

  // World shell
  fill(0, 0, 1, H - 1);
  fill(W - 2, 0, W - 1, H - 1);
  fill(0, H - 2, W - 1, H - 1);
  fill(ARENA_X - 2, 0, ARENA_X - 1, H - 1); // belfry's outer wall; the ruins lie beyond it
  fill(ARENA_X, ARENA_Y, W - 3, H - 3);

  // Graveyard (the child starts at 5, 26)
  fill(2, 26, 33, 37);
  fill(12, 25, 16, 25);
  fill(24, 24, 27, 25);
  one('shrine', 8, 26, true); // already lit
  e('tree', 3, 26);
  one('tree', 21, 26, true); // flipped
  e('grave', 10, 26, 14, 25, 18, 26, 29, 26);
  e('cross', 25, 24, 31, 26);
  e('shade', 20, 26);
  e('candle', 11, 26, 30, 26);

  // Cathedral facade with a veiled door.
  fill(34, 0, 35, 20);
  fill(34, 26, 35, 37);
  one('veil', 34, 21, 2, 5); // width, height

  // Nave
  fill(36, 0, 89, 3); // vaulted ceiling
  fill(36, 26, 89, 27); // floor (the crypt lies below)
  fill(88, 0, 89, 6); // right wall, upper
  fill(88, 11, 89, 37); // right wall, lower (opening at rows 7-10 onto the chasm)
  inside(36, 4, 87, 25);

  beam(40, 45, 23);
  beam(49, 53, 20);
  beam(56, 60, 17);
  beam(63, 67, 14);
  beam(70, 87, 11); // gallery

  e('shrine', 38, 26);
  one('tool', 78, 11, 'crowbar');
  cracked(44, 26, 46, 27); // way down into the crypt
  e('shade', 58, 26, 78, 26);
  e('bat', 55, 12, 74, 7);
  e('candelabra', 41, 26, 62, 26, 72, 26);
  e('candle', 71, 11, 86, 11);
  e('pillar', 39, 4, 48, 4, 57, 4, 66, 4, 75, 4, 84, 4);
  e('window', 43, 5, 52, 5, 70, 5, 79, 5);
  e('rose', 61, 5);
  e('vault', 39, 4, 48, 4, 57, 4, 66, 4, 75, 4);

  // Crypt
  fill(36, 36, 87, 37); // crypt floor
  fill(55, 36, 59, 37, EMPTY); // spike pit
  fill(67, 36, 71, 37, EMPTY); // spike pit
  spikes(55, 59, 38);
  spikes(67, 71, 38);
  inside(36, 28, 87, 37);
  one('veil', 62, 28, 2, 8);
  e('shrine', 49, 36);
  one('tool', 82, 36, 'umbrella');
  e('shade', 52, 36, 77, 36);
  e('bat', 75, 31);
  e('candle', 40, 36, 65, 36, 80, 36);
  e('cross', 38, 36);
  e('grave', 44, 36, 74, 36);
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
  inside(110, 2, 147, 16);
  fill(110, 9, 141, 9); // floor between levels
  beam(142, 147, 9);
  beam(142, 146, 14);
  beam(142, 146, 11);
  cracked(128, 10, 129, 16);
  e('shrine', 112, 17);
  e('shade', 121, 17, 137, 17);
  one('veil', 130, 2, 2, 7);
  e('bat', 138, 5, 124, 4);
  e('candle', 116, 17, 126, 9, 140, 9);
  e('window', 117.5, 11, 137.5, 11, 136.5, 3);
  e('bell', 116.5, 2);

  return { grid, interior, ents };
}

// Digital-glitch camera filter: RGB split, tear bands, datamosh blocks,
// pixel-sort streaks, scanline corruption and film grain.
// `amount` 0..1 drives how broken the picture gets.
// Kept flush left and tight: every byte in here counts against the size limit.
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uMainSampler;
uniform vec2 res;
uniform float time;
uniform float amount;
varying vec2 outTexCoord;
float rand(vec2 co) {
vec3 p = fract(vec3(co.xyx) * .1031);
p += dot(p, p.yzx + 33.33);
return fract((p.x + p.y) * p.z);
}
float luma(vec3 c) {
return dot(c, vec3(.299, .587, .114));
}
void main() {
vec2 uv = outTexCoord;
float I = amount;
float t = mod(floor(time * 14.), 251.);
float band = floor(uv.y * 28.);
float tear = step(1. - I * .4, rand(vec2(band, t))) * (rand(vec2(band + 7., t)) - .5) * .16 * I;
float line = floor(uv.y * res.y);
uv.x += tear + step(1. - I * .05, rand(vec2(line * .37 + t * 3.1, t + 2.))) * (rand(vec2(line * 1.7, t)) - .5) * .06;
vec2 blk = floor(uv * vec2(20., 12.));
if (rand(blk + vec2(t * .37, t * .11)) > 1. - I * .14) {
uv += (vec2(rand(blk + 1.3), rand(blk + 2.1)) - .5) * .08 * (.5 + I);
}
float split = .0012 + I * .014;
vec2 dir = vec2(split, split * .35 * sin(time * 9.));
vec4 col = texture2D(uMainSampler, uv);
col.r = texture2D(uMainSampler, uv + dir).r;
col.b = texture2D(uMainSampler, uv - dir).b;
if (step(1. - I * .3, rand(vec2(floor(uv.x * res.x / 2.) * .13, band + t))) > .5) {
vec4 m = col;
for (int i = 1; i < 12; i++) {
vec4 s = texture2D(uMainSampler, uv + vec2(0., float(i) * 3. / res.y));
if (luma(s.rgb) > luma(m.rgb)) { m = s; }
}
col = mix(col, m, .6);
}
col.rgb *= .86 + .14 * sin(outTexCoord.y * res.y * 3.14159);
float cl = step(1. - max(0., I - .12) * .03, rand(vec2(line * .37 + t * 13.1, t * 7.3 + 5.)));
col.rgb = mix(col.rgb, vec3(rand(vec2(line, t))), cl * .7);
col.rgb += (rand(outTexCoord * res + t * 17.) - .5) * (.05 + I * .1);
gl_FragColor = col;
}
`;

// Property and method names are two letters to fit the size limit (the minifier
// cannot shorten them). What each one means:
//   aa aimAngle, ab aimBox, ac attackCooldown, ad abyss, af addFlame
//   ag auraGlow, al addLight, am aiming, an amount, ax aimX
//   ay aimY, ba bell, bb belfryBell, bc bats, bd buildDarkness
//   be buildEntities, bf bloodFx, bg bigText, bh bossHearts, bi big
//   bj base, bl bleed, bm buildTilemaps, bn bones, bo bolt
//   bp buildPlayer, br burning, bs boss, bt buttress, bx buildFx
//   bz bellZone, ca ctl, cb crumbling, cc clock, ce collect
//   cg crackedGroup, ch checkpoint, cl crumble, cm cam, cn coneGlow
//   co cone, cr cracked, cs chasing, ct cycleTool, cu cut
//   da downAt, db drawBolt, dc decals, dd dead, df debrisFx
//   di die, dk dark, dm damage, dp dropRow, dr dir
//   ds dropBars, dt dropTool, du dropUntil, dv dissolveVeil, dy dying
//   ef emberFx, eq equipped, ex expires, ey eyes, fa floorAt
//   fc facing, fg falling, fh flashRect, fl flicker, fn found
//   fr flashRed, fs focus, gb groundBelow, gd gliding, gf glitchFx
//   gl glitch, gw glow, ha hideAt, hb hitBoss, hc heartIcons
//   hd hud, hi hit, hl held, hm home, hn hint
//   hr hearts, hs hintsShown, ht hurt, ic inCone, iu invulnUntil
//   iv inventory, jl jolt, jp jumpPressedAt, kl kill, la leaveArena
//   lg lastGround, lh lights, li lit, ln land, lo lineOfSight
//   ls lightShrine, lt lastVy, lu lunge, lv level, ly layer
//   ma msg, mb msgBg, md mode, mg maxGap, mn monsters
//   mp minGap, ms message, mu modeUntil, na nextAt, op onSpikes
//   ot onStrike, pa pickableAt, pc pickups, pl player, pn panel
//   pr prompt, ps pulse, ra respawnAtCheckpoint, rb ruinBell, rc rect
//   rl reclaim, rt reticle, s0 shineCone, s1 skyFlash, s2 splashFx
//   s3 smokeFx, sa showBoss, sb silbon, sc schedule, sd shriekAt
//   se stepTimer, sf spires, sg spikeGroup, sh shades, si slotIcons
//   sj starting, sk spike, sl slotUnknown, sm spawnMonster, sn strength
//   sp spawnPickup, sq showMessage, sr strike, ss setRuins, st storm
//   su stunUntil, sv silbonIntro, sw swingUntil, sx shrines, sy slotGfx
//   sz startArena, ta tileAt, tb toolLabel, tc tool, th thrown
//   tk tick, tl tall, tr throwRevolver, ts titleShadow, tt title
//   ua updateBat, ub updateBoss, ud updateDarkness, ul updateTools, un until
//   uo umbrellaOpen, up updatePickups, ur updateRainSplashes, us updateShade, ut updatePlayer
//   vg veilGroup, vl veils, wg wasGrounded, wi win, wn won

// Phaser 3 post-pipeline (registered in the game config) that runs FRAG over a
// whole camera. Each camera gets its own instance; `ctl` is the Glitch controller feeding it.
class GlitchPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game) {
    super({ game, name: 'Glitch', fragShader: FRAG });
  }

  onPreRender() {
    const c = this.ca;
    this.set2f('res', this.renderer.width, this.renderer.height);
    this.set1f('time', c ? c.cc : 0);
    this.set1f('amount', c ? c.an : 0);
  }
}

class Glitch {
  constructor(base) {
    this.cc = this.sk = 0;
    this.bj = this.an = base;
  }

  // Momentary burst; decays back to `base`.
  hi(amount) {
    this.sk = max(this.sk, amount);
  }

  tk(dt) {
    this.cc += dt;
    this.sk *= 0.04 ** dt; // fast exponential decay
    this.an = min(1, this.bj + this.sk);
  }
}

// Adds glitch + vignette to a camera and returns the glitch controller.
function addCameraFx(camera, base) {
  const glitch = new Glitch(base);
  camera.setPostPipeline('Glitch');
  camera.getPostPipeline('Glitch').ca = glitch;
  camera.postFX.addVignette(0.5, 0.5, 0.9, 0.55);
  return glitch;
}

// Small scene helpers.
const image = (scene, x, y, key, depth, ox = 0.5, oy = ox, frame) => scene.add.image(x, y, key, frame).setOrigin(ox, oy).setDepth(depth);
const later = (scene, ms, fn) => scene.time.delayedCall(ms, fn);
const fade = (scene, targets, alpha, duration, delay = 0, onComplete = null) => scene.tweens.add({ targets, alpha, duration, delay, onComplete });
// Full-screen white sheet, invisible until its alpha is raised.
const whiteout = (scene, depth) => scene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0xffffff).setOrigin(0).setScrollFactor(0).setDepth(depth).setAlpha(0);
const backdrop = (scene, key, y, depth) => scene.add.tileSprite(0, y, SCREEN_W, SCREEN_H, key).setOrigin(0).setScrollFactor(0).setDepth(depth);
const range = (min, max) => ({ min, max });
const ramp = (start, end) => ({ start, end });

// `level` (0..1) is how lit the world is right now — the game uses it to lift the darkness.
class Storm {
  constructor(scene, minGap = 4000, maxGap = 10000) {
    this.scene = scene;
    this.lv = 0;
    this.mp = minGap;
    this.mg = maxGap;
    this.ot = null;

    image(scene, 0, 0, 'sky', -30, 0).setScrollFactor(0);
    this.s1 = whiteout(scene, -29);
    this.bo = scene.add.graphics().setScrollFactor(0).setDepth(-28);

    const rain = (depth, lifespan, speedY, speedX, alpha, quantity, frequency, extra) =>
      scene.add
        .particles(0, 0, 'drop', { x: range(-60, SCREEN_W + 120), y: -20, lifespan, speedY, speedX, alpha, quantity, frequency, ...extra })
        .setScrollFactor(0)
        .setDepth(depth);
    rain(40, 1000, range(520, 640), range(-135, -115), range(0.25, 0.55), 5, 16, { scaleY: range(0.7, 1.3) });
    rain(62, 750, range(700, 800), range(-170, -150), range(0.1, 0.22), 2, 20, { scale: range(1.2, 1.6) });

    this.fh = whiteout(scene, 55);
    this.sc();
  }

  sc() {
    later(this.scene, between(this.mp, this.mg), () => {
      this.sr();
      this.sc();
    });
  }

  sr(power = Phaser.Math.FloatBetween(0.6, 1)) {
    const bolt = () => this.db(between(40, SCREEN_W - 40));
    bolt();
    this.lv = power;
    later(this.scene, 80, () => (this.lv = 0.15));
    later(this.scene, 150, () => {
      this.lv = power;
      bolt();
    });
    thunder(Phaser.Math.FloatBetween(0.15, 1.4), power);
    if (this.ot) this.ot(power);
  }

  db(x) {
    const g = this.bo;
    g.clear();
    const seg = (x1, y1, len, width, depth) => {
      const begin = () => g.lineStyle(width, 0xffffff, 1).beginPath().moveTo(x1, y1);
      begin();
      for (let i = 0; i < len; i++) {
        x1 += between(-14, 14);
        y1 += between(8, 18);
        g.lineTo(x1, y1);
        if (depth < 2 && random() < 0.15) {
          g.strokePath();
          seg(x1, y1, floor(len / 3), max(1, width - 1), depth + 1);
          begin();
        }
      }
      g.strokePath();
    };
    seg(x, 0, 21, 2, 0);
  }

  update(dt) {
    const l = (this.lv = max(0, this.lv - dt * 1.6));
    this.bo.setAlpha(l > 0.3 ? 1 : l * 3);
    this.s1.setAlpha(l * 0.45);
    this.fh.setAlpha(l * 0.12);
  }
}

class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    makeArt(this);

    const anim = (key, texture, list, frameRate, repeat = -1) =>
      this.anims.create({ key, frames: list.map((frame) => ({ key: texture, frame })), frameRate, repeat });
    anim('child-idle', 'child', [0], 1, 0);
    anim('child-run', 'child', [1, 2, 3, 2], 10);
    anim('child-jump', 'child', [4], 1, 0);
    anim('shade-walk', 'shade', [0, 1], 3);
    anim('silbon-walk', 'silbon', [0, 1], 4);
    anim('bat-fly', 'bat', [0, 1], 10);
    anim('flame', 'flame', [0, 1], 7);

    this.scene.start('Title');
  }
}

const TOOLS = ['flashlight', 'crowbar', 'umbrella', 'revolver'];
const TOOL_NAMES = { flashlight: 'LINTERNA', crowbar: 'PATA DE CABRA', umbrella: 'PARAGUAS', revolver: 'REVOLVER' };

class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    const cam = this.cameras.main;
    const mid = SCREEN_W / 2;
    const ground = SCREEN_H - 36;
    this.sj = false;
    this.gl = addCameraFx(cam, 0.08);
    this.st = new Storm(this, 2500, 6000);
    this.st.ot = (p) => this.gl.hi(0.5 * p);

    backdrop(this, 'spires', 84, -22);
    backdrop(this, 'buttress', 70, -21);

    image(this, mid, ground, 'child', 10, 0.5, 1, 0).setScale(2);
    this.add.rectangle(0, ground, SCREEN_W, 36, 0x050505).setOrigin(0).setDepth(9);
    image(this, mid - 120, ground, 'shade', 8, 0.5, 1, 0).setScale(2).setAlpha(0.8);
    image(this, mid + 150, ground, 'shade', 8, 0.5, 1, 1).setScale(2).setAlpha(0.8).setFlipX(true);
    this.ey = [mid - 118, mid + 148].map((x) => image(this, x, ground - 55, 'eyes', 12).setScale(2));

    this.ts = image(this, mid + 3, 98, 'logo', 20).setScale(LOGO_SCALE).setTintFill(0xb00010);
    this.tt = image(this, mid, 96, 'logo', 21).setScale(LOGO_SCALE);
    // Controls, shown rather than told: what the child does, then the button that does it.
    const img = (x, y, key, frame) => image(this, x, y, key, 21, 0.5, 0.5, frame).setScale(2);
    const gfx = this.add.graphics().setDepth(21);
    [
      ['MOVER', 'JOYSTICK', (x, y) => this.add.sprite(x, y, 'child').setScale(2).setDepth(21).play('child-run')],
      [
        'USAR',
        'BTN 2',
        (x, y) => {
          image(this, x + 10, y, 'cone', 20, 0, 0.5).setScale(0.2).setAlpha(0.5);
          img(x - 12, y, 'child', 0);
          img(x + 4, y + 4, 'tool_flashlight');
        },
      ],
      [
        'SALTAR / PLANEAR',
        'BTN 1',
        (x, y) => {
          img(x, y + 4, 'child', 4);
          img(x, y - 30, 'umbrella_open');
        },
      ],
      ['CAMBIAR', 'BTN 5 / 6', (x, y) => TOOLS.slice(0, 3).forEach((t, i) => img(x + (i - 1) * 30, y + 6, 'tool_' + t))],
      [
        'APUNTAR',
        'BTN 2 Y JOYSTICK',
        (x, y) => {
          img(x - 12, y, 'child', 0);
          img(x + 14, y - 22, 'reticle').setRotation(-PI / 4);
        },
      ],
    ].forEach(([act, btn, icon], i) => {
      const x = mid + (i - 2) * 124;
      icon(x, 214);
      label(this, x, 250, act).setDepth(21);
      gfx.fillStyle(0x4a4a4a).fillRect(x - 13, 276, 26, 6);
      if (i) gfx.fillStyle(0xc00010).fillRect(x - 8, 268, 16, 8).fillStyle(0xff1a1a).fillRect(x - 6, 266, 12, 4);
      else gfx.fillStyle(0x9a9a9a).fillRect(x, 264, 3, 12).fillStyle(0xff1a1a).fillRect(x - 3, 259, 9, 8);
      label(this, x, 292, btn, 0x8c8c8c).setDepth(21);
    });
    label(this, mid, 314, '   BTN 4: SILENCIAR   ', 0x6a6a6a).setDepth(21);
    this.pr = label(this, mid, 344, 'PULSA START', 0xffffff, 2).setDepth(21);

    const start = () => {
      if (this.sj) return;
      this.sj = true;
      initAudio();
      startMusic();
      sound('glitch');
      this.gl.hi(1);
      this.st.sr(1);
      cam.fadeOut(700, 0, 0, 0);
      cam.once('camerafadeoutcomplete', () => this.scene.start('Game'));
    };
    anyPress = start;
    this.events.once('shutdown', () => (anyPress = null));
    this.input.once('pointerdown', start);
  }

  update(time, delta) {
    const dt = delta / 1000;
    const mid = SCREEN_W / 2;
    this.st.update(dt);
    this.gl.tk(dt);
    this.pr.setAlpha(floor(time / 500) % 2 ? 0.35 : 1);

    const jitter = random() < 0.06 + this.gl.an * 0.3 ? between(-6, 6) : 0;
    this.tt.x = mid + jitter;
    this.ts.x = mid + 3 - jitter * 1.5 + (random() < 0.05 ? 8 : 0);
    for (const e of this.ey) e.setAlpha(0.6 + random() * 0.4 + this.st.lv);
  }
}

const RUN = 130;
const JUMP = 360;
const GLIDE_FALL = 36;
const MAX_HEARTS = 3;
const DROP_TIME = 5000; // how long a dropped tool waits on the ground
const BASE_DARK = 0.8;
const HUD_LINGER = 4000; // ms the HUD stays up after a tool change or a hit
const BOSS_HP = 8;
const NEVER = -1e9;
// How each tool is held: [distance from the child along the aim, height, scale].
const TOOL_HOLD = { flashlight: [8, 11, 0.6], crowbar: [7, 10, 0.8], umbrella: [6, 10, 0.7], revolver: [9, 11, 0.8] };
// Scenery that is just an image standing on its tile: [origin y, depth, y offset].
const PROPS = {
  tree: [1, -3, 2],
  grave: [1, -2, 1],
  cross: [1, -2, 1],
  candle: [1, -1, 0],
  candelabra: [1, -1, 0],
  window: [0, -7, 0],
  rose: [0, -7, 0],
  bell: [0, -1, 0],
  vault: [0, -7, 0],
};

class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
    this.ln = buildWorld();
    this.cr = new Map(); // "x,y" -> sprite
    this.lh = []; // static light sources {x, y, r, flicker, glow}
    this.dc = [];
    this.hs = new Set();
    this.dd = this.wn = this.gd = this.am = this.th = false;
    this.cu = false; // cutscene: the child stands frozen
    this.hr = MAX_HEARTS;
    this.iv = new Set(['flashlight']);
    this.fn = new Set(['flashlight']);
    this.eq = 'flashlight';
    this.fc = this.fl = this.ax = 1;
    this.iu = this.su = this.lg = this.du = this.ac = this.sw = this.se = this.aa = this.ay = 0;
    this.jp = this.da = NEVER;
    this.dp = -1; // beam row being dropped through
    this.bs = this.sb = this.rb = null;

    const cam = (this.cm = this.cameras.main);
    this.gl = addCameraFx(cam, 0.04);
    this.st = new Storm(this);
    this.st.ot = (p) => this.gl.hi(0.35 * p);
    cam.fadeIn(900, 0, 0, 0);

    this.sf = backdrop(this, 'spires', 0, -22);
    this.bt = backdrop(this, 'buttress', 0, -21);
    this.bm();
    this.bx();
    this.be();
    this.bp();
    this.bd();

    // The HUD lives in its own scene so the darkness, vignette and glitch
    // filters never dim it. It fades out on its own when nothing changes.
    this.hd = this.scene.get('Hud');
    this.scene.launch('Hud');
    this.events.once('shutdown', () => this.scene.stop('Hud'));

    // Ignore whatever was pressed on the title screen.
    clearTaps();

    this.physics.world.setBounds(0, 0, W * T, H * T);
    cam.setBounds(0, 0, W * T, H * T);
    cam.startFollow(this.pl, true, 0.12, 0.12, 0, 30);

    // The legend: when the whistle sounds close, El Silbon is far away.
    later(this, 5200, () => {
      whistle(0.14, 76);
      this.hn('whistle', 'Un silbido... dicen que si suena cerca, el esta lejos.', 4500);
    });
    later(this, 900, () => this.hn('start', 'JOYSTICK mover - BOTON 1 saltar - tu LINTERNA quema lo que acecha'));
  }

  bm() {
    const { grid, interior } = this.ln;
    const rand = new Phaser.Math.RandomDataGenerator(['bg']);
    const layer = (data, depth) => {
      const map = this.make.tilemap({ data, tileWidth: T, tileHeight: T });
      return map.createLayer(0, map.addTilesetImage('tiles', 'tiles', T, T, 0, 0), 0, 0).setDepth(depth);
    };

    layer(
      interior.map((row) => row.map((v) => (v ? (rand.frac() < 0.3 ? TILE_BG_ALT : TILE_BG) : -1))),
      -10,
    );
    this.ly = layer(
      grid.map((row, y) =>
        row.map((v, x) => (v === SOLID ? (y > 0 && grid[y - 1][x] !== SOLID ? TILE_BRICK_TOP : TILE_BRICK) : v === BEAM ? TILE_BEAM : -1)),
      ),
      0,
    );
    this.ly.setCollision([TILE_BRICK, TILE_BRICK_TOP]);
    this.ly.forEachTile((t) => {
      if (t.index === TILE_BEAM) t.setCollision(false, false, true, false);
    });
  }

  bx() {
    const fx = (key, depth, config) => this.add.particles(0, 0, key, { emitting: false, ...config }).setDepth(depth);
    this.bf = fx('blood', 20, { lifespan: range(500, 1100), speed: range(60, 240), angle: range(200, 340), gravityY: 700, scale: ramp(1, 0.4) });
    this.s3 = fx('smoke', 21, { lifespan: 600, speedY: range(-60, -20), speedX: range(-20, 20), alpha: ramp(0.6, 0), scale: ramp(0.6, 1.6) });
    this.ef = fx('px', 61, { lifespan: 500, speed: range(20, 80), angle: range(220, 320), tint: [0xff1a1a, 0xffffff], scale: ramp(1, 0) });
    this.df = fx('chunk', 20, { lifespan: 900, speed: range(40, 200), angle: range(200, 340), gravityY: 800, rotate: range(0, 360) });
    this.s2 = fx('px', 15, {
      lifespan: 220,
      speedY: range(-70, -30),
      speedX: range(-40, 40),
      gravityY: 400,
      scale: ramp(0.6, 0.2),
      alpha: ramp(0.6, 0),
      tint: 0xbbbbbb,
    });
    this.gf = fx('px', 61, { lifespan: 500, speed: range(20, 120), tint: [0xff1a1a, 0xffffff, 0], scaleX: range(1, 5), scaleY: 0.5 });
  }

  be() {
    const physics = this.physics.add;
    this.sh = physics.group();
    this.bc = physics.group({ allowGravity: false });
    this.pc = physics.group();
    this.cg = physics.staticGroup();
    this.sg = physics.staticGroup();
    this.vg = physics.staticGroup();
    this.vl = [];
    this.sx = [];

    for (const { type, x, y, a, b } of this.ln.ents) {
      const px = x * T + 8;
      const py = y * T;
      const prop = PROPS[type];
      let s = prop && image(this, px, py + prop[2], type, prop[1], type === 'vault' ? 0 : 0.5, prop[0]);
      switch (type) {
        case 'shrine':
          this.sx.push((s = image(this, px, py, 'shrine', 2, 0.5, 1)));
          if (a) this.ls((this.ch = s), true);
          break;
        case 'tree':
          s.setFlipX(!!a);
          break;
        case 'candle':
          this.af(px, py - 10, 34);
          break;
        case 'candelabra':
          this.af(px - 8, py - 30);
          this.af(px, py - 29);
          this.af(px + 8, py - 30);
          this.al(px, py - 28, 70);
          break;
        case 'pillar':
          this.add.tileSprite(px, py, 20, 22 * T, 'pillar').setOrigin(0.5, 0).setDepth(-8);
          break;
        case 'vault':
          s.setDisplaySize(9 * T, 48);
          break;
        case 'bell':
          this.ba = s;
          this.add.rectangle(px, py - 4, 60, 6, 0x1a1a1a).setDepth(-2);
          this.bz = new Phaser.Geom.Rectangle(px - 56, py, 112, 7 * T);
          this.al(px, py + 30, 50, false);
          break;
        case 'cracked': {
          const c = this.cg.create(px, py + 8, 'cracked');
          c.tx = x;
          c.ty = y;
          this.cr.set(x + ',' + y, c);
          break;
        }
        case 'spikes':
          this.sg.create(px, py - 8, 'spikes').ad = a;
          break;
        case 'veil': {
          const v = this.add.tileSprite(px - 8, py, a * T, b * T, 'veil').setOrigin(0).setDepth(3);
          this.vg.add(v);
          v.sn = 1;
          v.rc = new Phaser.Geom.Rectangle(px - 8, py, a * T, b * T);
          this.vl.push(v);
          break;
        }
        case 'tool':
          this.sp(a, px, py - 10, 0, 0);
          break;
        case 'shade':
          this.sm(this.sh, px, py, 'shade', 'eyes', 3, 10, 28, 3, 4).setOrigin(0.5, 1).dr = random() < 0.5 ? -1 : 1;
          break;
        case 'bat': {
          const m = this.sm(this.bc, px, py + 8, 'bat', 'eyes_small', 1, 12, 6, 2, 1);
          m.hm = { x: px, y: py + 8 };
          m.md = 'hover';
          m.t = random() * 10;
          m.mu = 0;
        }
      }
    }
    for (const s of this.sg.getChildren()) s.body.setSize(14, 8).setOffset(1, 8);

    physics.collider(this.sh, this.ly);
    physics.collider(this.sh, this.cg);
    physics.collider(this.sh, this.vg);
    physics.collider(this.pc, this.ly);
    physics.collider(this.pc, this.cg);
  }

  // A static light source; `glow` adds a faint additive halo under the darkness.
  al(x, y, r, flicker = true, glow = true) {
    const l = { x, y, r };
    l.fl = flicker;
    if (glow) l.gw = image(this, x, y, 'light', 45).setBlendMode(1).setScale((r * 1.1) / 64).setAlpha(0.07);
    this.lh.push(l);
    return l;
  }

  af(x, y, r) {
    this.add.sprite(x, y, 'flame').setOrigin(0.5, 1).setDepth(60).play({ key: 'flame', startFrame: between(0, 1) });
    if (r) this.al(x, y, r);
  }

  ls(shrine, silent) {
    shrine.li = true;
    shrine.setTexture('shrine_lit');
    for (const dx of [-5, 1, 7]) this.af(shrine.x + dx - 0.5, shrine.y - 17 + (dx === 1 ? -2 : 0));
    this.al(shrine.x, shrine.y - 16, 80);
    if (!silent) {
      sound('checkpoint');
      this.ms('Las velas te recuerdan.');
    }
  }

  // Shades are `tall`: their middle is well above their feet.
  sm(group, x, y, key, eyes, hp, w, h, ox, oy) {
    const m = group.create(x, y, key, 0).setDepth(12);
    m.body.setSize(w, h).setOffset(ox, oy);
    m.tl = hp > 1;
    m.hp = hp;
    m.su = m.br = 0;
    m.cs = false;
    m.ey = image(this, x, y, eyes, 60);
    return m.play(m.tl ? 'shade-walk' : 'bat-fly');
  }

  sp(tool, x, y, vx, vy, expires) {
    const p = this.pc.create(x, y, 'tool_' + tool).setDepth(14).setBounce(0.35).setDragX(160).setVelocity(vx, vy).setScale(1.7);
    p.body.setSize(16, 16);
    p.tc = tool;
    p.ex = expires;
    p.pa = this.time.now + (expires ? 500 : 0);
    // Warm additive halo plus a sprite glow so tools pop out of the dark.
    p.gw = image(this, x, y, 'light', 45).setBlendMode(1).setScale(0.8).setAlpha(0.22).setTint(0xffe066);
    if (p.preFX) p.preFX.addGlow(0xffe066, 3, 0, false, 0.08, 18);
    p.once('destroy', () => p.gw.destroy());
  }

  bp() {
    const physics = this.physics.add;
    const p = (this.pl = physics.sprite(5.5 * T, 26 * T, 'child', 0));
    p.setOrigin(0.5, 1).setDepth(10).setCollideWorldBounds(true);
    p.body.setSize(10, 20).setOffset(3, 4).setMaxVelocityY(620);

    this.hl = image(this, 0, 0, 'tool_flashlight', 11);
    this.uo = image(this, 0, 0, 'umbrella_open', 11).setVisible(false);
    this.rt = image(this, 0, 0, 'reticle', 62).setVisible(false);

    // The beam row being dropped through stops holding the child up.
    physics.collider(p, this.ly, null, (_, t) => t.index !== TILE_BEAM || t.y !== this.dp);
    physics.collider(p, this.cg);
    physics.collider(p, this.vg);
    const touch = (_, m) => m.dy || !m.active || this.ht(m.x);
    physics.overlap(p, this.sh, touch);
    physics.overlap(p, this.bc, touch);
    physics.overlap(p, this.sg, (_, s) => this.op(s));
    physics.overlap(p, this.pc, (_, item) => this.ce(item));
  }

  bd() {
    this.dk = this.add.renderTexture(0, 0, SCREEN_W, SCREEN_H).setOrigin(0).setScrollFactor(0).setDepth(50);
    // Additive glow under the darkness so light visibly lights the rain and stone.
    this.cn = image(this, 0, 0, 'cone', 45, 0, 0.5).setBlendMode(1).setVisible(false);
    this.ag = image(this, 0, 0, 'light', 45).setBlendMode(1).setAlpha(0.05).setScale(0.8);
    this.ds = this.add.graphics().setDepth(61);
  }

  mn() {
    return [...this.sh.getChildren(), ...this.bc.getChildren()];
  }

  ta(px, py) {
    const tx = floor(px / T);
    const ty = floor(py / T);
    return tx < 0 || ty < 0 || tx >= W || ty >= H || this.cr.has(tx + ',' + ty) ? SOLID : this.ln.grid[ty][tx];
  }

  // Solid ground or a beam: something to stand on.
  fa(px, py) {
    return this.ta(px, py) > EMPTY;
  }

  lo(x0, y0, x1, y1) {
    const n = ceil(hypot(x1 - x0, y1 - y0) / 8);
    for (let i = 1; i < n; i++) {
      if (this.ta(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n) === SOLID) return false;
    }
    return true;
  }

  gb(x, y) {
    for (let ty = floor(y / T); ty < H; ty++) if (this.fa(x, ty * T + 1)) return ty * T;
    return null;
  }

  ms(text, ms) {
    this.hd.sq(text, ms);
  }

  hn(id, text, ms) {
    if (this.hs.has(id)) return;
    this.hs.add(id);
    this.ms(text, ms);
  }

  // Camera shake, with a glitch burst when `glitch` is given.
  jl(ms, amount, glitch) {
    this.cm.shake(ms, amount);
    if (glitch) this.gl.hi(glitch);
  }

  bl(x, y, n, decals = 2) {
    this.bf.emitParticleAt(x, y, n);
    for (let i = 0; i < decals; i++) {
      const dx = x + between(-18, 18);
      const gy = this.gb(dx, y);
      if (gy === null || gy - y > 120) continue;
      this.dc.push(image(this, dx, gy, 'splat' + between(0, 2), 4, 0.5, 1).setFlipX(random() < 0.5));
      if (this.dc.length > 80) this.dc.shift().destroy();
    }
  }

  ct(dir) {
    const owned = TOOLS.filter((t) => this.iv.has(t));
    const tool = owned[(owned.indexOf(this.eq) + dir + owned.length) % owned.length];
    if (!tool || tool === this.eq) return;
    this.eq = tool;
    sound('poke');
    this.hd.ps();
  }

  ce(item) {
    if (this.dd || this.time.now < item.pa) return;
    const tool = item.tc;
    const first = !this.fn.has(tool);
    this.fn.add(tool);
    this.iv.add(tool);
    this.eq = tool;
    this.hd.ps();
    item.destroy();
    if (first) {
      sound('newtool');
      this.gl.hi(0.4);
      if (tool === 'crowbar') this.ms('PATA DE CABRA - pulsa BOTON 2 para golpear. La piedra agrietada cede.', 5000);
      if (tool === 'umbrella') this.ms('PARAGUAS - manten BOTON 1 al caer para planear.', 5000);
      if (tool === 'revolver') this.hr = MAX_HEARTS;
    } else {
      sound('pickup');
      this.ms(`Recuperaste: ${TOOL_NAMES[tool]}.`, 1800);
    }
  }

  dt(dir) {
    const tool = this.eq;
    const text = `¡Soltaste: ${TOOL_NAMES[tool]}!`;
    this.iv.delete(tool);
    this.eq = null;
    this.sp(tool, this.pl.x, this.pl.y - 14, -dir * between(40, 90), -220, this.time.now + DROP_TIME);
    sound('drop');
    this.hd.ps();
    if (this.hs.has('drop')) this.ms(text, 1500);
    else this.hn('drop', text + ' Recogela antes de que la oscuridad se la lleve.', 3500);
  }

  // A dropped tool that timed out crawls back to the last lit shrine.
  rl(item) {
    this.gf.emitParticleAt(item.x, item.y, 24);
    sound('lost');
    this.gl.hi(0.3);
    item.setPosition(this.ch.x + 16, this.ch.y - 10).setVelocity(0, 0).setAlpha(1);
    item.ex = null;
    this.ms(`La oscuridad se llevo: ${TOOL_NAMES[item.tc]}... te espera junto a las velas.`, 3500);
  }

  ul(dt, time) {
    const p = this.pl;
    const tool = this.eq;
    const f = this.fc;
    const ax = this.ax;
    const ay = this.ay;
    const angle = this.aa;
    const useDown = tap(B_USE);
    this.ac -= dt;
    this.fs = false;
    this.co = null;

    this.uo.setVisible(this.gd).setPosition(p.x, p.y - 30);
    this.hl.setVisible(!!tool && !this.gd && !this.dd);
    if (!tool) return;

    const swingT = max(0, (this.sw - time) / 180);
    // Starts an attack if the button was pressed and the last one has finished.
    const attack = (cooldown, sfxName) => {
      if (!useDown || this.ac > 0) return false;
      this.ac = cooldown;
      this.sw = time + 180;
      sound(sfxName);
      return true;
    };
    let [reach, height, scale] = TOOL_HOLD[tool];
    let tilt = 0; // extra rotation while swinging

    if (tool === 'flashlight') {
      const focus = (this.fs = down(B_USE));
      if (random() < 0.008) this.fl = 0;
      this.fl = min(1, this.fl + dt * 6);
      if (this.fl > 0.5 && !this.dd) {
        this.co = { x: p.x + ax * 12, y: p.y - 11 + ay * 12, angle, range: focus ? 270 : 190, half: focus ? 0.2 : 0.4, power: focus ? 2.4 : 1 };
        this.s0(this.co, dt);
      }
    } else if (tool === 'crowbar') {
      tilt = swingT ? 3.1 * swingT - 1.2 : 0.5;
      if (attack(0.38, 'swing')) this.sr(this.ab(30, 46), 2, 220, true);
    } else if (tool === 'revolver') {
      tilt = -0.6 * swingT;
      if (attack(0.45, 'shot')) {
        this.jl(70, 0.006);
        const x0 = p.x + ax * 14;
        const y0 = p.y - 12 + ay * 14;
        const shot = new Phaser.Geom.Line(x0, y0, x0 + cos(angle) * 420, y0 + sin(angle) * 420);
        const tracer = this.add.graphics().setDepth(61).lineStyle(1, 0xffffff, 0.9).strokeLineShape(shot);
        later(this, 50, () => tracer.destroy());
        const b = this.bs;
        if (b && !b.dy && Phaser.Geom.Intersects.LineToRectangle(shot, b.getBounds())) this.hb(sign(b.x - p.x));
      }
    } else {
      reach += 8 * swingT;
      tilt = 1.57;
      if (attack(0.4, 'poke')) this.sr(this.ab(26, 16), 1, 320);
    }
    this.hl
      .setTexture('tool_' + tool)
      .setFlipX(!this.am && f < 0)
      .setPosition(p.x + ax * reach, p.y - height + ay * reach)
      .setScale(scale)
      .setRotation(this.am ? angle + tilt : f * tilt);
  }

  // Axis-aligned hitbox extending from the player along the current aim vector.
  // `len` runs along the aim, `wide` across it; 8-way aim keeps it corner-correct.
  ab(len, wide) {
    const ax = this.ax;
    const ay = this.ay;
    const along = 2 + len / 2;
    const w = abs(ax) * len + abs(ay) * wide;
    const h = abs(ay) * len + abs(ax) * wide;
    return new Phaser.Geom.Rectangle(this.pl.x + ax * along - w / 2, this.pl.y - 12 + ay * along - h / 2, w, h);
  }

  // Melee hit on everything inside `box`.
  sr(box, dmg, knock, breaks) {
    const hits = (o) => Phaser.Geom.Intersects.RectangleToRectangle(box, o.getBounds());
    let hitSomething = false;
    for (const m of this.mn()) {
      if (m.active && !m.dy && hits(m)) {
        this.dm(m, dmg, (this.ax || this.fc) * knock);
        hitSomething = true;
      }
    }

    let clang = false;
    for (const c of [...this.cr.values()]) {
      if (hits(c)) {
        if (breaks) this.cl(c.tx, c.ty);
        else clang = true;
      }
    }
    if (clang) sound('clang');
    if (hitSomething) this.jl(80, 0.004);
  }

  // Break a cracked block and, a beat later, everything cracked touching it.
  cl(tx, ty) {
    const key = tx + ',' + ty;
    const c = this.cr.get(key);
    if (!c) return;
    this.cr.delete(key);
    this.df.emitParticleAt(c.x, c.y, 8);
    c.destroy();
    if (!this.cb) {
      this.cb = true;
      sound('crumble');
      this.jl(250, 0.008, 0.3);
      later(this, 300, () => (this.cb = false));
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) later(this, 60, () => this.cl(tx + dx, ty + dy));
  }

  ic(cone, x, y) {
    const dx = x - cone.x;
    const dy = y - cone.y;
    return (
      hypot(dx, dy) <= cone.range &&
      abs(Phaser.Math.Angle.Wrap(atan2(dy, dx) - cone.angle)) < cone.half &&
      this.lo(cone.x, cone.y, x, y)
    );
  }

  s0(cone, dt) {
    const now = this.time.now;
    for (const m of this.mn()) {
      const cy = m.y - (m.tl ? 18 : 0);
      if (!m.active || m.dy || !this.ic(cone, m.x, cy)) continue;
      m.br = 0.15;
      m.hp -= dt * cone.power * (m.tl ? 1.1 : 2.5);
      if (random() < 0.3) this.s3.emitParticleAt(m.x, cy, 1);
      if (random() < 0.15) this.ef.emitParticleAt(m.x, cy, 1);
      if (!m.sd || now > m.sd) {
        m.sd = now + 900;
        sound(m.tl ? 'burn' : 'screech');
      }
      if (m.hp <= 0) this.kl(m);
    }

    for (const v of this.vl) {
      if (v.sn <= 0) continue;
      let lit = false;
      for (const off of [-0.6, -0.3, 0, 0.3, 0.6]) {
        const a = cone.angle + off * cone.half;
        for (let d = 8; d < cone.range && !lit; d += 8) {
          const x = cone.x + cos(a) * d;
          const y = cone.y + sin(a) * d;
          if (v.rc.contains(x, y)) lit = true;
          else if (this.ta(x, y) === SOLID) break;
        }
      }
      if (!lit) continue;
      v.sn -= dt * (this.fs ? 0.9 : 0.35);
      v.ht = 0.2;
      if (random() < 0.2) this.gf.emitParticleAt(v.rc.centerX, between(v.rc.top, v.rc.bottom), 1);
      if (random() < 0.05) sound('burn');
      if (v.sn <= 0) this.dv(v);
      else this.hn('veil-focus', 'Retrocede ante la luz... manten BOTON 2 para enfocar el haz.');
    }
  }

  dv(v) {
    sound('veil');
    this.gl.hi(0.6);
    for (let i = 0; i < 40; i++) this.gf.emitParticleAt(between(v.rc.left, v.rc.right), between(v.rc.top, v.rc.bottom), 1);
    this.vl = this.vl.filter((o) => o !== v);
    v.body.enable = false;
    this.tweens.add({ targets: v, alpha: 0, scaleX: 0.2, duration: 400, onComplete: () => v.destroy() });
  }

  // Red flash on a monster that was just hit.
  fr(m) {
    m.setTint(0xff4444);
    later(this, 120, () => m.active && m.clearTint());
  }

  dm(m, dmg, knockX) {
    m.hp -= dmg;
    this.bl(m.x, m.y - (m.tl ? 18 : 0), 14, 1);
    sound('flesh');
    this.fr(m);
    if (m.tl) m.su = this.time.now + 350;
    m.setVelocity(knockX, m.tl ? -140 : -60);
    if (m.hp <= 0) this.kl(m);
  }

  kl(m) {
    if (m.dy) return;
    m.dy = true;
    m.body.enable = false;
    this.bl(m.x, m.y - (m.tl ? 16 : 0), m.tl ? 45 : 20, m.tl ? 4 : 2);
    sound('die');
    this.jl(120, 0.006, 0.3);
    this.tweens.add({ targets: m.ey, alpha: 0, y: m.ey.y + 12, duration: 900, onComplete: () => m.ey.destroy() });
    this.tweens.add({ targets: m, alpha: 0, scaleY: m.tl ? 0.1 : 1, angle: m.tl ? 0 : 180, duration: 500, onComplete: () => m.destroy() });
  }

  op(s) {
    if (this.dd) return;
    this.ht(this.pl.x + (random() - 0.5));
    if (s.ad) {
      if (!this.dd && !this.fg) {
        this.fg = true;
        later(this, 350, () => {
          this.fg = false;
          if (!this.dd) this.ra();
        });
      }
    } else if (this.pl.body.velocity.y >= 0) {
      this.pl.setVelocityY(-340);
    }
  }

  us(s, dt, time) {
    const p = this.pl;
    const dx = p.x - s.x;
    const sees = !this.dd && abs(dx) < 170 && abs(p.y - s.y) < 50 && this.lo(s.x, s.y - 26, p.x, p.y - 12);

    if (sees && !s.cs) sound('moan');
    s.cs = sees;
    if (!sees && !s.dr) s.dr = s.flipX ? -1 : 1;

    // While stunned it is knocked back; let physics carry it.
    if (time >= s.su && s.body.blocked.down) {
      if (sees) s.dr = sign(dx) || s.dr;
      // Turn at walls and ledges (unless chasing straight at the player on the same level).
      if ((s.dr > 0 ? s.body.blocked.right : s.body.blocked.left) || !this.fa(s.x + s.dr * 8, s.y + 2)) s.dr = sees ? 0 : -s.dr;
      s.setVelocityX(s.dr * (sees ? 64 : 26) * (s.br > 0 ? 0.2 : 1));
    }
    if (s.dr) s.setFlipX(s.dr < 0);
    s.anims.timeScale = sees ? 2.5 : 1;

    const burning = s.br > 0;
    s.ey.setPosition(s.x + (s.flipX ? -1 : 1) + (burning ? between(-1, 1) : 0), s.y - 27.5).setAlpha(burning ? 0.4 + random() * 0.6 : 1);
    s.setAlpha(burning ? 0.6 + random() * 0.4 : 1);
  }

  ua(b, dt, time) {
    b.t += dt;
    const px = this.pl.x;
    const py = this.pl.y - 12;
    const dist = Phaser.Math.Distance.Between;
    // Fly towards (or with a negative speed, away from) a point.
    const fly = (x, y, speed) => {
      const a = atan2(y - b.y, x - b.x);
      b.setVelocity(cos(a) * speed, sin(a) * speed);
    };
    const go = (mode, ms) => {
      b.md = mode;
      b.mu = time + ms;
    };

    if (b.br > 0) {
      go('return', 1200);
      fly(px, py, -120);
    } else if (b.md === 'hover') {
      b.setVelocity((b.hm.x + sin(b.t * 1.3) * 34 - b.x) * 3, (b.hm.y + sin(b.t * 2.7) * 10 - b.y) * 3);
      if (!this.dd && dist(b.x, b.y, px, py) < 150 && time > b.mu && this.lo(b.x, b.y, px, py)) {
        go('dive', 900);
        fly(px, py, 165);
        sound('screech');
      }
    } else if (b.md === 'dive') {
      if (time > b.mu) go('return', 1500);
    } else {
      fly(b.hm.x, b.hm.y, 90);
      if (dist(b.x, b.y, b.hm.x, b.hm.y) < 10 || time > b.mu) go('hover', 1500);
    }
    b.setFlipX(b.body.velocity.x < 0);
    b.ey.setPosition(b.x, b.y + 1.5);
  }

  // Returns false if the hit was ignored.
  ht(srcX) {
    const time = this.time.now;
    if (this.dd || this.wn || this.cu || time < this.iu) return false;
    const p = this.pl;
    this.iu = time + 1400;
    this.su = time + 260;
    const dir = sign(p.x - srcX) || -this.fc;
    p.setVelocity(dir * 170, -230);
    this.bl(p.x, p.y - 12, 22);
    sound('hurt');
    this.jl(160, 0.012, 0.7);
    this.hd.ps();

    // El Silbon goes straight for the heart; lesser things only knock the tool away.
    if (this.eq && !this.bs) this.dt(dir);
    else if (--this.hr <= 0) this.di();
    else if (this.bs && this.hr === 1 && !this.fn.has('revolver') && !this.th) this.tr();
    return true;
  }

  di() {
    this.dd = true;
    const p = this.pl;
    this.bl(p.x, p.y - 12, 60, 5);
    p.setVisible(false);
    p.body.enable = false;
    sound('death');
    this.jl(400, 0.02, 1.2);
    this.hd.bi('TE ENCONTRARON');
    later(this, 2200, () => {
      this.hd.bi('');
      this.hr = MAX_HEARTS;
      this.dd = false;
      p.setVisible(true);
      p.body.enable = true;
      if (this.bs) this.la();
      this.ra();
    });
  }

  ra() {
    this.pl.setPosition(this.ch.x - 14, this.ch.y - 1).setVelocity(0, 0);
    this.iu = this.time.now + 1500;
    this.gl.hi(0.6);
    sound('glitch');
    this.hd.ps();
  }

  ut(dt, time) {
    const p = this.pl;
    const body = p.body;
    if (this.dd || this.wn || this.cu) {
      if (!this.dd) p.setVelocityX(0);
      this.am = false;
      this.rt.setVisible(false);
      clearTaps();
      return;
    }

    const grounded = body.blocked.down;

    // Free aim / focus: hold BUTTON 2 and steer with the stick. The stick drives the
    // reticle instead of movement, so the child plants their feet while aiming.
    const hx = (down(B_RIGHT) ? 1 : 0) - (down(B_LEFT) ? 1 : 0);
    const vy = (down(B_DOWN) ? 1 : 0) - (down(B_UP) ? 1 : 0);
    const aiming = (this.am = down(B_USE));
    if (aiming) {
      if (hx || vy) {
        const q = (round(atan2(vy, hx) / (PI / 4)) * PI) / 4;
        this.aa = q;
        this.ax = round(cos(q));
        this.ay = round(sin(q));
        if (this.ax) this.fc = this.ax;
      }
    } else {
      this.aa = this.fc > 0 ? 0 : PI;
      this.ax = this.fc;
      this.ay = 0;
    }

    if (grounded) {
      if (!this.wg && this.lt > 220) sound('land');
      this.lg = time;
    }
    this.wg = grounded;
    this.lt = body.velocity.y;

    if (time > this.su) {
      const dir = aiming ? 0 : hx;
      p.setVelocityX(dir * RUN);
      if (dir) this.fc = dir;
    }

    if (tap(B_JUMP)) this.jp = time;
    if (time - this.jp < 120 && time - this.lg < 110) {
      p.setVelocityY(-JUMP);
      this.jp = this.lg = NEVER;
      sound('jump');
    }
    if (untap(B_JUMP) && body.velocity.y < 0) p.setVelocityY(body.velocity.y * 0.45);

    // Double-tap down to drop through a wooden beam.
    if (tap(B_DOWN) && !aiming) {
      const under = body.bottom + 1;
      if (time - this.da < 300 && grounded && (this.ta(body.x, under) === BEAM || this.ta(body.right - 1, under) === BEAM)) {
        this.dp = floor(under / T);
        this.du = time + 600;
        this.da = this.lg = NEVER;
        p.setVelocityY(60);
      } else this.da = time;
    }
    if (body.y > this.dp * T || time > this.du) this.dp = -1;

    this.gd = this.eq === 'umbrella' && !grounded && down(B_JUMP) && body.velocity.y > 0;
    if (this.gd) p.setVelocityY(min(body.velocity.y, GLIDE_FALL));

    if (tap(B_PREV)) this.ct(-1);
    if (tap(B_NEXT)) this.ct(1);
    if (tap(B_MUTE)) master.gain.value = master.gain.value ? 0 : 0.9;

    p.setFlipX(this.fc < 0);
    const running = grounded && abs(body.velocity.x) > 5;
    p.play(grounded ? (running ? 'child-run' : 'child-idle') : 'child-jump', true);
    if (running && (this.se -= dt) <= 0) {
      this.se = 0.28;
      sound('step');
    }

    p.setAlpha(time < this.iu && floor(time / 70) % 2 ? 0.3 : 1);

    for (const s of this.sx) {
      if (abs(p.x - s.x) < 18 && abs(p.y - s.y) < 24) {
        if (!s.li) this.ls(s);
        this.ch = s;
        this.hr = MAX_HEARTS;
      }
    }

    // Is the child inside this box (in tiles)?
    const tx = p.x / T;
    const ty = p.y / T;
    const at = (x0, x1, y0, y1) => tx > x0 && tx < x1 && ty > y0 && ty < y1;
    if (at(27, 34, 0, H)) this.hn('veil', 'Un velo de sombra viva. Alumbralo con la linterna.');
    if (at(84, 90, 0, 12) && !this.fn.has('umbrella')) this.hn('chasm', 'Muy lejos para saltar... si tan solo algo frenara la caida.', 4000);
    if (this.fn.has('crowbar') && at(40, 48, 20, 27) && this.cr.has('45,26')) this.hn('floor', 'El piso aqui esta agrietado...');
    if (at(110, 130, 0, 9)) this.hn('bell', 'La gran campana. Hazla sonar.');
    if (aiming) this.hn('freeaim', 'APUNTADO LIBRE - manten BOTON 2 y apunta con el joystick.', 3000);

    // Free-aim reticle.
    this.rt
      .setVisible(aiming)
      .setPosition(p.x + cos(this.aa) * 42, p.y - 12 + sin(this.aa) * 42)
      .setRotation(this.aa)
      .setAlpha(0.55 + 0.35 * sin(time / 110));

    if (!this.bs && this.bz.contains(p.x, p.y - 10)) this.sv();
  }

  up(time) {
    const bars = this.ds.clear();
    for (const item of [...this.pc.getChildren()]) {
      const left = item.ex - time;
      const urgent = left < 2000;
      if (item.gw) {
        const flash = urgent && floor(time / 80) % 2;
        item.gw.setPosition(item.x, item.y).setScale(0.78 + 0.05 * sin(time / 240 + item.y * 0.11)).setAlpha((0.22 + 0.1 * sin(time / 190 + item.x * 0.13)) * (urgent ? (flash ? 0.5 : 1) : 1));
      }
      if (!item.ex) item.setAlpha(1);
      else if (left <= 0) this.rl(item);
      else {
        item.setAlpha(urgent && floor(time / 80) % 2 ? 0.25 : 1);
        bars.fillStyle(0, 0.8).fillRect(item.x - 11, item.y - 16, 22, 4);
        bars.fillStyle(urgent ? 0xff1a1a : 0xffffff, 1).fillRect(item.x - 10, item.y - 15, 20 * (left / DROP_TIME), 2);
      }
    }
  }

  ur() {
    const cam = this.cm;
    for (let i = 0; i < 4; i++) {
      const x = cam.scrollX + random() * SCREEN_W;
      const top = max(0, floor(cam.scrollY / T));
      for (let ty = top; ty < min(H, top + 31); ty++) {
        if (this.fa(x, ty * T + 1)) {
          this.s2.emitParticleAt(x, ty * T, 2);
          break;
        }
      }
    }
  }

  ud(time) {
    const sx = this.cm.scrollX;
    const sy = this.cm.scrollY;
    const dark = this.dk;
    const flash = this.st.lv;
    const light = (x, y, r, alpha = 1) => {
      if (x + r > sx && x - r < sx + SCREEN_W && y + r > sy && y - r < sy + SCREEN_H) dark.stamp('light', null, x - sx, y - sy, { scale: r / 64, alpha, erase: true });
    };

    dark.clear();
    dark.fill(0, max(0.32, BASE_DARK * (this.bs ? 0.6 : 1) * (1 - 0.93 * min(1, flash * 1.4))));

    const p = this.pl;
    if (!this.dd) light(p.x, p.y - 12, 74);
    this.ag.setPosition(p.x, p.y - 12).setVisible(!this.dd);
    for (const l of this.lh) {
      const f = l.fl ? 0.9 + sin(time / 90 + l.x) * 0.05 + random() * 0.05 : 1;
      light(l.x, l.y, l.r * f);
      if (l.gw) l.gw.setAlpha(0.06 * f + flash * 0.05);
    }
    for (const item of this.pc.getChildren()) {
      light(item.x, item.y, 44, 0.5);
      light(item.x, item.y, 27, 1);
    }

    const c = this.co;
    this.cn.setVisible(!!c);
    if (c) {
      // The cone texture is 256px long with a 0.42 rad half-angle; stretch it to fit.
      const scaleX = c.range / 256;
      const scaleY = scaleX * (tan(c.half) / tan(0.42));
      dark.stamp('cone', null, c.x - sx, c.y - sy, { originX: 0, originY: 0.5, scaleX, scaleY, rotation: c.angle, alpha: this.fl, erase: true });
      this.cn
        .setPosition(c.x, c.y)
        .setScale(scaleX, scaleY)
        .setRotation(c.angle)
        .setAlpha((this.fs ? 0.2 : 0.12) * this.fl);
    }
  }

  // He was behind you the whole time. The far-off whistle, the castle coming down, then the ruins.
  sv() {
    const p = this.pl;
    const cam = this.cm;
    this.cu = true;
    stopMusic();
    whistle(0.03, 48, 0.4);
    this.ms('Un silbido lejano, muy lejano... el esta aqui.', 4000);

    const side = p.x > this.ba.x ? -1 : 1;
    const ghost = image(this, p.x + side * 70, 9 * T, 'silbon', 12, 0.5, 1, 0).setFlipX(side > 0).setAlpha(0);
    const eyes = image(this, ghost.x - side * 2, ghost.y - 42.5, 'eyes', 60).setAlpha(0);
    const white = whiteout(this, 200);
    fade(this, [ghost, eyes], 1, 900, 3000);
    later(this, 3000, () => this.gl.hi(0.8));

    later(this, 4600, () => {
      cam.shake(2200, 0.02);
      fade(this, white, 1, 1400, 700);
      for (const d of [0, 500, 1000, 1500]) {
        later(this, d, () => {
          sound('crumble');
          this.st.sr(1);
          for (let i = 0; i < 12; i++) this.df.emitParticleAt(cam.scrollX + random() * SCREEN_W, cam.scrollY + random() * SCREEN_H, 6);
        });
      }
    });

    later(this, 7000, () => {
      ghost.destroy();
      eyes.destroy();
      this.sz();
      fade(this, white, 0, 1200, 0, () => white.destroy());
    });
  }

  // Show or hide the standing castle's skyline and fence the camera to match.
  ss(on) {
    const x0 = on ? ARENA_X * T : 0;
    this.sf.setVisible(!on);
    this.bt.setVisible(!on);
    this.cm.setBounds(x0, 0, (on ? W - 2 : W) * T - x0, H * T);
  }

  // The castle is gone: flat rubble under open sky, and El Silbon.
  sz() {
    const p = this.pl;
    const physics = this.physics.add;
    const x0 = ARENA_X * T;
    const gy = ARENA_Y * T;
    this.ss(true);
    this.bb = this.ba;
    if (!this.rb) {
      for (const [x, h, a] of [[70, 40, -8], [250, 70, 5], [400, 28, 12], [560, 56, -4]]) {
        this.add.tileSprite(x0 + x, gy + 4, 20, h, 'pillar').setOrigin(0.5, 1).setDepth(-8).setAngle(a);
      }
      this.rb = image(this, x0 + 480, gy + 6, 'bell', -6, 0.5, 1);
    }
    this.ba = this.rb;

    this.ch = { x: x0 + 110, y: gy };
    this.hr = MAX_HEARTS;
    this.ra();
    this.fc = 1;

    // Built once; a lost fight hides him and the next visit to the bell brings him back.
    if (!this.sb) {
      const s = (this.sb = physics.sprite(0, 0, 'silbon', 0));
      s.setOrigin(0.5, 1).setDepth(12).setCollideWorldBounds(true).play('silbon-walk');
      s.body.setSize(10, 42).setOffset(7, 14);
      s.ey = image(this, 0, 0, 'eyes', 60);
      this.bn = physics.group();
      physics.collider(s, this.ly);
      physics.collider(this.bn, this.ly, (bone) => bone.destroy());
      physics.overlap(p, s, () => !s.dy && this.ht(s.x));
      physics.overlap(p, this.bn, (_, bone) => this.ht(bone.x) && bone.destroy());
    }
    const b = (this.bs = this.sb);
    b.setPosition(x0 + 520, gy - 1).setVelocity(0, 0);
    this.sa(true);
    b.hp = BOSS_HP;
    b.md = 'walk';
    b.na = this.time.now + 3500;

    this.hd.bi('EL SILBON');
    later(this, 2200, () => this.hd.bi(''));
    later(this, 1800, () => {
      this.cu = false;
      startMusic();
    });
  }

  sa(on) {
    const b = this.sb;
    b.setVisible(on);
    b.ey.setVisible(on);
    b.body.enable = on;
  }

  // He won: the castle stands again and the child wakes a few steps short of the bell.
  la() {
    this.bs = null;
    this.th = false;
    this.sa(false);
    this.bn.clear(true, true);
    for (const i of [...this.pc.getChildren()]) if (i.tc === 'revolver') i.destroy();
    this.iv.delete('revolver');
    this.fn.delete('revolver');
    if (this.eq === 'revolver') this.eq = TOOLS.find((t) => this.iv.has(t)) || null;
    this.ba = this.bb;
    this.ss(false);
    this.ch = { x: 137 * T, y: 9 * T };
    whistle(0.14, 76);
  }

  // Walks you down, then either lunges or scatters bones from his sack.
  ub(time) {
    const b = this.bs;
    if (!b || b.dy) return;
    const dx = this.pl.x - b.x;
    const dir = sign(dx) || 1;
    const rage = b.hp <= BOSS_HP / 2;
    const walk = (ms) => {
      b.md = 'walk';
      b.na = time + ms;
    };
    if (this.cu || this.dd) {
      b.setVelocityX(0);
    } else if (b.md === 'walk') {
      b.setVelocityX(dir * (rage ? 78 : 52)).setFlipX(dir < 0);
      if (time > b.na) {
        b.md = 'tell';
        b.lu = abs(dx) < 150 && random() < 0.6;
        b.un = time + (rage ? 420 : 600);
        b.setVelocityX(0);
        sweep(SINE, 520, b.lu ? 1040 : 780, 0.35, 0.09);
      }
    } else if (time > b.un) {
      if (b.md !== 'tell') walk(rage ? 1100 : 1600);
      else if (b.lu) {
        b.md = 'lunge';
        b.un = time + 520;
        b.setVelocityX(dir * 290);
      } else {
        for (let i = 0; i < (rage ? 4 : 3); i++) {
          this.bn
            .create(b.x, b.y - 40, 'bone')
            .setDepth(13)
            .setScale(1.5)
            .setVelocity((Phaser.Math.Clamp(dx, -300, 300) / 0.8) * (0.6 + i * 0.3), -280 - i * 25)
            .setAngularVelocity(500);
        }
        sound('swing');
        walk(rage ? 1300 : 1900);
      }
    }
    b.anims.timeScale = b.md === 'walk' ? (rage ? 2 : 1) : 0;
    b.ey.setPosition(b.x + (b.flipX ? -2 : 2), b.y - 42.5).setScale(b.md === 'tell' && floor(time / 60) % 2 ? 2 : 1);
  }

  // A campesino steps out of the rubble: everything stops while he speaks and throws the gun.
  tr() {
    this.th = this.cu = true;
    this.bn.clear(true, true);
    const clamp = Phaser.Math.Clamp;
    const x0 = ARENA_X * T;
    const gy = ARENA_Y * T;
    const side = this.pl.x > x0 + 320 ? -1 : 1;
    const x = clamp(this.pl.x + side * 130, x0 + 30, x0 + 610);
    const tx = clamp(x, x0 + 170, x0 + 470);
    const who = image(this, x, gy, 'campesino', 9, 0.5, 1).setScale(2).setFlipX(side > 0).setAlpha(0);
    const lamp = this.al(x, gy - 30, 80, true, false);
    const words = label(this, tx, gy - 76, 'EL SIEMPRE SE APARECE POR AQUI, MUCHACHO').setDepth(62);
    const say = [this.add.rectangle(tx, gy - 76, 328, 16, 0, 0.85).setDepth(61), words];
    this.gl.hi(0.5);
    sound('checkpoint');
    fade(this, who, 1, 300);

    later(this, 1700, () => {
      words.setText('¡TOMA! ¡DISPARALE!');
      sound('swing');
      this.sp('revolver', x - side * 12, gy - 40, -side * 150, -300);
    });
    later(this, 2700, () => {
      this.cu = false;
      this.iu = this.time.now + 2500;
      this.ms('¡Un revolver! Agarralo y dispara con BOTON 2.', 5000);
    });
    fade(this, [who, ...say], 0, 1000, 5000, () => {
      this.lh.splice(this.lh.indexOf(lamp), 1);
      who.destroy();
      say.forEach((o) => o.destroy());
    });
  }

  hb(dir) {
    const b = this.bs;
    b.hp--;
    this.bl(b.x, b.y - 30, 18);
    sound('flesh');
    this.fr(b);
    if (b.md !== 'lunge') b.setVelocity(dir * 120, -90);
    this.hd.ps();
    if (b.hp > 0) return;

    b.dy = true;
    b.body.enable = false;
    b.anims.stop();
    this.bn.clear(true, true);
    this.bl(b.x, b.y - 28, 90, 6);
    sound('die');
    whistleNotes([83, 79, 76, 72, 67, 60, 48], 0, 0.22, 0.3, 0.1, 0.03);
    this.jl(500, 0.015, 1);
    fade(this, [b, b.ey], 0, 1600);
    this.tweens.add({ targets: b, scaleY: 0.1, duration: 1600 });
    later(this, 2400, () => this.wi());
  }

  wi() {
    this.wn = true;
    this.pl.setVelocity(0, 0);
    sound('greatbell');
    this.jl(1200, 0.01, 1);
    this.tweens.add({ targets: this.ba, angle: { from: -14, to: 14 }, duration: 1100, yoyo: true, repeat: 2, ease: 'Sine.inOut' });
    for (const d of [0, 700, 1500, 2300]) later(this, d, () => this.st.sr(1));

    fade(this, whiteout(this, 200), 1, 2200, 2600);
    [
      label(this, SCREEN_W / 2, SCREEN_H / 2 - 22, 'SUENA LA CAMPANA.', 0, 4),
      label(this, SCREEN_W / 2, SCREEN_H / 2 + 18, 'LA LLUVIA TE OLVIDA... POR AHORA', 0x8a0010),
    ].forEach((t, i) => fade(this, t.setScrollFactor(0).setDepth(201).setAlpha(0), 1, 1200, 4800 + i * 1200));
    later(this, 11000, () => {
      this.cm.fadeOut(1500, 0, 0, 0);
      this.cm.once('camerafadeoutcomplete', () => this.scene.start('Title'));
    });
  }

  update(time, delta) {
    const dt = min(delta, 50) / 1000;
    const cam = this.cm;

    this.ut(dt, time);
    this.ul(dt, time);
    // Dread: the picture breaks up as monsters close in, and a little when empty-handed.
    let nearest = Infinity;
    for (const m of this.mn()) {
      if (m.dy) continue;
      m.br = max(0, m.br - dt);
      if (m.tl) this.us(m, dt, time);
      else this.ua(m, dt, time);
      nearest = min(nearest, Phaser.Math.Distance.Between(m.x, m.y, this.pl.x, this.pl.y));
    }
    this.gl.bj = 0.04 + max(0, 1 - nearest / 140) * 0.14 + (this.eq ? 0 : 0.03);
    this.ub(time);
    for (const v of this.vl) {
      v.tilePositionY -= dt * 20;
      v.tilePositionX = sin(time / 300) * 3;
      v.ht = max(0, (v.ht || 0) - dt);
      v.setAlpha(0.35 + 0.65 * v.sn * (v.ht > 0 ? 0.6 + random() * 0.4 : 1));
    }
    this.up(time);
    this.ur();
    this.st.update(dt);
    // Parallax.
    this.sf.tilePositionX = cam.scrollX * 0.1;
    this.sf.y = 10 - cam.scrollY * 0.06;
    this.bt.tilePositionX = cam.scrollX * 0.25;
    this.bt.y = 21 - cam.scrollY * 0.15;
    this.gl.tk(dt);
    this.ud(time);

    // HUD text shivers with the glitch.
    if (this.hd.ma) {
      const amount = this.gl.an;
      this.hd.ma.x = SCREEN_W / 2 + (random() < amount ? between(-4, 4) : 0);
      this.hd.bg.x = SCREEN_W / 2 + between(-6, 6) * amount;
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
    const hearts = (n, x) => Array.from({ length: n }, (_, i) => this.add.image(x + i * 18, 14, 'heart', 0).setScale(2));
    const slotX = (i) => SCREEN_W - 114 + i * 28;
    this.hc = hearts(MAX_HEARTS, 14);
    this.bh = hearts(BOSS_HP, SCREEN_W / 2 - 63);
    this.sy = this.add.graphics();
    this.si = TOOLS.map((t, i) => this.add.image(slotX(i), 16, 'tool_' + t));
    this.sl = TOOLS.map((_, i) => label(this, slotX(i), 16, '?', 0x8a8a8a));
    this.tb = label(this, SCREEN_W - 12, 34, '').setOrigin(1, 0);
    this.pn = this.add.container(0, 0, [...this.hc, this.sy, ...this.si, ...this.sl, ...this.bh, this.tb]);
    this.mb = this.add.rectangle(0, SCREEN_H - 32, SCREEN_W, 20, 0, 0.8).setOrigin(0).setAlpha(0);
    this.ma = label(this, SCREEN_W / 2, SCREEN_H - 22, '').setAlpha(0);
    this.bg = label(this, SCREEN_W / 2, SCREEN_H / 2, '', 0xff1a1a, 4);
    this.ps();
  }

  ps() {
    this.ha = this.time.now + HUD_LINGER;
  }

  sq(text, ms = 3500) {
    const both = [this.ma.setText(text.toUpperCase()).setAlpha(1), this.mb.setAlpha(1)];
    this.tweens.killTweensOf(both);
    fade(this, both, 0, 600, ms);
  }

  bi(text) {
    this.bg.setText(text);
  }

  update(time, delta) {
    const g = this.scene.get('Game');
    if (!g.pl) return;

    const gr = this.sy.clear();
    const dropped = g.pc.getChildren().filter((i) => i.ex).map((i) => i.tc);
    const b = g.bs && !g.bs.dy && g.bs;
    if (b) this.ps();
    this.hc.forEach((h, i) => h.setFrame(i < g.hr ? 0 : 1));
    this.bh.forEach((h, i) => h.setVisible(!!b).setFrame(b && i < b.hp ? 0 : 1));
    TOOLS.forEach((t, i) => {
      const x = SCREEN_W - 126 + i * 28;
      const eq = g.eq === t;
      const known = g.fn.has(t);
      // The revolver's slot stays hidden until it is thrown to you.
      const shown = i < 3 || known;
      this.sl[i].setVisible(shown && !known);
      this.si[i].setVisible(known).setAlpha(g.iv.has(t) ? 1 : dropped.includes(t) && !(floor(time / 150) % 2) ? 0.65 : 0.3);
      if (shown) gr.fillStyle(0x0a0d12, 0.92).fillRect(x, 4, 24, 24).lineStyle(eq ? 2 : 1, eq ? 0xff2a2a : 0xc8d0d8, 1).strokeRect(x, 4, 24, 24);
    });
    this.tb.setText(g.eq ? TOOL_NAMES[g.eq] : 'MANOS VACIAS').setTint(g.eq ? 0xffffff : 0xff3b3b);

    // Fade the panel out once the linger window lapses.
    this.pn.alpha = Phaser.Math.Linear(this.pn.alpha, time < this.ha ? 1 : 0, min(1, delta / 160));
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game-root',
  width: SCREEN_W,
  height: SCREEN_H,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  pipeline: { Glitch: GlitchPipeline },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 900 } },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, TitleScene, GameScene, HudScene],
});
})();
