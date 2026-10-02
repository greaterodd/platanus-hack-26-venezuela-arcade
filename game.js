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
const { Rectangle, Intersects, Line } = Phaser.Geom;
const clamp = (v, lo, hi) => max(lo, min(hi, v));

// Letters match in either case.
const keyName = (k) => (k.length === 1 ? k.toLowerCase() : k);
const KEY_TO_ARCADE = {};
for (const [code, keys] of Object.entries(CABINET_KEYS)) {
  for (const key of keys) KEY_TO_ARCADE[keyName(key)] = code;
}

// held[code]: button is down. Presses/releases are latched until consumed, so taps
// shorter than a frame still register.
const held = {};
let pressed = {};
let released = {};
let anyPress = null;

const arcadeCode = (e) => KEY_TO_ARCADE[keyName(e.key)];
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
const B_JUMP = 'P1_2';
const B_USE = 'P1_1';
const B_DASH = 'P1_3';
const B_PREV = 'P1_5';
const B_NEXT = 'P1_6';

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
let ac, master, music, sfx, amb, white, brown, musicStep, musicAt, musicTimer, rainGain;

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

  // Rain: a hiss plus a low rumble, looping for good. Kept low so it reads as
  // background ambience rather than a foreground layer.
  const hiss = noise(white, true);
  const hg = gain(0.06);
  chain(hiss, filter('high', 900), filter('low', 7000), hg, amb);
  hiss.start();
  const body = noise(brown, true);
  const bg = gain(0.08);
  chain(body, bg, amb);
  body.start();
  rainGain = [hg, bg];
}

// The storm is muffled underground and inside the church.
function setRainVolume(scale) {
  if (!rainGain) return;
  rainGain[0].gain.value = 0.06 * scale;
  rainGain[1].gain.value = 0.08 * scale;
}

function thunder(delay, power) {
  if (!ac) return;
  const t = now() + delay;

  const src = noise(brown);
  src.playbackRate.value = 0.6 + random() * 0.3;
  const lp = filter('low');
  slide(lp.frequency, 900, t, 90, t + 3.5);
  const g = gain();
  slide(g.gain, 0.0001, t, 2.2 * power, t + 0.08);
  slide(g.gain, 1.7 * power, t + 0.5, 0.0001, t + 4.2);
  chain(src, lp, g, amb);
  run(src, t, t + 4.5);

  // A close strike also cracks.
  if (delay < 0.5) {
    const c = noise(white);
    const hp = filter('high', 1500);
    const cg = gain();
    slide(cg.gain, 0.75 * power, t, 0.0001, t + 0.35);
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

// Sound effects. Each takes the audio time to play at; `sound` plays one, if audio is up.
const sndJump = () => sweep(SQUARE, 220, 440, 0.1, 0.05);
const sndLand = (t) => noiseHit(t, 0.08, 0.15, 200, 600);
const sndStep = (t) => noiseHit(t, 0.04, 0.05, 300, 1200);
const sndSwing = (t) => noiseHit(t, 0.15, 0.25, 500, 3000);
const sndPoke = (t) => noiseHit(t, 0.08, 0.2, 800, 2500);
const sndClang = (t) => blip(1250, t, 0.12, 0.06, 5000, 0.001);
const sndCrumble = (t) => noiseHit(t, 0.6, 0.6, 60, 900);
const sndFlesh = (t) => noiseHit(t, 0.18, 0.4, 120, 900);
const sndHurt = (t) => {
  sweep(SQUARE, 600, 90, 0.35, 0.12);
  noiseHit(t, 0.25, 0.4, 150, 1200);
};
const sndDrop = (t) => sweep(TRIANGLE, 900, 200, 0.25, 0.12);
const sndPickup = (t) => arpeggio([62, 69, 74], t, 0.07, 0.15);
const sndNewTool = (t) => arpeggio([50, 57, 62, 65, 69], t, 0.09, 0.35);
const sndCheckpoint = (t) => bell(midi(74), t, 0.07, 2.5, sfx);
const sndLost = () => {
  sweep(SAW, 400, 40, 0.8, 0.08);
  glitchNoise(0.5);
};
const sndScreech = () => sweep(SAW, 1800, 700, 0.18, 0.05);
const sndMoan = () => sweep(SAW, 110, 70, 0.9, 0.06);
const sndDie = (t) => {
  sweep(SAW, 300, 30, 0.6, 0.12);
  noiseHit(t, 0.4, 0.5, 80, 1500);
};
const sndBurn = (t) => noiseHit(t, 0.1, 0.06, 2000, 6000);
const sndVeil = () => {
  sweep(SINE, 200, 1600, 0.9, 0.08);
  glitchNoise(0.4);
};
const sndDeath = () => {
  sweep(SAW, 220, 20, 1.6, 0.15);
  glitchNoise(1);
};
const sndGlitch = () => glitchNoise(0.2);
const sndShot = (t) => {
  noiseHit(t, 0.25, 0.9, 100, 5000);
  sweep(SQUARE, 300, 50, 0.2, 0.15);
};
const sndGreatBell = (t) => [0.4, 0.3, 0.25].forEach((v, i) => bell(midi(38), t + i * 2.2, v, 9, sfx));

const sound = (fx) => ac && fx(now());

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
for (const e of 'o0c k00 10e 223 338 45a 58c 6c4 sc9 wff b0a f10 i16 l1a m1c n1e p22 q26 t2a u2e x3a z4a A55 B6a C77 D8a E9a Fb0 Hd8 Ie6 Yf2c230 ya8780f hffe07a rff1a1a R7a0008 cc00010 Jd9a520 K8a6410 L8a5a36 M2a1a10 Ne8c21a P6a0008 S8a0010 Tb0000e U5a0008'.split(' ')) {
  PAL[e[0]] = '#' + e.slice(1).padEnd(6, e.slice(1));
}

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
// Fill an SVG path in colour `k`.
const shape = (k, d) => {
  ink(k);
  pen.fill(path(d));
};

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
// The pictures are shipped packed: a run of 3 to 15 equal pixels is one count char
// ('!' is 3, up to '-' for 15) and then the pixel. Each one is drawn out in the
// comment above it; to repack an edited picture:
//   s.replace(/(.)\1{2,14}/g, (run, c) => String.fromCharCode(30 + run.length) + c)
const unpack = (s) => s.replace(/([!-\-])(.)/g, (_, n, c) => c.repeat(n.charCodeAt() - 30));
// `frames` are drawn side by side, `w` apart, and become numbered texture frames.
function sheet(key, frames, w, h) {
  fromCanvas(
    key,
    w * frames.length,
    h,
    () => frames.forEach((rows, i) => unpack(rows).split('\n').forEach((row, y) => [...row].forEach((ch, x) => PAL[ch] && box(ch, i * w + x, y - 1, 1, 1)))),
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

//
// .......oo
// ......oYYo
// .....oYhYYo
// ....oYhYYYYo
// ....oYYYYYYYo
// ...oYYYkkkkYo
// ...oYYkkkkkkYo
// ...oYYkkkkkkYo
// ...oYYYkkkkYYo
// ...oyYYYYYYYYo
// ..oyYYhYYYYYYo
// ..oyYYhYYYYYYYo
// ..oyYYYYyYYYYYo
// .oyYYYYYyYYYYYo
// .oyYYYYYyYYYYYYo
// .oyYYYYYyYYYYYYo
// oyyYYYYYyYYYYYYo
// oyyyyyyyyyyyyyyo
// .oooooooooooooo
const CHILD_BODY = `

%.oo
$.oYYo
#.oYhYYo
".oYh"Yo
".o%Yo
!.o!Y"kYo
!.oYY$kYo
!.oYY$kYo
!.o!Y"kYYo
!.oy&Yo
..oyYYh$Yo
..oyYYh%Yo
..oy"Yy#Yo
.oy#Yy#Yo
.oy#Yy$Yo
.oy#Yy$Yo
oyy#Yy$Yo
o,yo
.,o`;
// idle, run 1-3, jump
const CHILD_LEGS = [
  // .....os..so
  // .....os..so
  // .....os..so
  // ....oss..sso
  `
#.os..so
#.os..so
#.os..so
".oss..sso`,
  // ....os....so
  // ...os......so
  // ...os.......so
  // ..oss.......sso
  `
".os".so
!.os$.so
!.os%.so
..oss%.sso`,
  // .....os.so
  // .....os.so
  // .....os.so
  // ....ossosso
  `
#.os.so
#.os.so
#.os.so
".ossosso`,
  // .....so..os
  // ....so....os
  // ...so.......os
  // ..sso.......oss
  `
#.so..os
".so".os
!.so%.os
..sso%.oss`,
  // ....os....so
  // ...os......so
  `
".os".so
!.os$.so`,
];

//
// ......1111
// .....133331
// ....13333331
// ....1333rr31
// ....13333331
// .....133331
// ......1331
// ....11133111
// ...1333333331
// ..133333333331
// ..13.133331.31
// .13..133331..31
// .13..133331..31
// .13..133331..31
// 13...133331...31
// 13...133331...31
// 3....133331....3
// 3....133331....3
// .....133331
// .....122221
const SHADE_TOP = `

$."1
#.1"31
".1$31
".1!3rr31
".1$31
#.1"31
$.1331
".!133!1
!.1&31
..1(31
..13.1"31.31
.13..1"31..31
.13..1"31..31
.13..1"31..31
13!.1"31!.31
13!.1"31!.31
3".1"31".3
3".1"31".3
#.1"31
#.1"21`;
const SHADE_LEGS = [
  // .....12..21
  // .....12..21
  // .....12..21
  // .....12..21
  // .....12..21
  // ....12....21
  // ....12....21
  // ....12....21
  // ...12......21
  // ...12......21
  // ..111......111
  `
#.12..21
#.12..21
#.12..21
#.12..21
#.12..21
".12".21
".12".21
".12".21
!.12$.21
!.12$.21
..!1$.!1`,
  // .....12..21
  // .....12...21
  // ....12....21
  // ....12.....21
  // ...12......21
  // ...12.......21
  // ..12........21
  // ..12.........21
  // .12..........21
  // .12...........1
  // 111..........11
  `
#.12..21
#.12!.21
".12".21
".12#.21
!.12$.21
!.12%.21
..12&.21
..12'.21
.12(.21
.12).1
!1(.11`,
];

const BAT = [
  // 1..............1
  // 11............11
  // .11...1..1...11
  // .1111.1111.1111
  // ..111111111111
  // ...111r11r111
  // .....111111
  // ......1111
  `
1,.1
11*.11
.11!.1..1!.11
."1."1."1
..*1
!.!1r11r!1
#.$1
$."1`,
  //
  //
  // ......1..1
  // ......1111
  // ....11111111
  // ..1111r11r1111
  // .1111.1111.1111
  // 11.....11.....11
  `


$.1..1
$."1
".&1
.."1r11r"1
."1."1."1
11#.11#.11`,
];

// Tools, by id. An empty hand is 0 (or null), so a tool is always truthy.
const FLASHLIGHT = 1;
const CROWBAR = 2;
const UMBRELLA = 3;
const REVOLVER = 4;
const TOOLS = [FLASHLIGHT, CROWBAR, UMBRELLA, REVOLVER];
const TOOL_NAMES = ['MANOS VACIAS', 'LINTERNA', 'PATA DE CABRA', 'PARAGUAS', 'REVOLVER'];

// One icon per tool, in TOOLS order; they become the textures tool_1 to tool_4.
const ICONS = [
  // flashlight
  //
  //
  //
  // ..........wwo
  // .ooooooooowwwo
  // .o3444445o6wwo
  // .o3455545o6wwo
  // .o3444445o6wwo
  // .ooooooooowwwo
  // ..........wwo
  `



(.wwo
.'o!wo
.o3#45o6wwo
.o34!545o6wwo
.o3#45o6wwo
.'o!wo
(.wwo`,
  // crowbar
  // .............44
  // ............5..4
  // ...........5...4
  // ..........5
  // .........5
  // ........5
  // .......5
  // ......4
  // .....4
  // ....4
  // ...4
  // ..4
  // .4R
  // .rR
  `
+.44
*.5..4
).5!.4
(.5
'.5
&.5
%.5
$.4
#.4
".4
!.4
..4
.4R
.rR`,
  // umbrella
  // .......1
  // ......1c1
  // .....1ccc1
  // ....1ccccc1
  // ...1ccccccc1
  // ..1cccrccccc1
  // .1ccccrcccccc1
  // .1.1.1.5.1.1.1
  // .......5
  // .......5
  // .......5
  // .......5
  // .....5.5
  // ......5
  `
%.1
$.1c1
#.1!c1
".1#c1
!.1%c1
..1!cr#c1
.1"cr$c1
.1.1.1.5.1.1.1
%.5
%.5
%.5
%.5
#.5.5
$.5`,
  // revolver
  //
  //
  //
  //
  // ...4666666666
  // ..44555555556
  // ..4444444
  // ..455.3
  // ..445
  // .445
  // .44
  `




!.4'6
..44&56
..%4
..455.3
..445
.445
.44`,
];

// ..........1111111111
// .......111cccccccccc111
// .....11cccccccrcccccccc11
// ...11cccccccccrcccccccccc11
// ..1cccccccccccrcccccccccccc1
// .1ccccccccccccrccccccccccccc1
// 1cccccccccccccrcccccccccccccc1
// 1.1..1..1..1..5..1..1..1..1.11
// ..............5
// ..............5
// ..............5
// ..............5
const UMBRELLA_OPEN = `
(.(1
%.!1(c!1
#.11%cr&c11
!.11'cr(c11
..1)cr*c1
.1*cr+c1
1+cr,c1
1.1..1..1..1..5..1..1..1..1.11
,.5
,.5
,.5
,.5`;

const FLAME = [
  // ..w
  // .www
  // .wrw
  // .wrw
  // ..r
  `
..w
.!w
.wrw
.wrw
..r`,
  // ...w
  // ..ww
  // .wwr
  // .wrw
  // ..r
  `
!.w
..ww
.wwr
.wrw
..r`,
];
// full, empty, half
const HEART = [
  // .RR.RR
  // RrrRrrR
  // RrrrrrR
  // .RrrrR
  // ..RrR
  // ...R
  `
.RR.RR
RrrRrrR
R#rR
.R!rR
..RrR
!.R`,
  // .44.44
  // 4..4..4
  // 4.....4
  // .4...4
  // ..4.4
  // ...4
  `
.44.44
4..4..4
4#.4
.4!.4
..4.4
!.4`,
  // .RR.44
  // RrrR..4
  // RrrR..4
  // .Rrr.4
  // ..Rr4
  // ...R
  `
.RR.44
RrrR..4
RrrR..4
.Rrr.4
..Rr4
!.R`,
];

// Tile frames in the 'tiles' strip.
const TILE_DIRT = 0;
const TILE_DIRT_TOP = 1;
const TILE_BEAM = 2;
const TILE_BG = 3;
const TILE_CAVE = 4;
const TILE_ROCK = 5;
const TILE_ROCK_TOP = 6;
const TILE_STONE = 7;
const TILE_STONE_TOP = 8;
const TILE_BLACK = 9;

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
  ICONS.forEach((icon, i) => sheet('tool_' + TOOLS[i], [icon], 16, 16));
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
    box('#ff000059', 0, 0, 8, 4);
    rects('r11225122');
  });
  fromCanvas('eyes_small', 6, 3, () => {
    rects('r01113111');
    box('#ff00004d', 0, 0, 5, 3);
  });

  makeTiles();
  makeProps();
  makeLights();
  makeBackdrops();
  makeFont(scene);
  makeLogo();
  makeFx();
}

function makeTiles() {
  const rand = rng(7);
  // One 16px tile at `ox`: a base colour, then `n` specks of w x h alternating
  // between two colours, scattered over the tile (`spanY` is how far down they go).
  const tile = (ox, base, n, w, h, odd, even, spanY = 16 - h) => {
    box(base, ox, 0, 16, 16);
    for (let i = 0; i < n; i++) box(i % 2 ? odd : even, ox + floor(rand() * (16 - w)), floor(rand() * spanY), w, h);
  };
  // `top` tiles get a lit 1px crust.
  const crust = (ox, top, k) => top && box(k, ox, 0, 16, 1);
  // Packed dirt, with a crust of dry grass.
  const dirt = (ox, top) => {
    tile(ox, '#2c2117', 8, 2, 1, '#35281a', '#1d150e');
    crust(ox, top, '#6b573a');
  };
  // Cave rock.
  const rock = (ox, top) => {
    tile(ox, '#1b1814', 4, 5, 3, '#282320', '#33302a');
    crust(ox, top, '#4a463e');
  };
  // Ruin stone (the church), with mortar lines.
  const stone = (ox, top) => {
    tile(ox, '#1a1815', 6, 4, 2, '#3a352e', '#2c2822');
    box('#0d0c0a', ox, 7, 16, 1);
    box('#0d0c0a', ox + 7, 0, 1, 7);
    crust(ox, top, '#69625a');
  };
  // Interior wall behind the open rooms: cave rock, or the church's plaster.
  const wall = (ox, cave) => tile(ox, cave ? '#12100d' : '#2b2720', 6, 2, 1, '#0d0b09', '#0d0b09', 14);

  fromCanvas('tiles', 160, 16, () => {
    dirt(0);
    dirt(16, true);
    // wooden beam (one-way)
    rects('o00g6 z00g4 C00g1 t2251a141 l1425d425', 32);
    wall(48);
    wall(64, true);
    rock(80);
    rock(96, true);
    stone(112);
    stone(128, true);
    box('k', 144, 0, 16, 16); // buried rock: pure black
  });

  fromCanvas('cracked', 16, 16, () => {
    rock(0);
    rects('k801272128412661278129a128c12ae129f1235419a41 D93115911');
    // yellow paint daubed across it: this stone can be broken
    for (let i = 0; i < 8; i++) box('N', 2 + i, 13 - i, 2, 2);
    rects('N1132cd32');
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
    for (let i = 0; i < 28; i++) {
      const x = floor(r() * 32);
      const y = floor(r() * 32);
      const l = 2 + floor(r() * 8);
      box(r() > 0.85 ? '4' : 'n', x, y, 1, l);
    }
    rects('Rc911pm11');
  });
}

// A leafless llanos tree: recursive limbs, drawn thick and gnarled.
function drawTree(x0, y0, len, w, r) {
  const b = (x, y, a, l, w) => {
    if (l < 5 || w < 1) return;
    const x2 = x + cos(a) * l;
    const y2 = y + sin(a) * l;
    pen.lineWidth = w;
    pen.beginPath();
    pen.moveTo(x, y);
    pen.lineTo(x2, y2);
    pen.stroke();
    b(x2, y2, a - 0.35 - r() * 0.4, l * 0.72, w * 0.68);
    b(x2, y2, a + 0.3 + r() * 0.4, l * 0.68, w * 0.68);
  };
  b(x0, y0, -PI / 2, len, w);
}

function makeProps() {
  fromCanvas('tree', 70, 112, () => {
    ink('M');
    pen.lineCap = 'round';
    drawTree(35, 112, 38, 7, rng(3));
  });
  // Belfry window: two lancets under an oculus, leaded in greys and a little crimson.
  fromCanvas('window', 48, 96, () => {
    const glass = path('M3 96V44q0-14 9-22q9 8 9 22V96zm24 0V44q0-14 9-22q9 8 9 22V96zM16 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0');
    ink('b');
    pen.fill(glass);
    pen.save();
    pen.clip(glass);
    const r = rng(11);
    for (let y = 0; y < 96; y += 6) {
      for (let x = 0; x < 48; x += 6) {
        const p = r();
        box(p > 0.75 ? 'P' : p > 0.4 ? 'x' : 'q', x, y, 5, 5);
      }
    }
    pen.restore();
    ink('A');
    pen.stroke(glass);
  });
  // One bay of the vault: the shadow above a pointed arch springing from pillar to pillar.
  fromCanvas('arch', 96, 64, () => {
    shape('f', 'M0 0V64Q6 20 48 4Q90 20 96 64V0Z');
  });
  fromCanvas('bell', 48, 52, () => {
    shape('o', 'M20 2L28 2Q38 4 39 22Q40 38 47 46L1 46Q8 38 9 22Q10 4 20 2');
    shape('B', 'M21 4L27 4Q36 6 37 22Q38 37 44 44L4 44Q10 37 11 22Q12 6 21 4');
    rects('Efa3s xva3u6EA2 lmI48 Rkk82ng2a');
  });
  fromCanvas('scrub', 26, 12, () => {
    const r = rng(17);
    pen.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const x = 2 + r() * 22;
      ink('#3f3d1c');
      pen.beginPath();
      pen.moveTo(x, 12);
      pen.lineTo(x + (r() - 0.5) * 8, 12 - 3 - r() * 8);
      pen.stroke();
    }
  });
  // The child's cabin: dark planks, a lit window and a stooped roof.
  fromCanvas('house', 60, 54, () => {
    box('#080604', 6, 22, 48, 32);
    box('#241a10', 8, 24, 44, 28);
    shape('#080604', 'M0 24L30 4L60 24Z');
    box('#080604', 22, 34, 14, 20);
    box('#3a2a18', 23, 35, 12, 19);
    box('#e0a030', 39, 28, 14, 12);
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
      gradient(pen.createRadialGradient(64, 64, 0, 64, 64, 64), 0, '#ffffffd9', 0.45, '#ffffff8c', 0.75, '#ffffff38', 1, '#fff0'),
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
// It holds only the characters the game's text uses: a new one needs its 7 rows added.
const FONT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?-:/ ¡';
const FONT =
  'ehhvhhhuhhuhhuehgggheuhhhhhuvgguggvvggugggehgjhhehhhvhhhe44444e1111hhehikokihggggggvhrrhhhhhppljjhehhhhheuhhugggehhhliduhhukihehge1hev444444hhhhhhehhhhaa4hhhhrrhhha4ahhhha4444v1248gvehjlphe4c4444eeh168gveh161he26aiv22vgu11heegguhhev124444ehhehheehhf11e000008800004484444404eh12404000e000044044011248gg00000004044444';

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
    box(gradient(pen.createLinearGradient(0, 0, 0, 480), 0, '#04050a', 0.55, '#141118', 0.8, '#2a1d19', 1, '#3c2b1c'), 0, 0, 640, 480);
  });

  // Far savanna: flat horizon, a ragged treeline and the church, its spire the one red thing out there.
  fromCanvas('hills', 640, 480, () => {
    const r = rng(5);
    box('#0a0908', 0, 340, 640, 140);
    ink('#0a0908');
    pen.beginPath();
    pen.moveTo(0, 352);
    for (let x = 0; x <= 640; x += 64) pen.lineTo(x, 340 - r() * 10);
    pen.lineTo(640, 480);
    pen.lineTo(0, 480);
    pen.closePath();
    pen.fill();
    for (let x = 8; x < 640; x += 44 + r() * 60) {
      const h = 18 + r() * 26;
      box('#060605', x, 340 - h, 8, h + 6);
    }
    shape('#0d0c0b', 'M150 340V276h14v34h30v30Z');
    shape('#3a0008', 'M148 276l9-30 9 30ZM156 238h2v8h-2ZM153 240h8v2h-8Z');
  });

  // Nearer grove of dry trees and scrub, darker than the horizon.
  fromCanvas('grove', 640, 480, () => {
    const r = rng(8);
    box('#050504', 0, 430, 640, 50);
    ink('#050504');
    pen.lineCap = 'round';
    for (let x = -10; x < 660; x += 90 + r() * 100) drawTree(x, 440, 40 + r() * 40, 4 + r() * 3, r);
  });

  // Mid forest: tall dark trunks with roots and hanging limbs.
  fromCanvas('forestmid', 640, 480, () => {
    const r = rng(53);
    for (let x = -20; x < 660; x += 84 + r() * 80) {
      const w = 10 + r() * 16;
      box('#0b0b0e', x, 0, w, 480);
      shape('#0b0b0e', `M${x} 480L${x - 9} 480L${x + 2} 436Z`);
      pen.fill(path(`M${x + w} 480L${x + w + 9} 480L${x + w - 2} 436Z`));
      pen.fillRect(x + r() * w, 0, 2, 50 + r() * 80);
    }
    box('#0b0b0e', 0, 0, 640, 12);
  });

  // Foreground trunks that sweep in front of the camera (Blasphemous columns).
  fromCanvas('foretrees', 320, 480, () => {
    const r = rng(67);
    for (let i = 0; i < 2; i++) {
      const x = 40 + i * 180 + r() * 40;
      const w = 18 + r() * 16;
      box('#030303', x, 0, w, 480);
      ink('#030303');
      for (let j = 0; j < 4; j++) {
        const y = 20 + r() * 300;
        const len = 40 + r() * 90;
        pen.fillRect(r() > 0.5 ? x + w : x - len, y, len, 5);
      }
      for (let j = 0; j < 5; j++) {
        pen.beginPath();
        pen.arc(x + w / 2 + (r() - 0.5) * 90, 12 + r() * 44, 10 + r() * 20, 0, PI * 2);
        pen.fill();
      }
    }
  });
}

function makeFx() {
  fromCanvas('drop', 4, 14, () => {
    ink('#dcdcdce6');
    pen.beginPath();
    pen.moveTo(3.5, 0);
    pen.lineTo(0.5, 14);
    pen.stroke();
  });
  // Free-aim crosshair.
  fromCanvas('reticle', 11, 11, () => {
    ink('#ffffffe6');
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
    ink('#b4b4b499');
    circle(3, 3, 3);
  });
}

// The whole map, built from rectangles on a tile grid.
//
// Route (each gate needs a tool):
//   Graveyard ──veil(flashlight)──▶ Hillside ──climb──▶ Gallery (crowbar)
//   Hillside floor ──cracked stone(crowbar)──▶ Umbrella ──crypt, veil──▶ shaft ──▶ Hillside
//   Gallery ──chasm(glide: umbrella)──▶ Church nave ──cracked retablo──▶ shaft ──vault(glide)──▶ ──veil──▶ Great Bell
//
// Entity coordinates are in tiles; `y` is the row the entity stands on
// (the top of the ground under it), so its feet are at y * 16.

const T = 16;
const OX = 48; // tiles of intro forest prepended before the old world
const BASE_W = 192; // width of the world before the forest was prepended
const W = BASE_W + OX;
const ARENA_X = 150; // first column of the ruins where El Silbon is fought
const ARENA_Y = 30;
const H = 40;
const CAVE_Y = 28;
const SCREEN_W = 640;
const SCREEN_H = 480;

const EMPTY = 0;
const SOLID = 1;
const BEAM = 2; // one-way platform

// A run: `night` counts the bells rung so far, and each one makes the next night harder.
let night = 0;
let score = 0;
let runId = 0; // id of this run, so its saved score is replaced rather than repeated
// Difficulty multiplier: 1 on the first night, levelling off after six.
const hard = (k = 0.12) => 1 + min(night, 6) * k;
const earn = (pts) => (score += floor(pts) * (night + 1));
// Where the extra monsters of later nights may stand: six shades, then four bats, as x, y pairs.
const SLOTS = [29, 26, 68, 26, 80, 11, 74, 36, 143, 24, 122, 9, 24, 19, 50, 31, 98, 9, 123, 5];

// Best runs, kept as five [score, night, run, initials] entries under one key.
const TOP_KEY = 'el-apagon:top';
async function loadTop() {
  try {
    const r = await window.platanusArcadeStorage.get(TOP_KEY);
    return (r.found && Array.isArray(r.value) ? r.value : []).filter((o) => Array.isArray(o) && o[0] > 0).slice(0, 5);
  } catch (err) {
    return [];
  }
}
// Initials are only known once the run is over; each set keeps just its best run.
async function saveScore(name = '') {
  const old = (await loadTop()).filter((o) => o[2] !== runId);
  const prev = old.find((o) => name && o[3] === name);
  const top = old.filter((o) => o !== prev);
  top.push(prev && prev[0] > score ? prev : [score, night, runId, name]);
  top.sort((a, b) => b[0] - a[0]);
  try {
    await window.platanusArcadeStorage.set(TOP_KEY, top.slice(0, 5));
  } catch (err) {}
}

function buildWorld() {
  // Built BASE_W wide; the forest's columns are prepended once it is all in place.
  const blank = () => Array.from({ length: H }, () => new Array(BASE_W).fill(EMPTY));
  const grid = blank();
  const interior = blank();
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

  // The base world; the forest is prepended and the outer shell added once it is slid across.
  fill(ARENA_X - 2, 0, ARENA_X - 1, H - 1); // the church's east wall; the ruins lie beyond it
  fill(ARENA_X, ARENA_Y, BASE_W - 3, H - 3);

  // Llanos flatlands: dry earth, leafless trees and low scrub.
  fill(2, 26, 33, 37);
  fill(12, 25, 16, 25);
  fill(24, 24, 27, 25);
  one('shrine', 8, 26, true); // already lit
  e('tree', 3, 26, 21, 26);
  one('tree', 12, 25, true); // flipped
  one('tree', 29, 26, true);
  e('scrub', 10, 26, 18, 26, 31, 26, 24, 24);
  e('grave', 14, 25);
  e('cross', 25, 24);
  e('shade', 20, 26);
  e('candle', 11, 26, 30, 26);

  // Cave mouth into the cerro, sealed by a veiled door.
  fill(34, 0, 35, 20);
  fill(34, 26, 35, 37);
  one('veil', 34, 21, 2, 5); // width, height

  // Open hillside: the long climb up the cerro, sky and grove behind.
  fill(36, 26, 89, 27); // hillside floor (the crypt lies below)
  fill(88, 0, 89, 6); // right wall, upper
  fill(88, 11, 89, 37); // right wall, lower (opening at rows 7-10 onto the chasm)

  beam(40, 45, 23);
  beam(49, 53, 20);
  beam(56, 60, 17);
  beam(63, 67, 14);
  beam(70, 87, 11); // gallery

  e('shrine', 38, 26);
  one('tool', 78, 11, CROWBAR);
  cracked(44, 26, 46, 27); // way down into the crypt
  e('tree', 40, 26, 68, 26, 86, 11);
  one('tree', 52, 26, true);
  e('scrub', 43, 23, 51, 20, 58, 17, 65, 14, 75, 11, 83, 11, 50, 26, 84, 26);
  e('candle', 71, 11, 86, 11);
  e('shade', 58, 26, 78, 26);
  e('bat', 55, 12, 74, 7);

  // Crypt
  fill(36, 36, 87, 37); // crypt floor
  fill(55, 36, 59, 37, EMPTY); // spike pit
  fill(67, 36, 71, 37, EMPTY); // spike pit
  spikes(55, 59, 38);
  spikes(67, 71, 38);
  inside(36, 28, 87, 37);
  one('veil', 62, 28, 2, 8);
  e('shrine', 49, 36);
  one('tool', 44, 36, UMBRELLA);
  e('shade', 52, 36, 77, 36);
  e('bat', 75, 31);
  e('candle', 40, 36, 65, 36, 80, 36);
  // Shaft back up to the hillside.
  fill(85, 26, 87, 27, EMPTY);
  beam(85, 87, 33);
  beam(85, 87, 30);
  beam(85, 87, 27);

  // Chasm
  spikes(90, 107, 38, true);

  // The church. The door opens onto the steps under the bell tower, and the bell
  // hangs right overhead, but the way to it is the long one: down into the nave,
  // through the retablo behind the altar, up the shaft and back across the vault.
  fill(108, 24, 147, 37); // nave floor
  fill(106, 17, 117, 23); // entrance steps, and the lip outside the door
  fill(108, 0, 109, 12); // outer wall (door at rows 13-16)
  fill(108, 0, 147, 1); // roof
  inside(110, 2, 147, 23);
  fill(110, 9, 125, 9); // bell loft
  fill(138, 6, 139, 23); // retablo
  cracked(138, 20, 139, 23);
  beam(118, 120, 18); // back up to the door from the nave
  beam(121, 123, 21);
  for (let y = 9; y < 24; y += 3) beam(140 + (y % 6), 143 + (y % 6), y); // shaft behind the retablo
  beam(140, 147, 6);
  // The chandelier hangs over the nave only on the first night. After that it lies
  // where it fell, and the vault has to be glided.
  if (!night) beam(127, 129, 8);
  one('candelabra', 128, night ? 24 : 8);
  e('shrine', 112, 17, 135, 24); // the door, and the altar
  e('shade', 128, 24, 134, 24);
  one('veil', 118, 2, 2, 7);
  e('bat', 133, 4, 144, 14);
  e('candle', 116, 17, 121, 24, 146, 24, 141, 6);
  e('candelabra', 133, 24, 137, 24);
  e('pillar', 125, 2, 131, 2, 137, 2);
  e('arch', 128, 2, 134, 2);
  e('window', 128, 11, 134, 11, 114, 3, 114, 10.5, 143, 12);
  e('cross', 138.5, 6);
  e('bell', 114, 2);

  // Later nights: more things wake and the blackout spreads, the same way for every player.
  // Done before the slide below, so SLOTS stay in the built world's own columns.
  const r = rng(night * 2654435761);
  // Walk the slots in strides of three from a random start, so none repeats.
  for (let i = 0, k = floor(r() * 10); night && i <= min(night, 6); i++, k = (k + 3) % 10) one(k < 6 ? 'shade' : 'bat', SLOTS[k * 2], SLOTS[k * 2 + 1]);

  // Slide the whole built world right, leaving the forest in front of it.
  for (const row of [...grid, ...interior]) row.unshift(...new Array(OX).fill(EMPTY));
  for (const ent of ents) ent.x += OX;

  // World shell
  fill(0, 0, 1, H - 1);
  fill(W - 2, 0, W - 1, H - 1);
  fill(0, H - 2, W - 1, H - 1);

  // Intro forest: the child leaves the house and walks east toward the llanos.
  fill(2, 26, OX + 1, H - 1); // floor + buried rock, which the biome draws black
  one('house', 6, 26);
  one('shrine', 12, 26, true); // the cabin is the first checkpoint
  for (let i = 0; i < 5; i++) {
    const x = 21 + i * 6;
    one('tree', x, 26, i % 3 === 1, 1.3 + (i % 4) * 0.35);
  }
  for (let x = 24; x <= OX - 2; x += 9) one('scrub', x, 26);
  e('foresteyes', 19, 23, 30, 26, 42, 25);

  // Later nights snuff some of the candles.
  return { grid, interior, ents: night ? ents.filter((o) => !/^cand/.test(o.type) || r() > min(0.6, night * 0.15)) : ents };
}

// Digital-glitch camera filter: RGB split, tear bands, datamosh blocks,
// scanline corruption and film grain.
// `amount` 0..1 drives how broken the picture gets.
// Kept flush left and tight: every byte in here counts against the size limit.
// The shader is shipped minified below; this is the same program, readable
// (res, time and amount are the uniforms r, z and a):
// precision highp float;
// uniform sampler2D uMainSampler;
// uniform vec2 res;
// uniform float time;
// uniform float amount;
// varying vec2 outTexCoord;
// float rand(vec2 co) {
// vec3 p = fract(vec3(co.xyx) * .1031);
// p += dot(p, p.yzx + 33.33);
// return fract((p.x + p.y) * p.z);
// }
// void main() {
// vec2 uv = outTexCoord;
// float I = amount;
// float t = mod(floor(time * 14.), 251.);
// float band = floor(uv.y * 28.);
// float tear = step(1. - I * .4, rand(vec2(band, t))) * (rand(vec2(band + 7., t)) - .5) * .16 * I;
// float line = floor(uv.y * res.y);
// uv.x += tear + step(1. - I * .05, rand(vec2(line * .37 + t * 3.1, t + 2.))) * (rand(vec2(line * 1.7, t)) - .5) * .06;
// vec2 blk = floor(uv * vec2(20., 12.));
// if (rand(blk + vec2(t * .37, t * .11)) > 1. - I * .14) {
// uv += (vec2(rand(blk + 1.3), rand(blk + 2.1)) - .5) * .08 * (.5 + I);
// }
// float split = .0012 + I * .014;
// vec2 dir = vec2(split, split * .35 * sin(time * 9.));
// vec4 col = texture2D(uMainSampler, uv);
// col.r = texture2D(uMainSampler, uv + dir).r;
// col.b = texture2D(uMainSampler, uv - dir).b;
// float cl = step(1. - max(0., I - .12) * .03, rand(vec2(line * .37 + t * 13.1, t * 7.3 + 5.)));
// col.rgb = mix(col.rgb, vec3(rand(vec2(line, t))), cl * .7);
// col.rgb += (rand(outTexCoord * res + t * 17.) - .5) * (.05 + I * .1);
// gl_FragColor = col;
// }
const FRAG = `precision highp float;
uniform sampler2D uMainSampler;
#define T(x) texture2D(uMainSampler,x)
#define V vec2
uniform V r;uniform float z,a;varying V outTexCoord;float R(V c){vec3 p=fract(vec3(c.xyx)*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}void main(){V u=outTexCoord;float t=mod(floor(z*14.),251.),b=floor(u.y*28.),e=step(1.-a*.4,R(V(b,t)))*(R(V(b+7.,t))-.5)*.16*a,l=floor(u.y*r.y);u.x+=e+step(1.-a*.05,R(V(l*.37+t*3.1,t+2.)))*(R(V(l*1.7,t))-.5)*.06;V k=floor(u*V(20.,12.));if(R(k+V(t*.37,t*.11))>1.-a*.14)u+=(V(R(k+1.3),R(k+2.1))-.5)*.08*(.5+a);float h=.0012+a*.014;V d=V(h,h*.35*sin(z*9.));vec4 o=T(u);o.r=T(u+d).r;o.b=T(u-d).b;float g=step(1.-max(0.,a-.12)*.03,R(V(l*.37+t*13.1,t*7.3+5.)));o.rgb=mix(o.rgb,vec3(R(V(l,t))),g*.7);o.rgb+=(R(outTexCoord*r+t*17.)-.5)*(.05+a*.1);gl_FragColor=o;}`;

// Property names on Phaser objects are two letters to fit the size limit (the
// minifier cannot shorten them). What each one means:
//   ad abyss, an amount, bj base, br burning, ca ctl, cc clock, cs chasing
//   dr dir, dy dying, ex expires, ey eyes, fl flicker, gw glow, hi hit
//   hm home, hp health, ht hurt flash, li lit, lu lunge, md mode, mu modeUntil
//   na nextAt, pa pickableAt, rc rect, sd shriekAt, sk spike, sn strength
//   su stunUntil, tc tool, tk tick, tl tall, tx/ty tile, un until

// Phaser 3 post-pipeline (registered in the game config) that runs FRAG over a
// whole camera. Each camera gets its own instance; `ctl` is the Glitch controller feeding it.
class GlitchPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game) {
    super({ game, name: 'Glitch', fragShader: FRAG });
  }

  onPreRender() {
    const c = this.ca;
    this.set2f('r', this.renderer.width, this.renderer.height);
    this.set1f('z', c ? c.cc : 0);
    this.set1f('a', c ? c.an : 0);
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
  const ctl = new Glitch(base);
  camera.setPostPipeline('Glitch');
  camera.getPostPipeline('Glitch').ca = ctl;
  camera.postFX.addVignette(0.5, 0.5, 0.9, 0.55);
  return ctl;
}

// What is on stage: the Title or the Game scene, whichever is running, with its
// camera and glitch controller. Only one of them runs at a time, so this and the
// rest of the game state live at module level, where the minifier can shorten
// every name (it cannot touch `this.` properties).
let stage, cam, glitch;

// Small scene helpers.
const image = (scene, x, y, key, depth, ox = 0.5, oy = ox, frame) => scene.add.image(x, y, key, frame).setOrigin(ox, oy).setDepth(depth);
const later = (ms, fn) => stage.time.delayedCall(ms, fn);
const clock = () => stage.time.now;
const fade = (scene, targets, alpha, duration, delay = 0, onComplete = null) => scene.tweens.add({ targets, alpha, duration, delay, onComplete });
// Full-screen white sheet, invisible until its alpha is raised.
const whiteout = (depth) => stage.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0xffffff).setOrigin(0).setScrollFactor(0).setDepth(depth).setAlpha(0);
const backdrop = (key, y, depth) => stage.add.tileSprite(0, y, SCREEN_W, SCREEN_H, key).setOrigin(0).setScrollFactor(0).setDepth(depth);
// The slow blink of a prompt.
const blink = (o, time) => o.setAlpha(floor(time / 500) % 2 ? 0.35 : 1);
const range = (lo, hi) => ({ min: lo, max: hi });
const ramp = (start, end) => ({ start, end });

// The storm over the stage. `stormLevel` (0..1) is how lit the world is right
// now — the game uses it to lift the darkness. `stormJolt` is how hard a strike
// shakes the picture.
let stormLevel, stormJolt, skyFlash, boltGfx, flashRect;

function startStorm(minGap, maxGap, joltAmount) {
  stormLevel = 0;
  stormJolt = joltAmount;

  image(stage, 0, 0, 'sky', -30, 0).setScrollFactor(0);
  skyFlash = whiteout(-29);
  boltGfx = stage.add.graphics().setScrollFactor(0).setDepth(-28);

  const rain = (depth, lifespan, speedY, speedX, alpha, quantity, frequency, extra) =>
    stage.add
      .particles(0, 0, 'drop', { x: range(-60, SCREEN_W + 120), y: -20, lifespan, speedY, speedX, alpha, quantity, frequency, ...extra })
      .setScrollFactor(0)
      .setDepth(depth);
  rain(40, 1000, range(520, 640), range(-135, -115), range(0.25, 0.55), 5, 16, { scaleY: range(0.7, 1.3) });
  rain(62, 750, range(700, 800), range(-170, -150), range(0.1, 0.22), 2, 20, { scale: range(1.2, 1.6) });

  flashRect = whiteout(55);
  const schedule = () =>
    later(between(minGap, maxGap), () => {
      lightning();
      schedule();
    });
  schedule();
}

function lightning(power = 0.6 + random() * 0.4) {
  const bolt = () => drawBolt(between(40, SCREEN_W - 40));
  bolt();
  stormLevel = power;
  later(80, () => (stormLevel = 0.15));
  later(150, () => {
    stormLevel = power;
    bolt();
  });
  thunder(0.15 + random() * 1.25, power);
  glitch.hi(stormJolt * power);
}

function drawBolt(x) {
  const g = boltGfx;
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

function updateStorm(dt) {
  const l = (stormLevel = max(0, stormLevel - dt * 1.6));
  boltGfx.setAlpha(l > 0.3 ? 1 : l * 3);
  skyFlash.setAlpha(l * 0.45);
  flashRect.setAlpha(l * 0.12);
}

const BootScene = {
  key: 'Boot',

  create() {
    makeArt(this);

    const anim = (key, texture, list, frameRate, repeat = -1) =>
      this.anims.create({ key, frames: list.map((frame) => ({ key: texture, frame })), frameRate, repeat });
    anim('idle', 'child', [0], 1, 0);
    anim('run', 'child', [1, 2, 3, 2], 10);
    anim('jump', 'child', [4], 1, 0);
    anim('walk', 'shade', [0, 1], 3);
    anim('stalk', 'silbon', [0, 1], 4);
    anim('fly', 'bat', [0, 1], 10);
    anim('flame', 'flame', [0, 1], 7);

    this.scene.start('Title');
  },
};

// The controls, shown rather than told: what the child does, then the button
// that does it. Shared by the title and pause screens.
function controlsLegend(scene) {
  const mid = SCREEN_W / 2;
  const img = (x, y, key, frame) => image(scene, x, y, key, 21, 0.5, 0.5, frame).setScale(2);
  const gfx = scene.add.graphics().setDepth(21);
  [
    ['MOVER', 'JOYSTICK', (x, y) => scene.add.sprite(x, y, 'child').setScale(2).setDepth(21).play('run')],
    [
      'USAR',
      'BTN 1',
      (x, y) => {
        image(scene, x + 10, y, 'cone', 20, 0, 0.5).setScale(0.2).setAlpha(0.5);
        img(x - 12, y, 'child', 0);
        img(x + 4, y + 4, 'tool_' + FLASHLIGHT);
      },
    ],
    [
      'SALTAR',
      'BTN 2',
      (x, y) => {
        img(x, y + 4, 'child', 4);
        img(x, y - 30, 'umbrella_open');
      },
    ],
    ['CAMBIAR', 'BTN 5/6', (x, y) => TOOLS.slice(0, 3).forEach((t, i) => img(x + (i - 1) * 30, y + 6, 'tool_' + t))],
    [
      'APUNTAR',
      'BTN 1 Y MOVER',
      (x, y) => {
        img(x - 12, y, 'child', 0);
        img(x + 14, y - 22, 'reticle').setRotation(-PI / 4);
      },
    ],
    ['DASH', 'BTN 3', (x, y) => img(x, y, 'child', 4)],
  ].forEach(([act, btn, icon], i) => {
    const x = mid + (i - 2.5) * 104;
    icon(x, 214);
    label(scene, x, 250, act).setDepth(21);
    gfx.fillStyle(0x4a4a4a).fillRect(x - 13, 276, 26, 6);
    if (i) gfx.fillStyle(0xc00010).fillRect(x - 8, 268, 16, 8).fillStyle(0xff1a1a).fillRect(x - 6, 266, 12, 4);
    else gfx.fillStyle(0x9a9a9a).fillRect(x, 264, 3, 12).fillStyle(0xff1a1a).fillRect(x - 3, 259, 9, 8);
    label(scene, x, 292, btn, 0x8c8c8c).setDepth(21);
  });
}

let starting, titleEyes, titleShadow, titleLogo, prompt;

const TitleScene = {
  key: 'Title',

  create() {
    stage = this;
    cam = stage.cameras.main;
    const mid = SCREEN_W / 2;
    const ground = SCREEN_H - 36;
    starting = false;
    glitch = addCameraFx(cam, 0.08);
    startStorm(2500, 6000, 0.5);

    backdrop('hills', 84, -22);
    backdrop('grove', 70, -21);

    image(stage, mid, ground, 'child', 10, 0.5, 1, 0).setScale(2);
    stage.add.rectangle(0, ground, SCREEN_W, 36, 0x050505).setOrigin(0).setDepth(9);
    image(stage, mid - 120, ground, 'shade', 8, 0.5, 1, 0).setScale(2).setAlpha(0.8);
    image(stage, mid + 150, ground, 'shade', 8, 0.5, 1, 1).setScale(2).setAlpha(0.8).setFlipX(true);
    titleEyes = [mid - 118, mid + 148].map((x) => image(stage, x, ground - 55, 'eyes', 12).setScale(2));

    titleShadow = image(stage, mid + 3, 98, 'logo', 20).setScale(LOGO_SCALE).setTintFill(0xb00010);
    titleLogo = image(stage, mid, 96, 'logo', 21).setScale(LOGO_SCALE);
    controlsLegend(stage);
    prompt = label(stage, mid, 344, 'PULSA START', 0xffffff, 2).setDepth(21);
    const best = label(stage, mid, 370, '', 0x8c8c8c).setDepth(21);
    loadTop().then(([t]) => t && best.active && best.setText(`MEJOR: ${t[3] || '???'} ${t[0]} - NOCHE ${t[1] + 1}`));

    const start = () => {
      if (starting) return;
      starting = true;
      night = score = 0;
      runId = Date.now();
      initAudio();
      startMusic();
      sound(sndGlitch);
      glitch.hi(1);
      lightning(1);
      nextScene('Game', 700);
    };
    anyPress = start;
    stage.events.once('shutdown', () => (anyPress = null));
    stage.input.once('pointerdown', start);
  },

  update(time, delta) {
    const dt = delta / 1000;
    const mid = SCREEN_W / 2;
    updateStorm(dt);
    glitch.tk(dt);
    blink(prompt, time);

    const jitter = random() < 0.06 + glitch.an * 0.3 ? between(-6, 6) : 0;
    titleLogo.x = mid + jitter;
    titleShadow.x = mid + 3 - jitter * 1.5 + (random() < 0.05 ? 8 : 0);
    for (const e of titleEyes) e.setAlpha(0.6 + random() * 0.4 + stormLevel);
  },
};

// START toggles the game between running and frozen, over a screen that repeats
// the title's legend so the controls are always a button away.
let pauseGlitch, pausePrompt;

const PauseScene = {
  key: 'Pause',

  create() {
    pauseGlitch = addCameraFx(this.cameras.main, 0.08);
    this.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0x000000, 0.85).setOrigin(0).setScrollFactor(0);
    controlsLegend(this);
    pausePrompt = label(this, SCREEN_W / 2, 348, 'PAUSA', 0xffffff, 3).setDepth(21);
  },

  update(time, delta) {
    pauseGlitch.tk(delta / 1000);
    blink(pausePrompt, time);
    if (tap('START1') || tap('START2')) {
      clearTaps();
      this.scene.resume('Game');
      this.scene.resume('Hud');
      this.scene.stop();
    }
  },
};

const RUN = 130;
const JUMP = 360;
const GLIDE_FALL = 36;
const MAX_HEARTS = 3;
const dropTime = () => 5000 / hard(); // how long a dropped tool waits on the ground
const BASE_DARK = 0.8;
const HUD_LINGER = 4000; // ms the HUD stays up after a tool change or a hit
const BOSS_HP = 6; // one for every chamber of the revolver
const NEVER = -1e9;
// How each tool is held, by id: [distance from the child along the aim, height, scale].
const TOOL_HOLD = [0, [8, 11, 0.6], [7, 10, 0.8], [6, 10, 0.7], [9, 11, 0.8]];
// Scenery that is just an image standing on its tile: [origin y, depth, y offset].
const PROPS = {
  tree: [1, -3, 2],
  grave: [1, -2, 1],
  cross: [1, -2, 1],
  scrub: [1, -2, 1],
  house: [1, -1, 2],
  candle: [1, -1, 0],
  candelabra: [1, -1, 0],
  window: [0, -7, 0],
  arch: [0, -9, 0],
  bell: [0, -1, 0],
};

// Game state (see `stage` above for why it is not on the scene).
// The world: its grid and entities, tile layer, and what was built from them.
let world, layer, crackedAt, lights, decals, hintsShown, shades, bats, pickups, crackedGroup, spikeGroup, veilGroup, veils, shrines;
let checkpoint, bellSprite, belfryBell, ruinBell, bellZone, hills, grove, forestMid, foreTrees;
// Particle emitters, and the pieces of the darkness.
let bloodFx, smokeFx, emberFx, debrisFx, splashFx, glitchFx, darkness, coneGlow, auraGlow, darkPool, dropBars;
// The child: what they carry and where they point it.
let player, heldTool, umbrellaOpen, reticle, hearts, inventory, found, equipped, facing, aiming, aimX, aimY, aimAngle;
let focus, lightCone, flicker, gliding, dead, won, cutscene, falling, crumbling;
// Timers (ms on the scene clock, except the two in seconds: attackCooldown and stepTimer).
let invulnUntil, stunUntil, lastGround, dropUntil, dropRow, attackCooldown, swingUntil, stepTimer, jumpPressedAt, downAt, nightStart;
let wasGrounded, lastVy, flatCam, wasIndoors;
// El Silbon: `boss` is him while the fight is on, `silbon` the sprite kept between fights.
let boss, silbon, bones, thrown;

function buildTilemaps() {
  const { grid, interior } = world;
  const makeLayer = (data, depth) => {
    const map = stage.make.tilemap({ data, tileWidth: T, tileHeight: T });
    return map.createLayer(0, map.addTilesetImage('tiles', 'tiles', T, T, 0, 0), 0, 0).setDepth(depth);
  };
  // A thin crust of textured rock over pure black. Only exposed faces and the
  // cave are drawn; everything buried is opaque darkness, so the world never
  // shows through to the other side.
  const CAVE_L = 34 + OX;
  const CAVE_R = 89 + OX;
  const inCave = (x, y) => x >= CAVE_L && x <= CAVE_R && y >= CAVE_Y - 1;
  const exposed = (x, y, top) =>
    top ||
    (y > 1 && grid[y - 1][x] === SOLID && grid[y - 2][x] !== SOLID) ||
    (x > 0 && grid[y][x - 1] !== SOLID) ||
    (x < W - 1 && grid[y][x + 1] !== SOLID) ||
    (y < H - 1 && grid[y + 1][x] === EMPTY);
  const solid = (x, y, top) => {
    if (inCave(x, y)) return top ? TILE_ROCK_TOP : TILE_ROCK;
    if (!exposed(x, y, top)) return TILE_BLACK;
    if (x >= 106 + OX && y < CAVE_Y) return top ? TILE_STONE_TOP : TILE_STONE;
    if (y >= CAVE_Y) return top ? TILE_ROCK_TOP : TILE_ROCK;
    return top ? TILE_DIRT_TOP : TILE_DIRT;
  };
  const bg = (y) => (y >= CAVE_Y ? TILE_CAVE : TILE_BG);

  makeLayer(interior.map((row, y) => row.map((v) => (v ? bg(y) : -1))), -10);
  layer = makeLayer(
    grid.map((row, y) =>
      row.map((v, x) => (v === SOLID ? solid(x, y, y > 0 && grid[y - 1][x] !== SOLID) : v === BEAM ? TILE_BEAM : -1)),
    ),
    0,
  );
  layer.setCollision([TILE_DIRT, TILE_DIRT_TOP, TILE_ROCK, TILE_ROCK_TOP, TILE_STONE, TILE_STONE_TOP, TILE_BLACK]);
  layer.forEachTile((t) => {
    if (t.index === TILE_BEAM) t.setCollision(false, false, true, false);
  });
}

function buildFx() {
  const fx = (key, depth, config) => stage.add.particles(0, 0, key, { emitting: false, ...config }).setDepth(depth);
  bloodFx = fx('blood', 20, { lifespan: range(500, 1100), speed: range(60, 240), angle: range(200, 340), gravityY: 700, scale: ramp(1, 0.4) });
  smokeFx = fx('smoke', 21, { lifespan: 600, speedY: range(-60, -20), speedX: range(-20, 20), alpha: ramp(0.6, 0), scale: ramp(0.6, 1.6) });
  emberFx = fx('px', 61, { lifespan: 500, speed: range(20, 80), angle: range(220, 320), tint: [0xff1a1a, 0xffffff], scale: ramp(1, 0) });
  debrisFx = fx('chunk', 20, { lifespan: 900, speed: range(40, 200), angle: range(200, 340), gravityY: 800, rotate: range(0, 360) });
  splashFx = fx('px', 15, {
    lifespan: 220,
    speedY: range(-70, -30),
    speedX: range(-40, 40),
    gravityY: 400,
    scale: ramp(0.6, 0.2),
    alpha: ramp(0.6, 0),
    tint: 0xbbbbbb,
  });
  glitchFx = fx('px', 61, { lifespan: 500, speed: range(20, 120), tint: [0xff1a1a, 0xffffff, 0], scaleX: range(1, 5), scaleY: 0.5 });
}

function buildEntities() {
  const physics = stage.physics.add;
  shades = physics.group();
  bats = physics.group({ allowGravity: false });
  pickups = physics.group();
  crackedGroup = physics.staticGroup();
  spikeGroup = physics.staticGroup();
  veilGroup = physics.staticGroup();
  veils = [];
  shrines = [];

  for (const { type, x, y, a, b } of world.ents) {
    const px = x * T + 8;
    const py = y * T;
    const prop = PROPS[type];
    let s = prop && image(stage, px, py + prop[2], type, prop[1], 0.5, prop[0]);
    switch (type) {
      case 'shrine':
        shrines.push((s = image(stage, px, py, 'shrine', 2, 0.5, 1)));
        if (a) lightShrine((checkpoint = s), true);
        break;
      case 'tree':
        s.setFlipX(!!a);
        if (b) s.setScale(b);
        break;
      case 'house':
        addLight(px + 16, py - 19, 64);
        break;
      case 'foresteyes': {
        const ey = image(stage, px, py, 'eyes', -5).setScale(1.4).setAlpha(0.5);
        stage.tweens.add({
          targets: ey,
          alpha: { from: 0.12, to: 0.85 },
          duration: 1600 + random() * 1400,
          yoyo: true,
          repeat: -1,
          delay: random() * 2000,
        });
        break;
      }
      case 'candle':
        addFlame(px, py - 10, 34);
        break;
      case 'candelabra':
        addFlame(px - 8, py - 30);
        addFlame(px, py - 29);
        addFlame(px + 8, py - 30);
        addLight(px, py - 28, 70);
        break;
      case 'pillar':
        stage.add.tileSprite(px, py, 20, 22 * T, 'pillar').setOrigin(0.5, 0).setDepth(-8);
        break;
      case 'bell':
        bellSprite = s;
        stage.add.rectangle(px, py - 4, 60, 6, 0x1a1a1a).setDepth(-2);
        bellZone = new Rectangle(px - 56, py, 112, 7 * T);
        addLight(px, py + 30, 50, false);
        break;
      case 'cracked': {
        const c = crackedGroup.create(px, py + 8, 'cracked');
        c.tx = x;
        c.ty = y;
        crackedAt.set(x + ',' + y, c);
        break;
      }
      case 'spikes':
        spikeGroup.create(px, py - 8, 'spikes').ad = a;
        break;
      case 'veil': {
        const v = stage.add.tileSprite(px - 8, py, a * T, b * T, 'veil').setOrigin(0).setDepth(3);
        veilGroup.add(v);
        v.sn = 1;
        v.rc = new Rectangle(px - 8, py, a * T, b * T);
        veils.push(v);
        break;
      }
      case 'tool':
        spawnPickup(a, px, py - 10, 0, 0);
        break;
      case 'shade':
        spawnMonster(shades, px, py, 'shade', 'eyes', 3 + min(night, 3), 10, 28, 3, 4).setOrigin(0.5, 1).dr = random() < 0.5 ? -1 : 1;
        break;
      case 'bat': {
        const m = spawnMonster(bats, px, py + 8, 'bat', 'eyes_small', 1, 12, 6, 2, 1);
        m.hm = { x: px, y: py + 8 };
        m.md = 'hover';
        m.t = random() * 10;
        m.mu = 0;
      }
    }
  }
  for (const s of spikeGroup.getChildren()) s.body.setSize(14, 8).setOffset(1, 8);

  physics.collider(shades, layer);
  physics.collider(shades, crackedGroup);
  physics.collider(shades, veilGroup);
  physics.collider(pickups, layer);
  physics.collider(pickups, crackedGroup);
}

// A static light source; `glow` adds a faint additive halo under the darkness.
function addLight(x, y, r, flickers = true, glow = true) {
  const l = { x, y, r };
  l.fl = flickers;
  if (glow) l.gw = image(stage, x, y, 'light', 45).setBlendMode(1).setScale((r * 1.1) / 64).setAlpha(0.07);
  lights.push(l);
  return l;
}

function addFlame(x, y, r) {
  stage.add.sprite(x, y, 'flame').setOrigin(0.5, 1).setDepth(60).play({ key: 'flame', startFrame: between(0, 1) });
  if (r) addLight(x, y, r);
}

function lightShrine(shrine, silent) {
  shrine.li = true;
  shrine.setTexture('shrine_lit');
  for (const dx of [-5, 1, 7]) addFlame(shrine.x + dx - 0.5, shrine.y - 17 + (dx === 1 ? -2 : 0));
  addLight(shrine.x, shrine.y - 16, 80);
  if (!silent) {
    sound(sndCheckpoint);
  }
}

// Shades are `tall`: their middle is well above their feet.
function spawnMonster(group, x, y, key, eyes, hp, w, h, ox, oy) {
  const m = group.create(x, y, key, 0).setDepth(12);
  m.body.setSize(w, h).setOffset(ox, oy);
  m.tl = hp > 1;
  m.hp = hp;
  m.su = m.br = 0;
  m.cs = false;
  m.ey = image(stage, x, y, eyes, 60);
  return m.play(m.tl ? 'walk' : 'fly');
}

function spawnPickup(tool, x, y, vx, vy, expires) {
  const p = pickups.create(x, y, 'tool_' + tool).setDepth(14).setBounce(0.35).setDragX(160).setVelocity(vx, vy).setScale(1.7);
  p.body.setSize(16, 16);
  p.tc = tool;
  p.ex = expires;
  p.pa = clock() + (expires ? 500 : 0);
  // Warm additive halo plus a sprite glow so tools pop out of the dark.
  p.gw = image(stage, x, y, 'light', 45).setBlendMode(1).setScale(0.8).setAlpha(0.22).setTint(0xffe066);
  if (p.preFX) p.preFX.addGlow(0xffe066, 3, 0, false, 0.08, 18);
  p.once('destroy', () => p.gw.destroy());
}

function buildPlayer() {
  const physics = stage.physics.add;
  const p = (player = physics.sprite(9.5 * T, 26 * T, 'child', 0));
  p.setOrigin(0.5, 1).setDepth(10).setCollideWorldBounds(true);
  p.body.setSize(10, 20).setOffset(3, 4).setMaxVelocityY(620);

  heldTool = image(stage, 0, 0, 'tool_' + FLASHLIGHT, 11);
  umbrellaOpen = image(stage, 0, 0, 'umbrella_open', 11).setVisible(false);
  reticle = image(stage, 0, 0, 'reticle', 62).setVisible(false);

  // The beam row being dropped through stops holding the child up.
  physics.collider(p, layer, null, (_, t) => t.index !== TILE_BEAM || t.y !== dropRow);
  physics.collider(p, crackedGroup);
  physics.collider(p, veilGroup);
  const touch = (_, m) => m.dy || !m.active || hurt(m.x);
  physics.overlap(p, shades, touch);
  physics.overlap(p, bats, touch);
  physics.overlap(p, spikeGroup, (_, s) => onSpikes(s));
  physics.overlap(p, pickups, (_, item) => collect(item));
}

function buildDarkness() {
  darkness = stage.add.renderTexture(0, 0, SCREEN_W, SCREEN_H).setOrigin(0).setScrollFactor(0).setDepth(50);
  // Additive glow under the darkness so light visibly lights the rain and stone.
  coneGlow = image(stage, 0, 0, 'cone', 45, 0, 0.5).setBlendMode(1).setVisible(false);
  auraGlow = image(stage, 0, 0, 'light', 45).setBlendMode(1).setAlpha(0.06).setScale(0.8);
  // Soft dark pool that follows the child and fades to nothing at its rim,
  // so the scenery never competes with him. Sits under the bricks (depth 0).
  darkPool = image(stage, 0, 0, 'light', -0.4).setTint(0x000000).setScale(3);
  dropBars = stage.add.graphics().setDepth(61);
}

function monsters() {
  return [...shades.getChildren(), ...bats.getChildren()];
}

function tileAt(px, py) {
  const tx = floor(px / T);
  const ty = floor(py / T);
  return tx < 0 || ty < 0 || tx >= W || ty >= H || crackedAt.has(tx + ',' + ty) ? SOLID : world.grid[ty][tx];
}

// Solid ground or a beam: something to stand on.
function floorAt(px, py) {
  return tileAt(px, py) > EMPTY;
}

function lineOfSight(x0, y0, x1, y1) {
  const n = ceil(hypot(x1 - x0, y1 - y0) / 8);
  for (let i = 1; i < n; i++) {
    if (tileAt(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n) === SOLID) return false;
  }
  return true;
}

function groundBelow(x, y) {
  for (let ty = floor(y / T); ty < H; ty++) if (floorAt(x, ty * T + 1)) return ty * T;
  return null;
}

function hint(id, text, ms) {
  if (hintsShown.has(id)) return;
  hintsShown.add(id);
  showMessage(text, ms);
}

// Camera shake, with a glitch burst when `glitch` is given.
function jolt(ms, amount, burst) {
  cam.shake(ms, amount);
  if (burst) glitch.hi(burst);
}

function bleed(x, y, n, splats = 2) {
  bloodFx.emitParticleAt(x, y, n);
  for (let i = 0; i < splats; i++) {
    const dx = x + between(-18, 18);
    const gy = groundBelow(dx, y);
    if (gy === null || gy - y > 120) continue;
    decals.push(image(stage, dx, gy, 'splat' + between(0, 2), 4, 0.5, 1).setFlipX(random() < 0.5));
    if (decals.length > 80) decals.shift().destroy();
  }
}

function cycleTool(dir) {
  const owned = TOOLS.filter((t) => inventory.has(t));
  const tool = owned[(owned.indexOf(equipped) + dir + owned.length) % owned.length];
  if (!tool || tool === equipped) return;
  equipped = tool;
  sound(sndPoke);
  pulseHud();
}

function collect(item) {
  if (dead || clock() < item.pa) return;
  const tool = item.tc;
  const first = !found.has(tool);
  found.add(tool);
  inventory.add(tool);
  equipped = tool;
  pulseHud();
  item.destroy();
  if (first) {
    sound(sndNewTool);
    glitch.hi(0.4);
    if (tool === CROWBAR) showMessage('PATA DE CABRA - BOTON 1 golpea.', 5000);
    if (tool === UMBRELLA) showMessage('PARAGUAS - manten BOTON 2 al caer para planear.', 5000);
    if (tool === REVOLVER) hearts = MAX_HEARTS;
  } else {
    sound(sndPickup);
  }
}

function dropTool(dir) {
  const tool = equipped;
  inventory.delete(tool);
  equipped = null;
  spawnPickup(tool, player.x, player.y - 14, -dir * between(40, 90), -220, clock() + dropTime());
  sound(sndDrop);
  pulseHud();
  showMessage(`¡Soltaste: ${TOOL_NAMES[tool]}!`, 1500);
}

// A dropped tool that timed out crawls back to the last lit shrine.
function reclaim(item) {
  glitchFx.emitParticleAt(item.x, item.y, 24);
  sound(sndLost);
  glitch.hi(0.3);
  item.setPosition(checkpoint.x + 16, checkpoint.y - 10).setVelocity(0, 0).setAlpha(1);
  item.ex = null;
  showMessage(`${TOOL_NAMES[item.tc]} te espera junto a las velas.`, 3500);
}

function updateTools(dt, time) {
  const p = player;
  const tool = equipped;
  const f = facing;
  const ax = aimX;
  const ay = aimY;
  const angle = aimAngle;
  const useDown = tap(B_USE);
  attackCooldown -= dt;
  focus = false;
  lightCone = null;

  umbrellaOpen.setVisible(gliding).setPosition(p.x, p.y - 30);
  heldTool.setVisible(!!tool && !gliding && !dead);
  if (!tool) return;

  const swingT = max(0, (swingUntil - time) / 180);
  // Starts an attack if the button was pressed and the last one has finished.
  const attack = (cooldown, fx) => {
    if (!useDown || attackCooldown > 0) return false;
    attackCooldown = cooldown;
    swingUntil = time + 180;
    sound(fx);
    return true;
  };
  let [reach, height, scale] = TOOL_HOLD[tool];
  let tilt = 0; // extra rotation while swinging

  if (tool === FLASHLIGHT) {
    focus = down(B_USE);
    if (random() < 0.008) flicker = 0;
    flicker = min(1, flicker + dt * 6);
    if (flicker > 0.5 && !dead) {
      lightCone = { x: p.x + ax * 12, y: p.y - 11 + ay * 12, angle, range: focus ? 270 : 190, half: focus ? 0.2 : 0.4, power: focus ? 2.4 : 1 };
      shineCone(lightCone, dt);
    }
  } else if (tool === CROWBAR) {
    tilt = swingT ? 3.1 * swingT - 1.2 : 0.5;
    if (attack(0.38, sndSwing)) meleeStrike(aimBox(30, 46), 2, 220, true);
  } else if (tool === REVOLVER) {
    tilt = -0.6 * swingT;
    if (attack(0.45, sndShot)) {
      jolt(70, 0.006);
      const x0 = p.x + ax * 14;
      const y0 = p.y - 12 + ay * 14;
      const shot = new Line(x0, y0, x0 + cos(angle) * 420, y0 + sin(angle) * 420);
      const tracer = stage.add.graphics().setDepth(61).lineStyle(1, 0xffffff, 0.9).strokeLineShape(shot);
      later(50, () => tracer.destroy());
      const b = boss;
      if (b && !b.dy && Intersects.LineToRectangle(shot, b.getBounds())) hitBoss(sign(b.x - p.x));
    }
  } else {
    reach += 8 * swingT;
    tilt = 1.57;
    if (attack(0.4, sndPoke)) meleeStrike(aimBox(26, 16), 1, 320);
  }
  heldTool
    .setTexture('tool_' + tool)
    .setFlipX(!aiming && f < 0)
    .setPosition(p.x + ax * reach, p.y - height + ay * reach)
    .setScale(scale)
    .setRotation(aiming ? angle + tilt : f * tilt);
}

// Axis-aligned hitbox extending from the player along the current aim vector.
// `len` runs along the aim, `wide` across it; 8-way aim keeps it corner-correct.
function aimBox(len, wide) {
  const ax = aimX;
  const ay = aimY;
  const along = 2 + len / 2;
  const w = abs(ax) * len + abs(ay) * wide;
  const h = abs(ay) * len + abs(ax) * wide;
  return new Rectangle(player.x + ax * along - w / 2, player.y - 12 + ay * along - h / 2, w, h);
}

// Melee hit on everything inside `box`.
function meleeStrike(area, dmg, knock, breaks) {
  const hits = (o) => Intersects.RectangleToRectangle(area, o.getBounds());
  let hitSomething = false;
  for (const m of monsters()) {
    if (m.active && !m.dy && hits(m)) {
      damage(m, dmg, (aimX || facing) * knock);
      hitSomething = true;
    }
  }

  let clang = false;
  for (const c of [...crackedAt.values()]) {
    if (hits(c)) {
      if (breaks) crumble(c.tx, c.ty);
      else clang = true;
    }
  }
  if (clang) sound(sndClang);
  if (hitSomething) jolt(80, 0.004);
}

// Break a cracked block and, a beat later, everything cracked touching it.
function crumble(tx, ty) {
  const key = tx + ',' + ty;
  const c = crackedAt.get(key);
  if (!c) return;
  crackedAt.delete(key);
  debrisFx.emitParticleAt(c.x, c.y, 8);
  c.destroy();
  if (!crumbling) {
    crumbling = true;
    sound(sndCrumble);
    jolt(250, 0.008, 0.3);
    later(300, () => (crumbling = false));
  }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) later(60, () => crumble(tx + dx, ty + dy));
}

function inCone(cone, x, y) {
  const dx = x - cone.x;
  const dy = y - cone.y;
  return (
    hypot(dx, dy) <= cone.range &&
    abs(Phaser.Math.Angle.Wrap(atan2(dy, dx) - cone.angle)) < cone.half &&
    lineOfSight(cone.x, cone.y, x, y)
  );
}

function shineCone(cone, dt) {
  const time = clock();
  for (const m of monsters()) {
    const cy = m.y - (m.tl ? 18 : 0);
    if (!m.active || m.dy || !inCone(cone, m.x, cy)) continue;
    m.br = 0.15;
    m.hp -= dt * cone.power * (m.tl ? 1.1 : 2.5);
    if (random() < 0.3) smokeFx.emitParticleAt(m.x, cy, 1);
    if (random() < 0.15) emberFx.emitParticleAt(m.x, cy, 1);
    if (!m.sd || time > m.sd) {
      m.sd = time + 900;
      sound(m.tl ? sndBurn : sndScreech);
    }
    if (m.hp <= 0) kill(m);
  }

  for (const v of veils) {
    if (v.sn <= 0) continue;
    let lit = false;
    for (const off of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const a = cone.angle + off * cone.half;
      for (let d = 8; d < cone.range && !lit; d += 8) {
        const x = cone.x + cos(a) * d;
        const y = cone.y + sin(a) * d;
        if (v.rc.contains(x, y)) lit = true;
        else if (tileAt(x, y) === SOLID) break;
      }
    }
    if (!lit) continue;
    v.sn -= dt * (focus ? 0.9 : 0.35);
    v.ht = 0.2;
    if (random() < 0.2) glitchFx.emitParticleAt(v.rc.centerX, between(v.rc.top, v.rc.bottom), 1);
    if (random() < 0.05) sound(sndBurn);
    if (v.sn <= 0) dissolveVeil(v);
    else hint('vf', 'Manten BOTON 1 para enfocar.');
  }
}

function dissolveVeil(v) {
  sound(sndVeil);
  glitch.hi(0.6);
  for (let i = 0; i < 40; i++) glitchFx.emitParticleAt(between(v.rc.left, v.rc.right), between(v.rc.top, v.rc.bottom), 1);
  veils = veils.filter((o) => o !== v);
  v.body.enable = false;
  stage.tweens.add({ targets: v, alpha: 0, scaleX: 0.2, duration: 400, onComplete: () => v.destroy() });
}

// Red flash on a monster that was just hit.
function flashRed(m) {
  m.setTint(0xff4444);
  later(120, () => m.active && m.clearTint());
}

function damage(m, dmg, knockX) {
  m.hp -= dmg;
  bleed(m.x, m.y - (m.tl ? 18 : 0), 14, 1);
  sound(sndFlesh);
  flashRed(m);
  if (m.tl) m.su = clock() + 350;
  m.setVelocity(knockX, m.tl ? -140 : -60);
  if (m.hp <= 0) kill(m);
}

function kill(m) {
  if (m.dy) return;
  m.dy = true;
  m.body.enable = false;
  earn(m.tl ? 50 : 20);
  pulseHud();
  bleed(m.x, m.y - (m.tl ? 16 : 0), m.tl ? 45 : 20, m.tl ? 4 : 2);
  sound(sndDie);
  jolt(120, 0.006, 0.3);
  stage.tweens.add({ targets: m.ey, alpha: 0, y: m.ey.y + 12, duration: 900, onComplete: () => m.ey.destroy() });
  stage.tweens.add({ targets: m, alpha: 0, scaleY: m.tl ? 0.1 : 1, angle: m.tl ? 0 : 180, duration: 500, onComplete: () => m.destroy() });
}

function onSpikes(s) {
  if (dead) return;
  hurt(player.x + (random() - 0.5));
  if (s.ad) {
    if (!dead && !falling) {
      falling = true;
      later(350, () => {
        falling = false;
        if (!dead) respawn();
      });
    }
  } else if (player.body.velocity.y >= 0) {
    player.setVelocityY(-340);
  }
}

function updateShade(s, dt, time) {
  const p = player;
  const dx = p.x - s.x;
  const sees = !dead && abs(dx) < 170 && abs(p.y - s.y) < 50 && lineOfSight(s.x, s.y - 26, p.x, p.y - 12);

  if (sees && !s.cs) sound(sndMoan);
  s.cs = sees;
  if (!sees && !s.dr) s.dr = s.flipX ? -1 : 1;

  // While stunned it is knocked back; let physics carry it.
  if (time >= s.su && s.body.blocked.down) {
    if (sees) s.dr = sign(dx) || s.dr;
    // Turn at walls and ledges (unless chasing straight at the player on the same level).
    if ((s.dr > 0 ? s.body.blocked.right : s.body.blocked.left) || !floorAt(s.x + s.dr * 8, s.y + 2)) s.dr = sees ? 0 : -s.dr;
    s.setVelocityX(s.dr * (sees ? 64 * hard() : 26) * (s.br > 0 ? 0.2 : 1));
  }
  if (s.dr) s.setFlipX(s.dr < 0);
  s.anims.timeScale = sees ? 2.5 : 1;

  const burning = s.br > 0;
  s.ey.setPosition(s.x + (s.flipX ? -1 : 1) + (burning ? between(-1, 1) : 0), s.y - 27.5).setAlpha(burning ? 0.4 + random() * 0.6 : 1);
  s.setAlpha(burning ? 0.6 + random() * 0.4 : 1);
}

function updateBat(b, dt, time) {
  b.t += dt;
  const px = player.x;
  const py = player.y - 12;
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
    if (!dead && hypot(b.x - px, b.y - py) < 150 && time > b.mu && lineOfSight(b.x, b.y, px, py)) {
      go('dive', 900);
      fly(px, py, 165 * hard());
      sound(sndScreech);
    }
  } else if (b.md === 'dive') {
    if (time > b.mu) go('return', 1500);
  } else {
    fly(b.hm.x, b.hm.y, 90);
    if (hypot(b.x - b.hm.x, b.y - b.hm.y) < 10 || time > b.mu) go('hover', 1500);
  }
  b.setFlipX(b.body.velocity.x < 0);
  b.ey.setPosition(b.x, b.y + 1.5);
}

// Returns false if the hit was ignored.
function hurt(srcX) {
  const time = clock();
  if (dead || won || cutscene || time < invulnUntil) return false;
  const p = player;
  invulnUntil = time + 1400;
  stunUntil = time + 260;
  const dir = sign(p.x - srcX) || -facing;
  p.setVelocity(dir * 170, -230);
  bleed(p.x, p.y - 12, 22);
  sound(sndHurt);
  jolt(160, 0.012, 0.7);
  pulseHud();

  // El Silbon goes straight for the heart; a held tool takes half the blow from lesser things and is knocked away.
  const shielded = equipped && !boss;
  if (shielded) dropTool(dir);
  if ((hearts -= shielded ? 0.5 : 1) <= 0) die();
  else if (boss && hearts <= 1 && !found.has(REVOLVER) && !thrown) throwRevolver();
  return true;
}

function die() {
  dead = true;
  const p = player;
  bleed(p.x, p.y - 12, 60, 5);
  p.setVisible(false);
  p.body.enable = false;
  sound(sndDeath);
  jolt(400, 0.02, 1.2);
  bigText('TE ENCONTRARON');
  // The first night forgives; after that, being found ends the run and asks for
  // three initials: joystick up/down changes the letter, BOTON 1 confirms it.
  if (night) {
    const abc = [0, 0, 0];
    let i = 0;
    const name = () => abc.map((c, j) => (j > i ? '-' : String.fromCharCode(65 + c))).join('');
    const show = () => bigText(`FIN: ${score} - ${name()}`);
    const done = () => {
      i = 3;
      anyPress = null;
      saveScore(name());
      nextScene('Title');
    };
    later(1200, () => {
      show();
      anyPress = (code) => {
        if (code === B_UP) abc[i] = (abc[i] + 1) % 26;
        if (code === B_DOWN) abc[i] = (abc[i] + 25) % 26;
        if (code === B_USE && ++i > 2) return done();
        show();
      };
    });
    later(16000, () => i < 3 && done());
    return;
  }
  later(2200, () => {
    bigText('');
    hearts = MAX_HEARTS;
    dead = false;
    p.setVisible(true);
    p.body.enable = true;
    if (boss) leaveArena();
    respawn();
  });
}

function respawn() {
  player.setPosition(checkpoint.x - 14, checkpoint.y - 1).setVelocity(0, 0);
  invulnUntil = clock() + 1500;
  glitch.hi(0.6);
  sound(sndGlitch);
  pulseHud();
}

function updatePlayer(dt, time) {
  const p = player;
  const body = p.body;
  if (dead || won || cutscene) {
    if (!dead) p.setVelocityX(0);
    aiming = false;
    reticle.setVisible(false);
    clearTaps();
    return;
  }

  const grounded = body.blocked.down;

  // Free aim / focus: hold BUTTON 1 and steer with the stick. The stick drives the
  // reticle instead of movement, so the child plants their feet while aiming.
  const hx = (down(B_RIGHT) ? 1 : 0) - (down(B_LEFT) ? 1 : 0);
  const vy = (down(B_DOWN) ? 1 : 0) - (down(B_UP) ? 1 : 0);
  aiming = down(B_USE);
  if (aiming) {
    if (hx || vy) {
      const q = (round(atan2(vy, hx) / (PI / 4)) * PI) / 4;
      aimAngle = q;
      aimX = round(cos(q));
      aimY = round(sin(q));
      if (aimX) facing = aimX;
    }
  } else {
    aimAngle = facing > 0 ? 0 : PI;
    aimX = facing;
    aimY = 0;
  }

  if (grounded) {
    if (!wasGrounded && lastVy > 220) sound(sndLand);
    lastGround = time;
  }
  wasGrounded = grounded;
  lastVy = body.velocity.y;

  // Dash: a short burst the way the child faces. Rides the stun window, which
  // already keeps the stick from overriding the velocity, plus a short cooldown.
  if (tap(B_DASH) && !aiming && time > stunUntil + 400) {
    stunUntil = time + 160;
    p.setVelocityX(facing * 420);
  }

  if (time > stunUntil) {
    const dir = aiming ? 0 : hx;
    p.setVelocityX(dir * RUN);
    if (dir) facing = dir;
  }

  if (tap(B_JUMP)) jumpPressedAt = time;
  if (time - jumpPressedAt < 120 && time - lastGround < 110) {
    p.setVelocityY(-JUMP);
    jumpPressedAt = lastGround = NEVER;
    sound(sndJump);
  }
  if (untap(B_JUMP) && body.velocity.y < 0) p.setVelocityY(body.velocity.y * 0.45);

  // Double-tap down to drop through a wooden beam.
  if (tap(B_DOWN) && !aiming) {
    const under = body.bottom + 1;
    if (time - downAt < 300 && grounded && (tileAt(body.x, under) === BEAM || tileAt(body.right - 1, under) === BEAM)) {
      dropRow = floor(under / T);
      dropUntil = time + 600;
      downAt = lastGround = NEVER;
      p.setVelocityY(60);
    } else downAt = time;
  }
  if (body.y > dropRow * T || time > dropUntil) dropRow = -1;

  gliding = equipped === UMBRELLA && !grounded && down(B_JUMP) && body.velocity.y > 0;
  if (gliding) p.setVelocityY(min(body.velocity.y, GLIDE_FALL));

  if (tap(B_PREV)) cycleTool(-1);
  if (tap(B_NEXT)) cycleTool(1);

  p.setFlipX(facing < 0);
  const running = grounded && abs(body.velocity.x) > 5;
  p.play(grounded ? (running ? 'run' : 'idle') : 'jump', true);
  if (running && (stepTimer -= dt) <= 0) {
    stepTimer = 0.28;
    sound(sndStep);
  }

  p.setAlpha(time < invulnUntil && floor(time / 70) % 2 ? 0.3 : 1);

  for (const s of shrines) {
    if (abs(p.x - s.x) < 18 && abs(p.y - s.y) < 24) {
      if (!s.li) lightShrine(s);
      checkpoint = s;
      hearts = MAX_HEARTS;
    }
  }

  // Is the child inside stage box (in tiles)?
  const tx = p.x / T;
  const ty = p.y / T;
  const at = (x0, x1, y0, y1) => tx > x0 && tx < x1 && ty > y0 && ty < y1;
  if (at(27 + OX, 34 + OX, 0, H)) hint('v', 'Un velo de sombra viva. Alumbralo con la linterna.');
  if (found.has(CROWBAR) && at(40 + OX, 48 + OX, 20, 27) && crackedAt.has(45 + OX + ',26')) hint('f', 'El piso aqui esta agrietado...');

  // Free-aim reticle.
  reticle
    .setVisible(aiming)
    .setPosition(p.x + cos(aimAngle) * 42, p.y - 12 + sin(aimAngle) * 42)
    .setRotation(aimAngle)
    .setAlpha(0.55 + 0.35 * sin(time / 110));

  if (!boss && bellZone.contains(p.x, p.y - 10)) silbonIntro();
}

function updatePickups(time) {
  const bars = dropBars.clear();
  for (const item of [...pickups.getChildren()]) {
    const left = item.ex - time;
    const urgent = left < 2000;
    if (item.gw) {
      const flash = urgent && floor(time / 80) % 2;
      item.gw.setPosition(item.x, item.y).setScale(0.78 + 0.05 * sin(time / 240 + item.y * 0.11)).setAlpha((0.22 + 0.1 * sin(time / 190 + item.x * 0.13)) * (urgent ? (flash ? 0.5 : 1) : 1));
    }
    if (!item.ex) item.setAlpha(1);
    else if (left <= 0) reclaim(item);
    else {
      item.setAlpha(urgent && floor(time / 80) % 2 ? 0.25 : 1);
      bars.fillStyle(0, 0.8).fillRect(item.x - 11, item.y - 16, 22, 4);
      bars.fillStyle(urgent ? 0xff1a1a : 0xffffff, 1).fillRect(item.x - 10, item.y - 15, 20 * (left / dropTime()), 2);
    }
  }
}

function updateRainSplashes() {
  for (let i = 0; i < 4; i++) {
    const x = cam.scrollX + random() * SCREEN_W;
    const top = max(0, floor(cam.scrollY / T));
    for (let ty = top; ty < min(H, top + 31); ty++) {
      if (floorAt(x, ty * T + 1)) {
        splashFx.emitParticleAt(x, ty * T, 2);
        break;
      }
    }
  }
}

function updateDarkness(time) {
  const sx = cam.scrollX;
  const sy = cam.scrollY;
  const dark = darkness;
  const flash = stormLevel;
  const light = (x, y, r, alpha = 1) => {
    if (x + r > sx && x - r < sx + SCREEN_W && y + r > sy && y - r < sy + SCREEN_H) dark.stamp('light', null, x - sx, y - sy, { scale: r / 64, alpha, erase: true });
  };

  dark.clear();
  dark.fill(0, max(0.32, min(0.95, BASE_DARK + night * 0.03) * (boss ? 0.6 : 1) * (1 - 0.93 * min(1, flash * 1.4))));

  const p = player;
  // The dark pool hides the scenery around the child; only a tight reveal
  // at his feet lets him (and the bricks under him) read through.
  darkPool.setPosition(p.x, p.y - 10).setVisible(!dead);
  if (!dead) light(p.x, p.y - 12, 80);
  auraGlow.setPosition(p.x, p.y - 12).setVisible(!dead);
  for (const l of lights) {
    const f = l.fl ? 0.9 + sin(time / 90 + l.x) * 0.05 + random() * 0.05 : 1;
    light(l.x, l.y, l.r * f);
    if (l.gw) l.gw.setAlpha(0.06 * f + flash * 0.05);
  }
  for (const item of pickups.getChildren()) {
    light(item.x, item.y, 44, 0.5);
    light(item.x, item.y, 27, 1);
  }

  const c = lightCone;
  coneGlow.setVisible(!!c);
  if (c) {
    // The cone texture is 256px long with a 0.42 rad half-angle; stretch it to fit.
    const scaleX = c.range / 256;
    const scaleY = scaleX * (tan(c.half) / tan(0.42));
    dark.stamp('cone', null, c.x - sx, c.y - sy, { originX: 0, originY: 0.5, scaleX, scaleY, rotation: c.angle, alpha: flicker, erase: true });
    coneGlow
      .setPosition(c.x, c.y)
      .setScale(scaleX, scaleY)
      .setRotation(c.angle)
      .setAlpha((focus ? 0.2 : 0.12) * flicker);
  }
}

// He was behind you the whole time. The far-off whistle, the castle coming down, then the ruins.
function silbonIntro() {
  const p = player;
  cutscene = true;
  stopMusic();
  whistle(0.03, 48, 0.4);
  showMessage('Un silbido lejano, muy lejano... el esta aqui.', 4000);

  const side = p.x > bellSprite.x ? -1 : 1;
  const ghost = image(stage, p.x + side * 70, 9 * T, 'silbon', 12, 0.5, 1, 0).setFlipX(side > 0).setAlpha(0);
  const eyes = image(stage, ghost.x - side * 2, ghost.y - 42.5, 'eyes', 60).setAlpha(0);
  const flash = whiteout(200);
  fade(stage, [ghost, eyes], 1, 900, 3000);
  later(3000, () => glitch.hi(0.8));

  later(4600, () => {
    cam.shake(2200, 0.02);
    fade(stage, flash, 1, 1400, 700);
    for (const d of [0, 500, 1000, 1500]) {
      later(d, () => {
        sound(sndCrumble);
        lightning(1);
        for (let i = 0; i < 12; i++) debrisFx.emitParticleAt(cam.scrollX + random() * SCREEN_W, cam.scrollY + random() * SCREEN_H, 6);
      });
    }
  });

  later(7000, () => {
    ghost.destroy();
    eyes.destroy();
    startArena();
    fade(stage, flash, 0, 1200, 0, () => flash.destroy());
  });
}

// Show or hide the llanos skyline and fence the camera to match.
function setRuins(on) {
  const x0 = on ? (ARENA_X + OX) * T : 0;
  for (const l of [hills, grove, forestMid, foreTrees]) l.setVisible(!on);
  cam.setBounds(x0, 0, (on ? W - 2 : W) * T - x0, H * T);
}

// The castle is gone: flat rubble under open sky, and El Silbon.
function startArena() {
  const p = player;
  const physics = stage.physics.add;
  const x0 = (ARENA_X + OX) * T;
  const gy = ARENA_Y * T;
  setRuins(true);
  belfryBell = bellSprite;
  if (!ruinBell) {
    for (const [x, h, a] of [[70, 40, -8], [250, 70, 5], [400, 28, 12], [560, 56, -4]]) {
      stage.add.tileSprite(x0 + x, gy + 4, 20, h, 'pillar').setOrigin(0.5, 1).setDepth(-8).setAngle(a);
    }
    ruinBell = image(stage, x0 + 480, gy + 6, 'bell', -6, 0.5, 1);
  }
  bellSprite = ruinBell;

  checkpoint = { x: x0 + 110, y: gy };
  hearts = MAX_HEARTS;
  respawn();
  facing = 1;

  // Built once; a lost fight hides him and the next visit to the bell brings him back.
  if (!silbon) {
    const s = (silbon = physics.sprite(0, 0, 'silbon', 0));
    s.setOrigin(0.5, 1).setDepth(12).setCollideWorldBounds(true).play('stalk');
    s.body.setSize(10, 42).setOffset(7, 14);
    s.ey = image(stage, 0, 0, 'eyes', 60);
    bones = physics.group();
    physics.collider(s, layer);
    physics.collider(bones, layer, (bone) => bone.destroy());
    physics.overlap(p, s, () => !s.dy && hurt(s.x));
    physics.overlap(p, bones, (_, bone) => hurt(bone.x) && bone.destroy());
  }
  const b = (boss = silbon);
  b.setPosition(x0 + 520, gy - 1).setVelocity(0, 0);
  showBoss(true);
  b.hp = BOSS_HP;
  b.md = 'walk';
  b.na = clock() + 3500;

  bigText('EL SILBON');
  later(2200, () => bigText(''));
  later(1800, () => {
    cutscene = false;
    startMusic();
  });
}

function showBoss(on) {
  const b = silbon;
  b.setVisible(on);
  b.ey.setVisible(on);
  b.body.enable = on;
}

// He won: the castle stands again and the child wakes a few steps short of the bell.
function leaveArena() {
  boss = null;
  thrown = false;
  showBoss(false);
  bones.clear(true, true);
  for (const i of [...pickups.getChildren()]) if (i.tc === REVOLVER) i.destroy();
  inventory.delete(REVOLVER);
  found.delete(REVOLVER);
  if (equipped === REVOLVER) equipped = TOOLS.find((t) => inventory.has(t)) || null;
  bellSprite = belfryBell;
  setRuins(false);
  checkpoint = { x: (124 + OX) * T, y: 9 * T };
  whistle(0.14, 76);
}

// Walks you down, then either lunges or scatters bones from his sack.
function updateBoss(time) {
  const b = boss;
  if (!b || b.dy) return;
  const dx = player.x - b.x;
  const dir = sign(dx) || 1;
  const rage = b.hp <= BOSS_HP / 2;
  const walk = (ms) => {
    b.md = 'walk';
    b.na = time + ms;
  };
  if (cutscene || dead) {
    b.setVelocityX(0);
  } else if (b.md === 'walk') {
    b.setVelocityX(dir * (rage ? 78 : 52) * hard(0.06)).setFlipX(dir < 0);
    if (time > b.na) {
      b.md = 'tell';
      b.lu = abs(dx) < 150 && random() < 0.6;
      b.un = time + (rage ? 420 : 600) / hard();
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
      for (let i = 0; i < (rage ? 4 : 3) + min(night, 3); i++) {
        bones
          .create(b.x, b.y - 40, 'bone')
          .setDepth(13)
          .setScale(1.5)
          .setVelocity((clamp(dx, -300, 300) / 0.8) * (0.6 + i * 0.3), -280 - i * 25)
          .setAngularVelocity(500);
      }
      sound(sndSwing);
      walk(rage ? 1300 : 1900);
    }
  }
  b.anims.timeScale = b.md === 'walk' ? (rage ? 2 : 1) : 0;
  b.ey.setPosition(b.x + (b.flipX ? -2 : 2), b.y - 42.5).setScale(b.md === 'tell' && floor(time / 60) % 2 ? 2 : 1);
}

// A campesino steps out of the rubble: everything stops while he speaks and throws the gun.
function throwRevolver() {
  thrown = cutscene = true;
  bones.clear(true, true);
  const x0 = (ARENA_X + OX) * T;
  const gy = ARENA_Y * T;
  const side = player.x > x0 + 320 ? -1 : 1;
  const x = clamp(player.x + side * 130, x0 + 30, x0 + 610);
  const tx = clamp(x, x0 + 170, x0 + 470);
  const who = image(stage, x, gy, 'campesino', 9, 0.5, 1).setScale(2).setFlipX(side > 0).setAlpha(0);
  const lamp = addLight(x, gy - 30, 80, true, false);
  const words = label(stage, tx, gy - 76, 'EL SIEMPRE SE APARECE POR AQUI, MUCHACHO').setDepth(62);
  const say = [stage.add.rectangle(tx, gy - 76, 328, 16, 0, 0.85).setDepth(61), words];
  glitch.hi(0.5);
  sound(sndCheckpoint);
  fade(stage, who, 1, 300);

  later(1700, () => {
    words.setText('¡TOMA! ¡DISPARALE!');
    sound(sndSwing);
    spawnPickup(REVOLVER, x - side * 12, gy - 40, -side * 150, -300);
  });
  later(2700, () => {
    cutscene = false;
    invulnUntil = clock() + 2500;
    showMessage('¡Dispara con BOTON 1!', 5000);
  });
  fade(stage, [who, ...say], 0, 1000, 5000, () => {
    lights.splice(lights.indexOf(lamp), 1);
    who.destroy();
    say.forEach((o) => o.destroy());
  });
}

function hitBoss(dir) {
  const b = boss;
  b.hp--;
  bleed(b.x, b.y - 30, 18);
  sound(sndFlesh);
  flashRed(b);
  if (b.md !== 'lunge') b.setVelocity(dir * 120, -90);
  pulseHud();
  if (b.hp > 0) return;

  b.dy = true;
  b.body.enable = false;
  earn(500);
  b.anims.stop();
  bones.clear(true, true);
  bleed(b.x, b.y - 28, 90, 6);
  sound(sndDie);
  whistleNotes([83, 79, 76, 72, 67, 60, 48], 0, 0.22, 0.3, 0.1, 0.03);
  jolt(500, 0.015, 1);
  fade(stage, [b, b.ey], 0, 1600);
  stage.tweens.add({ targets: b, scaleY: 0.1, duration: 1600 });
  later(2400, () => win());
}

function win() {
  won = true;
  player.setVelocity(0, 0);
  // Clearing the night, plus whatever is left of ten minutes.
  earn(1000 + max(0, 600 - (clock() - nightStart) / 1000) * 5);
  night++;
  saveScore();
  sound(sndGreatBell);
  jolt(1200, 0.01, 1);
  stage.tweens.add({ targets: bellSprite, angle: { from: -14, to: 14 }, duration: 1100, yoyo: true, repeat: 2, ease: 'Sine.inOut' });
  for (const d of [0, 700, 1500, 2300]) later(d, () => lightning(1));

  fade(stage, whiteout(200), 1, 2200, 2600);
  [
    label(stage, SCREEN_W / 2, SCREEN_H / 2 - 22, 'SUENA LA CAMPANA.', 0, 4),
    label(stage, SCREEN_W / 2, SCREEN_H / 2 + 18, 'LA LLUVIA TE OLVIDA... POR AHORA', 0x8a0010),
  ].forEach((t, i) => fade(stage, t.setScrollFactor(0).setDepth(201).setAlpha(0), 1, 1200, 4800 + i * 1200));
  later(11000, () => nextScene('Game'));
}

// Fade out into another scene: the next night, or the title once the run is over.
function nextScene(key, ms = 1500) {
  cam.fadeOut(ms);
  cam.once('camerafadeoutcomplete', () => stage.scene.start(key));
}

const GameScene = {
  key: 'Game',

  create() {
    stage = this;
    world = buildWorld();
    crackedAt = new Map(); // "x,y" -> sprite
    lights = []; // static light sources {x, y, r, flicker, glow}
    decals = [];
    hintsShown = new Set();
    dead = won = gliding = aiming = thrown = false;
    cutscene = false; // the child stands frozen
    hearts = MAX_HEARTS;
    inventory = new Set([FLASHLIGHT]);
    found = new Set([FLASHLIGHT]);
    equipped = FLASHLIGHT;
    facing = flicker = aimX = 1;
    invulnUntil = stunUntil = lastGround = dropUntil = attackCooldown = swingUntil = stepTimer = aimAngle = aimY = 0;
    jumpPressedAt = downAt = NEVER;
    dropRow = -1; // beam row being dropped through
    boss = silbon = ruinBell = null;

    cam = stage.cameras.main;
    glitch = addCameraFx(cam, 0.04);
    startStorm(4000 / hard(), 10000 / hard(), 0.35);
    nightStart = clock();
    cam.fadeIn(900);

    hills = backdrop('hills', 0, -22);
    grove = backdrop('grove', 0, -21);
    forestMid = backdrop('forestmid', 0, -24);
    foreTrees = backdrop('foretrees', 0, 60);
    buildTilemaps();
    buildFx();
    buildEntities();
    buildPlayer();
    buildDarkness();

    // The HUD lives in its own scene so the darkness, vignette and glitch
    // filters never dim it. It fades out on its own when nothing changes.
    hud = stage.scene.get('Hud');
    stage.scene.launch('Hud');
    stage.events.once('shutdown', () => stage.scene.stop('Hud'));

    // Ignore whatever was pressed on the title screen.
    clearTaps();

    stage.physics.world.setBounds(0, 0, W * T, H * T);
    cam.setBounds(0, 0, W * T, H * T);
    cam.startFollow(player, true, 0.12, 0.12, 0, 30);

    // The legend: when the whistle sounds close, El Silbon is far away.
    later(5200, () => {
      whistle(0.14, 76);
      hint('w', 'Un silbido... dicen que si suena cerca, el esta lejos.', 4500);
    });
    later(900, () => {
      if (!night) return;
      bigText('NOCHE ' + (night + 1));
      later(2200, () => bigText(''));
    });
  },

  update(time, delta) {
    const dt = min(delta, 50) / 1000;

    // START freezes the world; the Pause scene resumes it on the next press.
    if (tap('START1') || tap('START2')) {
      stage.scene.launch('Pause');
      stage.scene.pause();
      stage.scene.pause('Hud');
      return;
    }

    updatePlayer(dt, time);
    updateTools(dt, time);
    // Dread: the picture breaks up as monsters close in, and a little when empty-handed.
    let nearest = Infinity;
    for (const m of monsters()) {
      if (m.dy) continue;
      m.br = max(0, m.br - dt);
      if (m.tl) updateShade(m, dt, time);
      else updateBat(m, dt, time);
      nearest = min(nearest, hypot(m.x - player.x, m.y - player.y));
    }
    glitch.bj = 0.04 + max(0, 1 - nearest / 140) * 0.14 + (equipped ? 0 : 0.03);
    updateBoss(time);
    for (const v of veils) {
      v.tilePositionY -= dt * 20;
      v.tilePositionX = sin(time / 300) * 3;
      v.ht = max(0, (v.ht || 0) - dt);
      v.setAlpha(0.35 + 0.65 * v.sn * (v.ht > 0 ? 0.6 + random() * 0.4 : 1));
    }
    updatePickups(time);
    updateRainSplashes();
    updateStorm(dt);
    // Parallax: the woods cross-fade into the open llanos as the child walks east.
    const forest = 1 - min(1, max(0, (player.x - (OX - 4) * T) / (14 * T)));
    hills.tilePositionX = cam.scrollX * 0.1;
    hills.y = 10 - cam.scrollY * 0.06;
    grove.tilePositionX = cam.scrollX * 0.25;
    grove.y = 21 - cam.scrollY * 0.15;
    forestMid.tilePositionX = cam.scrollX * 0.5;
    foreTrees.tilePositionX = cam.scrollX * 1.35;
    hills.setAlpha(1 - forest);
    grove.setAlpha(1 - forest);
    forestMid.setAlpha(forest);
    foreTrees.setAlpha(forest);

    // On the flat approach the camera holds still vertically, so the woods do
    // not lurch every time the child jumps; the cerro resumes the follow.
    const flat = player.x < (OX + 34) * T;
    if (flat !== flatCam) {
      flatCam = flat;
      cam.setDeadzone(flat ? 1 : 0, flat ? 600 : 0);
    }

    // The storm is muffled inside the cave and inside the church.
    const indoors =
      (player.x > (34 + OX) * T && player.x < (89 + OX) * T && player.y > CAVE_Y * T) ||
      (player.x > (106 + OX) * T && player.y < CAVE_Y * T);
    if (indoors !== wasIndoors) {
      wasIndoors = indoors;
      setRainVolume(indoors ? 0.5 : 1);
    }

    glitch.tk(dt);
    updateDarkness(time);

    // HUD text shivers with the glitch.
    if (msg) {
      const amount = glitch.an;
      msg.x = SCREEN_W / 2 + (random() < amount ? between(-4, 4) : 0);
      bigLabel.x = SCREEN_W / 2 + between(-6, 6) * amount;
    }
  },
};

// Heads-up display, rendered in its own unfiltered scene so the darkness,
// vignette and glitch never wash it out. It reads the live game state and fades
// away when nothing has changed for a while.
let hud, heartIcons, bossHearts, slotGfx, slotIcons, slotUnknown, toolLabel, scoreLabel, panel, msgBg, msg, bigLabel, hideAt;

const pulseHud = () => (hideAt = hud.time.now + HUD_LINGER);
const bigText = (text) => bigLabel.setText(text);
function showMessage(text, ms = 3500) {
  const both = [msg.setText(text.toUpperCase()).setAlpha(1), msgBg.setAlpha(1)];
  hud.tweens.killTweensOf(both);
  fade(hud, both, 0, 600, ms);
}

const HudScene = {
  key: 'Hud',

  create() {
    hud = this;
    const row = (n, x, y = 14) => Array.from({ length: n }, (_, i) => hud.add.image(x + i * 18, y, 'heart', 0).setScale(2));
    const slotX = (i) => SCREEN_W - 114 + i * 28;
    heartIcons = row(MAX_HEARTS, 14);
    bossHearts = row(BOSS_HP, SCREEN_W / 2 - 45, 40);
    slotGfx = hud.add.graphics();
    slotIcons = TOOLS.map((t, i) => hud.add.image(slotX(i), 16, 'tool_' + t));
    slotUnknown = TOOLS.map((_, i) => label(hud, slotX(i), 16, '?', 0x8a8a8a));
    toolLabel = label(hud, SCREEN_W - 12, 34, '').setOrigin(1, 0);
    scoreLabel = label(hud, SCREEN_W / 2, 16, '', undefined, 2);
    panel = hud.add.container(0, 0, [...heartIcons, slotGfx, ...slotIcons, ...slotUnknown, ...bossHearts, toolLabel, scoreLabel]);
    msgBg = hud.add.rectangle(0, SCREEN_H - 32, SCREEN_W, 20, 0, 0.8).setOrigin(0).setAlpha(0);
    msg = label(hud, SCREEN_W / 2, SCREEN_H - 22, '').setAlpha(0);
    bigLabel = label(hud, SCREEN_W / 2, SCREEN_H / 2, '', 0xff1a1a, 4);
    pulseHud();
  },

  update(time, delta) {
    if (!player) return;

    const gr = slotGfx.clear();
    const dropped = pickups.getChildren().filter((i) => i.ex).map((i) => i.tc);
    const b = boss && !boss.dy && boss;
    if (b) pulseHud();
    heartIcons.forEach((h, i) => h.setFrame(hearts - i >= 1 ? 0 : hearts > i ? 2 : 1));
    bossHearts.forEach((h, i) => h.setVisible(!!b).setFrame(b && i < b.hp ? 0 : 1));
    TOOLS.forEach((t, i) => {
      const x = SCREEN_W - 126 + i * 28;
      const eq = equipped === t;
      const known = found.has(t);
      // The revolver's slot stays hidden until it is thrown to you.
      const shown = i < 3 || known;
      slotUnknown[i].setVisible(shown && !known);
      slotIcons[i].setVisible(known).setAlpha(inventory.has(t) ? 1 : dropped.includes(t) && !(floor(time / 150) % 2) ? 0.65 : 0.3);
      if (shown) gr.fillStyle(0x0a0d12, 0.92).fillRect(x, 4, 24, 24).lineStyle(eq ? 2 : 1, eq ? 0xff2a2a : 0xc8d0d8, 1).strokeRect(x, 4, 24, 24);
    });
    scoreLabel.setText(`${score}${night ? ' NOCHE ' + (night + 1) : ''}`);
    toolLabel.setText(TOOL_NAMES[equipped || 0]).setTint(equipped ? 0xffffff : 0xff3b3b);

    // Fade the panel out once the linger window lapses.
    panel.alpha += ((time < hideAt ? 1 : 0) - panel.alpha) * min(1, delta / 160);
  },
};

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game-root',
  width: SCREEN_W,
  height: SCREEN_H,
  pixelArt: true,
  roundPixels: true,
  pipeline: { Glitch: GlitchPipeline },
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 900 } },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, TitleScene, GameScene, HudScene, PauseScene],
});
})();
