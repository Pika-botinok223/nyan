/* Paperboy - game logic. Uses only window.Sprites and window.Sfx (see CONTRACT.md). */
(function () {
'use strict';

// ---------------------------------------------------------------- constants
const W = 256, H = 240, STEP = 1000 / 60;
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const NH = 20;                 // houses per day
const SPACING = 144;           // world px between house tops
const HOUSE_W = 96, HOUSE_H = 80;
const FIRST_TOP = 3000;        // world y of the first (nearest to start) house top
const START_Y = FIRST_TOP + HOUSE_H + 190;
const END_Y = FIRST_TOP - (NH - 1) * SPACING - 120;
const PSY = 150;               // player's screen y (top of sprite)
const SIDE_X = 136, SIDE_W = 32, CURB_X = 168, ROAD_X = 172;
const PX_MIN = 100, PX_MAX = 240;
const LANES = [182, 224];
const MAILBOX_X = SIDE_X - 12;
const GRAV = 0.07;
const HI_KEY = 'paperboy_hi_v1';

const COL = { ok: '#3ddc5a', missed: '#ff9a2e', broken: '#ff3b3b', non: '#6b6b7a', won: '#35d0ff' };

// obstacle definitions: w,h sprite size; hb = [inset x, inset top, inset bottom]; pz = paper blocked if z < pz
const OB = {
  hydrant:  { s: 'hydrant',  w: 8,  h: 10, hb: [1, 3, 0], pz: 7 },
  trashcan: { s: 'trashcan', w: 10, h: 12, hb: [1, 3, 0], pz: 9 },
  tree:     { s: 'tree',     w: 24, h: 32, hb: [5, 14, 0], pz: 99 },
  bush:     { s: 'bush',     w: 16, h: 12, hb: [1, 3, 0], pz: 9 },
  fence:    { s: 'fence',    w: 16, h: 8,  hb: [0, 1, 0], pz: 6 },
  car:      { s: 'car',      w: 20, h: 32, hb: [2, 4, 3], pz: 99 },
  dog:      { s: 'dog',      w: 16, h: 12, hb: [2, 3, 1], pz: 99 },
  skater:   { s: 'skater',   w: 12, h: 20, hb: [2, 5, 1], pz: 99 },
  worker:   { s: 'worker',   w: 12, h: 20, hb: [2, 5, 1], pz: 99 }
};
const FALLBACK = { paperboy: [16, 24], paperboy_throw: [16, 24], paperboy_crash: [24, 24], paper: [8, 8],
  paper_bundle: [12, 10], house_sub: [96, 80], house_nonsub: [96, 80], window: [10, 10], window_broken: [10, 10],
  door: [12, 16], mailbox: [8, 12], mailbox_hit: [8, 12], mailbox_broken: [8, 12], logo: [160, 40],
  icon_paper: [8, 8], icon_life: [8, 8], icon_house: [8, 8], grass: [16, 16], grass_dead: [16, 16],
  sidewalk: [16, 16], road: [16, 16], road_line: [16, 16], curb: [4, 16], driveway: [16, 16], flowers: [16, 16] };

// ---------------------------------------------------------------- helpers
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pad = (n, l) => { let s = String(Math.max(0, Math.floor(n))); while (s.length < l) s = '0' + s; return s; };
const ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// ---- defensive sprite layer: never throws; missing sprite -> magenta rect
const sizeCache = {};
const warned = {};
function warnOnce(msg) { if (!warned[msg]) { warned[msg] = 1; try { console.warn('[paperboy] ' + msg); } catch (e) { /* */ } } }
function sizeOf(name) {
  if (name in sizeCache) return sizeCache[name];
  let r = null;
  try { const s = window.Sprites && window.Sprites.size(name); if (s && s.w > 0 && s.h > 0) r = s; } catch (e) { r = null; }
  if (!r) warnOnce('missing sprite: ' + name);
  sizeCache[name] = r;
  return r;
}
function spr(name, x, y, frame, flip) {
  x = Math.round(x); y = Math.round(y);
  const sz = sizeOf(name);
  if (!sz) { const f = FALLBACK[name] || (OB[name] && [OB[name].w, OB[name].h]) || [8, 8]; ctx.fillStyle = '#f0f'; ctx.fillRect(x, y, f[0], f[1]); return; }
  try { window.Sprites.draw(ctx, name, x, y, frame | 0, !!flip); } catch (e) { warnOnce('draw failed: ' + name); ctx.fillStyle = '#f0f'; ctx.fillRect(x, y, sz.w, sz.h); }
}
function txt(s, x, y, color, scale, align, shadow) {
  s = String(s); color = color || '#fff'; scale = scale || 1; align = align || 'left';
  x = Math.round(x); y = Math.round(y);
  try {
    if (shadow !== false) window.Sprites.drawText(ctx, s, x + scale, y + scale, '#000', scale, align);
    window.Sprites.drawText(ctx, s, x, y, color, scale, align);
  } catch (e) {
    warnOnce('drawText failed');
    ctx.fillStyle = color; ctx.font = (7 * scale) + 'px monospace'; ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
    ctx.fillText(s, x, y + 7 * scale); ctx.textAlign = 'left';
  }
}
function tw(s, scale) { try { return window.Sprites.textWidth(String(s), scale || 1); } catch (e) { return String(s).length * 6 * (scale || 1); } }

// ---- audio wrappers (all safe)
let audioReady = false, wantedMusic = null;
function sfx(n) { try { if (window.Sfx) window.Sfx.play(n); } catch (e) { /* */ } }
function music(t) { wantedMusic = t; if (!audioReady) return; try { if (window.Sfx) { if (t) window.Sfx.music(t); else window.Sfx.stopMusic(); } } catch (e) { /* */ } }
function audioInit() {
  if (audioReady) return;
  try { if (window.Sfx) window.Sfx.init(); } catch (e) { /* */ }
  audioReady = true;
  if (wantedMusic) music(wantedMusic);
}
function isMuted() { try { return !!(window.Sfx && window.Sfx.muted); } catch (e) { return false; } }
function toggleMute() { try { if (window.Sfx) window.Sfx.toggleMute(); } catch (e) { /* */ } G.muteMsg = 100; }

function loadHi() { try { return parseInt(localStorage.getItem(HI_KEY), 10) || 0; } catch (e) { return 0; } }
function saveHi(v) { try { localStorage.setItem(HI_KEY, String(v)); } catch (e) { /* */ } }

// ---------------------------------------------------------------- house meta
const hTop = (i) => FIRST_TOP - i * SPACING;
let META = null;
function houseMeta() {
  const d = { windows: [{ x: 50, y: 12, w: 10, h: 10 }, { x: 72, y: 12, w: 10, h: 10 }],
    door: { x: 68, y: 60, w: 12, h: 16 }, porch: { x: 58, y: 64, w: 34, h: 16 } };
  let m = null;
  try { m = window.Sprites.meta && window.Sprites.meta.house; } catch (e) { m = null; }
  if (!m) { warnOnce('Sprites.meta.house missing, using defaults'); m = d; }
  const r = { windows: (m.windows && m.windows.length ? m.windows : d.windows).slice(0, 2), door: m.door || d.door, porch: m.porch || d.porch };
  r.mbY = pickMailboxLane(r);
  return r;
}
// choose a vertical lane (relative to house top) for the mailbox whose paper-hit band overlaps the porch/door/windows the least
function pickMailboxLane(r) {
  const bands = [[r.porch.y - 3, r.porch.y + r.porch.h + 3, 3], [r.door.y - 3, r.door.y + r.door.h + 3, 3]];
  for (const w of r.windows) bands.push([w.y - 3, w.y + w.h + 3, 1]);
  let best = 76, bestC = 1e9;
  for (let y = 0; y <= 76; y += 2) {
    const lo = y - 4, hi = y + 16;
    let c = 0;
    for (const b of bands) c += Math.max(0, Math.min(hi, b[1]) - Math.max(lo, b[0])) * b[2];
    if (c <= bestC) { bestC = c; best = y; }
  }
  return best;
}

// ---------------------------------------------------------------- game state
const G = {
  state: 'title', stateT: 0, t: 0,
  day: 0, score: 0, lives: 3, papers: 10, nextLife: 10000, hi: loadHi(), newHi: false,
  houses: [], obs: [], bundles: [], pap: [], parts: [], pops: [],
  p: null, cam: START_Y - PSY, demoCam: START_Y - PSY,
  phase: 'play', phaseT: 0, paused: false, shake: 0, banner: null, carT: 100,
  muteMsg: 0, overReason: '', summary: null, hint: 0, flash: 0
};
const act = { confirm: false, throw: false, pause: false };
const held = { left: false, right: false, up: false, down: false };
const vheld = { left: false, right: false, up: false, down: false };

function newPlayer() {
  return { x: 148, y: START_Y, vx: 0, speed: 0.6, anim: 0, throwT: -1, throwCd: 0, invuln: 0, noPapMsg: 0 };
}

function initHouses() {
  const idx = shuffle(Array.from({ length: NH }, (_, i) => i));
  const subs = new Set(idx.slice(0, 10));
  G.houses = [];
  for (let i = 0; i < NH; i++) G.houses.push({ sub: subs.has(i), wasCancelled: false });
  resetHousesDaily();
}
function resetHousesDaily() {
  for (const h of G.houses) {
    h.win = [true, true]; h.mb = 'ok'; h.porchPaper = false; h.delivered = false; h.brokeSub = false;
    h.status = h.sub ? 'pending' : 'non';
  }
}
const subCount = () => G.houses.reduce((n, h) => n + (h.sub ? 1 : 0), 0);
const deliveredCount = () => G.houses.reduce((n, h) => n + (h.sub && h.delivered ? 1 : 0), 0);

function difficulty() { return G.day; }
function baseSpeed() { return 1.0 + 0.09 * G.day; }
function maxSpeed() { return 1.95 + 0.12 * G.day; }

// ---------------------------------------------------------------- day setup
function buildDay() {
  META = houseMeta();
  const d = G.day;
  resetHousesDaily();
  G.obs = []; G.bundles = []; G.pap = []; G.parts = []; G.pops = []; G.banner = null;
  G.papers = Math.max(G.papers, 10);
  G.p = newPlayer();
  G.cam = G.p.y - PSY;
  G.phase = 'play'; G.phaseT = 0; G.shake = 0; G.hint = 420;
  G.carT = ri(110, 200);

  const slots = [];
  for (let y = FIRST_TOP + HOUSE_H + 70; y > END_Y + 60; y -= 96) slots.push(y + ri(-14, 14));
  const used = new Set();
  // bundles spread across the route
  const subs = subCount();
  const need = subs + 3;
  let nb = Math.max(2, Math.ceil((need - Math.max(G.papers, 10)) / 10) + 1);
  nb = Math.min(nb, 6);
  for (let k = 0; k < nb; k++) {
    const idx = Math.min(slots.length - 1, Math.floor((k + 0.55) * slots.length / (nb + 0.2)));
    used.add(idx);
    G.bundles.push({ x: ri(138, 152), y: slots[idx], w: 12, h: 10, got: false });
  }
  // sidewalk / moving obstacles
  const pObs = 0.28 + 0.055 * d;
  const table = [['hydrant', 3], ['trashcan', 3], ['skater', 1 + (d >= 1 ? 1 : 0)], ['dog', d >= 1 ? 2 : 0], ['worker', d >= 2 ? 2 : 0]];
  const total = table.reduce((n, e) => n + e[1], 0);
  for (let i = 0; i < slots.length; i++) {
    if (used.has(i) || Math.random() > pObs) continue;
    let r = Math.random() * total, type = 'hydrant';
    for (const e of table) { if ((r -= e[1]) < 0) { type = e[0]; break; } }
    addObstacle(type, slots[i]);
  }
  // lawn obstacles in the gaps between houses
  const pLawn = 0.3 + 0.07 * d;
  for (let g = 0; g <= NH - 2; g++) {
    if (Math.random() > pLawn) continue;
    const cy = hTop(g) - 32;
    const t = pick(['tree', 'tree', 'bush', 'bush', 'fence']);
    if (t === 'tree') addObstacle('tree', cy - 16, ri(100, 106));
    else if (t === 'bush') addObstacle('bush', cy - 6, ri(104, 116));
    else { addObstacle('fence', cy - 4, 100); addObstacle('fence', cy - 4, 116); }
  }
}
function addObstacle(type, y, x) {
  const o = { t: type, x: 0, y: y, vx: 0, vy: 0, active: false, anim: 0, age: 0, dir: Math.random() < 0.5 ? -1 : 1 };
  switch (type) {
    case 'hydrant': o.x = x != null ? x : ri(138, 158); break;
    case 'trashcan': o.x = x != null ? x : ri(138, 156); break;
    case 'skater': o.x = 150; o.base = ri(146, 156); o.ph = rnd(0, 6.28); break;
    case 'worker': o.x = ri(140, 152); break;
    case 'dog': o.x = 104; o.state = 'idle'; o.flip = false; o.barkT = 0; break;
    default: o.x = x != null ? x : 108; break;
  }
  G.obs.push(o);
  return o;
}
function hbOf(o) {
  const d = OB[o.t];
  return { x: o.x + d.hb[0], y: o.y + d.hb[1], w: d.w - 2 * d.hb[0], h: d.h - d.hb[1] - d.hb[2] };
}

// ---------------------------------------------------------------- effects
function burst(x, y, n, cols, sp, g, life, size) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, s = Math.random() * sp;
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - sp * 0.4, g: g || 0.06, life: life + ri(-6, 6), max: life, c: pick(cols), s: size || 1 });
  }
}
function popup(x, y, text, color) { G.pops.push({ x, y, text, color: color || '#fff', t: 0, life: 70 }); }
function banner(text, color, frames) { G.banner = { text, color: color || '#ffd84a', t: frames || 100, max: frames || 100 }; }
function addScore(n) {
  G.score += n;
  while (G.score >= G.nextLife) {
    G.nextLife += 10000;
    if (G.lives < 9) G.lives++;
    sfx('extra_life'); banner('EXTRA LIFE!', '#7dff8a', 100);
  }
}

// ---------------------------------------------------------------- paper
function winRect(i, k) { const w = META.windows[k]; return { x: w.x, y: hTop(i) + w.y, w: w.w, h: w.h }; }
function offRect(i, r) { return { x: r.x, y: hTop(i) + r.y, w: r.w, h: r.h }; }
function mailRect(i) { return { x: MAILBOX_X, y: hTop(i) + META.mbY, w: 8, h: 12 }; }

function spawnPaper() {
  const P = G.p;
  G.pap.push({ x: P.x + 3, y: P.y + 10, vx: -3.2 + P.vx * 0.5, vy: -P.speed, z: 8, vz: 1.1, age: 0, rest: false, bounced: false, gone: 0, fade: false });
  sfx('throw');
}
function restPaper(p, snd) {
  p.rest = true; p.vx = p.vy = 0; p.z = 0; p.vz = 0; p.restT = 0;
  if (snd) sfx(snd);
}
function vanishPaper(p) { p.rest = true; p.vx = p.vy = 0; p.fade = true; p.gone = 14; p.z = 0; }
function porchDeliver(i, p) {
  const h = G.houses[i];
  if (h.sub && !h.porchPaper) {
    h.porchPaper = true; h.delivered = true; addScore(100);
    popup(p.x, p.y - 8, '+100', '#ffd84a'); restPaper(p, 'porch');
    burst(p.x, p.y, 5, ['#fff', '#ffe27a'], 1.2, 0.05, 20);
  } else { restPaper(p, 'bump'); }
}
function paperCollide(p) {
  const r = { x: p.x - 3, y: p.y - 3, w: 6, h: 6 };
  // houses
  if (p.x < HOUSE_W + 6) {
    for (let i = 0; i < NH; i++) {
      const top = hTop(i);
      if (p.y < top - 2 || p.y > top + HOUSE_H + 2) continue;
      const h = G.houses[i];
      let lane = false;
      for (let k = 0; k < META.windows.length; k++) {
        const wr = winRect(i, k);
        if (!h.win[k]) continue;
        if (p.y > wr.y - 3 && p.y < wr.y + wr.h + 3) lane = true;
        const wi = { x: wr.x - 1, y: wr.y - 1, w: wr.w + 2, h: wr.h + 2 };
        if (ov(r, wi)) {
          h.win[k] = false;
          sfx('glass'); G.shake = Math.max(G.shake, 1.5);
          burst(wr.x + 5, wr.y + 5, 14, ['#bfe8ff', '#ffffff', '#7fc4ff', '#e8f6ff'], 2.2, 0.09, 36, 1);
          if (h.sub) { h.brokeSub = true; popup(wr.x, wr.y - 4, 'CANCEL!', '#ff5a5a'); sfx('cancel'); }
          else { addScore(50); popup(wr.x, wr.y - 4, '+50', '#ffd84a'); }
          vanishPaper(p); return true;
        }
      }
      const dr = offRect(i, META.door);
      if (p.y > dr.y - 3 && p.y < dr.y + dr.h + 3) lane = true;
      if (ov(r, dr)) { porchDeliver(i, p); return true; }
      const pr = offRect(i, META.porch);
      if (p.y > pr.y - 3 && p.y < pr.y + pr.h + 3) lane = true;
      if (ov(r, pr)) { porchDeliver(i, p); return true; }
      if (!lane && p.x - 3 <= HOUSE_W - 2) {
        restPaper(p, 'bump'); p.x = HOUSE_W + 1;
        burst(p.x, p.y, 4, ['#fff', '#ddd'], 1.1, 0.05, 14);
        return true;
      }
    }
  }
  // mailboxes
  if (p.x < MAILBOX_X + 14 && p.x > MAILBOX_X - 10) {
    for (let i = 0; i < NH; i++) {
      const mr = mailRect(i);
      if (p.y < mr.y - 20 || p.y > mr.y + 30) continue;
      const mi = { x: mr.x - 1, y: mr.y - 1, w: mr.w + 2, h: mr.h + 2 };
      if (!ov(r, mi)) continue;
      const h = G.houses[i];
      if (h.mb !== 'ok') continue;   // already hit/broken: papers fly past
      {
        if (h.sub) {
          h.mb = 'hit'; h.delivered = true; addScore(250); sfx('mailbox');
          popup(mr.x - 6, mr.y - 6, '+250', '#7dff8a');
          burst(mr.x + 4, mr.y + 2, 10, ['#ffe27a', '#fff', '#ffd84a'], 1.8, 0.04, 26);
          vanishPaper(p);
        } else {
          h.mb = 'broken'; addScore(100); sfx('bump');
          popup(mr.x - 6, mr.y - 6, '+100', '#ffd84a');
          burst(mr.x + 4, mr.y + 6, 8, ['#8b5a2b', '#aaa', '#fff'], 1.8, 0.07, 26);
          vanishPaper(p);
        }
      }
      return true;
    }
  }
  // obstacles
  for (const o of G.obs) {
    if (o.t === 'car') continue;
    if (o.y - p.y > 60 || p.y - o.y > 60) continue;
    if (p.z >= OB[o.t].pz) continue;
    if (ov(r, hbOf(o))) {
      sfx('bump');
      burst(p.x, p.y, 4, ['#fff', '#ddd'], 1.1, 0.05, 14);
      if (o.t === 'dog') { o.state = 'flee'; sfx('bark'); }
      restPaper(p); return true;
    }
  }
  return false;
}
function updatePaper(p) {
  p.age++;
  if (p.fade) { p.gone--; return; }
  if (p.rest) { p.restT++; return; }
  p.x += p.vx; p.y += p.vy;
  p.z += p.vz; p.vz -= GRAV;
  if (paperCollide(p)) return;
  if (p.z <= 0) {
    p.z = 0;
    if (!p.bounced) { p.bounced = true; p.vz = 0.8; p.vx *= 0.45; p.vy *= 0.5; }
    else {
      restPaper(p);
      // resting inside a porch zone still counts
      for (let i = 0; i < NH; i++) {
        const pr = offRect(i, META.porch);
        if (ov({ x: p.x - 2, y: p.y - 2, w: 4, h: 4 }, pr)) { porchDeliver(i, p); break; }
      }
    }
  }
  if (p.x < -12 || p.x > W + 20) { p.fade = true; p.gone = 0; }
}

// ---------------------------------------------------------------- player / crash
function startThrow() {
  const P = G.p;
  if (P.throwCd > 0 || G.phase === 'crash') return;
  if (G.papers <= 0) { if (P.noPapMsg <= 0) { popup(P.x + 8, P.y - 6, 'NO PAPERS!', '#ff5a5a'); P.noPapMsg = 40; } return; }
  P.throwT = 0; P.throwCd = 16;
}
function crash(src) {
  const P = G.p;
  if (P.invuln > 0 || G.phase !== 'play') return;
  G.lives--; G.phase = 'crash'; G.phaseT = 0; P.vx = 0; P.throwT = -1;
  G.shake = 8; sfx('crash');
  burst(P.x + 12, P.y + 16, 12, ['#c9b48a', '#a89066', '#fff', '#8a7a5a'], 2.2, 0.06, 30);
  if (src === 'dog') sfx('bark');
}
function clearAround() {
  const P = G.p;
  G.obs = G.obs.filter((o) => !(o.y > P.y - 90 && o.y < P.y + 50 && o.t !== 'car') && !(o.t === 'car' && o.y > P.y - 80 && o.y < P.y + 60));
}
function respawn() {
  const P = G.p;
  P.x = 148; P.vx = 0; P.speed = 0.5; P.invuln = 150; P.throwT = -1; P.throwCd = 0;
  clearAround(); G.phase = 'play'; G.phaseT = 0;
}

// ---------------------------------------------------------------- update: ride
function updateObstacles() {
  const P = G.p;
  const d = G.day;
  for (let i = G.obs.length - 1; i >= 0; i--) {
    const o = G.obs[i];
    const sy = o.y - G.cam;
    o.age++;
    if (sy > H + 70) { G.obs.splice(i, 1); continue; }
    if (!o.active) {
      if (sy > -60 && (o.t === 'dog' || o.t === 'skater' || o.t === 'worker')) o.active = true;
      else continue;
    }
    switch (o.t) {
      case 'car': {
        o.anim++;
        o.y += o.vy;
        if (o.tx != null) { const dx = o.tx - o.x; if (Math.abs(dx) < 0.8) { o.x = o.tx; o.tx = null; } else o.x += Math.sign(dx) * 0.75; }
        if (!o.honked && sy > -10 && sy < PSY - 40 && P.y > o.y && Math.abs((o.x + 10) - (P.x + 8)) < 34 && G.phase === 'play') {
          o.honked = true; sfx('horn');
          if (Math.random() < 0.5 + 0.07 * d) { o.tx = clamp(P.x + 8 - 10, ROAD_X + 4, W - 24); if (Math.random() < 0.6) sfx('skid'); }
        }
        break;
      }
      case 'dog': {
        o.anim++;
        const dx = (P.x + 4) - o.x;
        if (o.state === 'idle') { o.state = 'chase'; if (Math.abs(sy - PSY) < 220) sfx('bark'); o.barkT = 50; }
        if (o.state === 'chase') {
          const sp = 0.9 + 0.08 * d;
          o.x += clamp(dx * 0.06, -sp, sp);
          o.y += 0.7 + 0.05 * d;
          o.flip = dx < 0;
          o.barkT--;
          if (o.barkT <= 0 && Math.abs(o.y - P.y) < 130 && G.phase === 'play') { sfx('bark'); o.barkT = 80; }
        } else if (o.state === 'flee') { o.x -= 1.6; o.y += 0.3; o.flip = true; }
        break;
      }
      case 'skater': {
        o.anim++;
        o.y += 0.55 + 0.06 * d;
        o.x = o.base + Math.sin(o.age * 0.045 + o.ph) * 14;
        break;
      }
      case 'worker': {
        o.anim++;
        o.x += o.dir * 0.2;
        if (o.x < 138) o.dir = 1; else if (o.x > 156) o.dir = -1;
        break;
      }
      default: break;
    }
  }
}
function spawnCar() {
  const lane = Math.random() < 0.5 ? 0 : 1;
  const y = G.cam - 40 - 32;
  for (const o of G.obs) if (o.t === 'car' && Math.abs(o.x - LANES[lane]) < 12 && Math.abs(o.y - y) < 100) return;
  const o = addObstacle('car', y);
  o.x = LANES[lane]; o.vy = rnd(0.7, 1.3) + 0.12 * G.day; o.active = true; o.honked = false; o.tx = null;
  if (G.day >= 1 && Math.random() < 0.2) o.tx = LANES[1 - lane];
}

function updateRide() {
  const P = G.p;
  G.t++;
  if (G.hint > 0) G.hint--;
  if (G.banner && --G.banner.t <= 0) G.banner = null;
  if (P.throwCd > 0) P.throwCd--;
  if (P.noPapMsg > 0) P.noPapMsg--;
  if (P.invuln > 0) P.invuln--;
  const L = held.left || vheld.left, R = held.right || vheld.right, U = held.up || vheld.up, D = held.down || vheld.down;

  if (G.phase === 'play') {
    // steering
    const ms = 2.0 + 0.05 * G.day;
    if (L && !R) P.vx -= 0.2; else if (R && !L) P.vx += 0.2; else P.vx *= 0.78;
    P.vx = clamp(P.vx, -ms, ms);
    P.x += P.vx;
    if (P.x < PX_MIN) { P.x = PX_MIN; P.vx = 0; } else if (P.x > PX_MAX) { P.x = PX_MAX; P.vx = 0; }
    // speed
    let tgt = baseSpeed();
    if (U && !D) tgt = maxSpeed(); else if (D && !U) tgt = 0.45;
    P.speed += (tgt - P.speed) * (tgt > P.speed ? 0.03 : 0.07);
    P.y -= P.speed;
    P.anim += 0.12 + P.speed * 0.1;
    // throw
    if (act.throw) startThrow();
    if (P.throwT >= 0) {
      P.throwT++;
      if (P.throwT === 4) { if (G.papers > 0) { G.papers--; spawnPaper(); } }
      if (P.throwT > 14) P.throwT = -1;
    }
    // collisions
    const pb = { x: P.x + 3, y: P.y + 8, w: 10, h: 14 };
    if (P.invuln <= 0) {
      for (const o of G.obs) {
        if (Math.abs(o.y - P.y) > 60) continue;
        if (o.state === 'flee') continue;
        if (ov(pb, hbOf(o))) { crash(o.t); break; }
      }
      if (G.phase === 'play') {
        for (let i = 0; i < NH; i++) {
          const mr = mailRect(i);
          if (Math.abs(mr.y - P.y) > 40) continue;
          if (G.houses[i].mb !== 'broken' && ov(pb, mr)) {
            G.houses[i].mb = 'broken'; burst(mr.x + 4, mr.y + 6, 8, ['#8b5a2b', '#aaa'], 1.8, 0.07, 24); crash('mailbox'); break;
          }
        }
      }
    }
    // bundles
    for (const b of G.bundles) {
      if (b.got) continue;
      if (ov(pb, b)) {
        b.got = true; G.papers = Math.min(20, G.papers + 10); sfx('pickup');
        popup(b.x + 4, b.y - 4, '+10 PAPERS', '#7dff8a');
        burst(b.x + 6, b.y + 5, 8, ['#fff', '#ffe27a'], 1.4, 0.04, 20);
      }
    }
    // cars
    if (--G.carT <= 0) { spawnCar(); G.carT = ri(Math.max(60, 150 - 12 * G.day), Math.max(110, 300 - 20 * G.day)); }
    // finish
    if (P.y <= END_Y) { G.phase = 'finish'; G.phaseT = 0; banner('DAY COMPLETE!', '#ffd84a', 120); }
  } else if (G.phase === 'crash') {
    G.phaseT++;
    P.speed *= 0.9; P.y -= P.speed; P.vx *= 0.9; P.x = clamp(P.x + P.vx, PX_MIN, PX_MAX);
    if (G.phaseT >= 95) {
      if (G.lives <= 0) { gameOver('OUT OF LIVES'); return; }
      respawn();
    }
  } else if (G.phase === 'finish') {
    G.phaseT++;
    P.speed += (0.15 - P.speed) * 0.04; P.y -= P.speed; P.anim += 0.1;
    P.vx *= 0.9; P.x = clamp(P.x + P.vx, PX_MIN, PX_MAX);
    if (act.throw) startThrow();
    if (P.throwT >= 0) { P.throwT++; if (P.throwT === 4 && G.papers > 0) { G.papers--; spawnPaper(); } if (P.throwT > 14) P.throwT = -1; }
    if (G.phaseT > 120) { endDay(); return; }
  }
  G.cam = P.y - PSY;
  updateObstacles();
  for (let i = G.pap.length - 1; i >= 0; i--) { updatePaper(G.pap[i]); if (G.pap[i].fade && G.pap[i].gone <= 0) G.pap.splice(i, 1); }
  let nRest = 0; for (const p of G.pap) if (p.rest && !p.fade) nRest++;
  if (nRest > 50) { for (let i = 0; i < G.pap.length && nRest > 50; i++) if (G.pap[i].rest && !G.pap[i].fade) { G.pap.splice(i, 1); i--; nRest--; } }
  updateFx();
}
function updateFx() {
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const q = G.parts[i];
    q.x += q.vx; q.y += q.vy; q.vy += q.g; q.vx *= 0.98;
    if (--q.life <= 0) G.parts.splice(i, 1);
  }
  for (let i = G.pops.length - 1; i >= 0; i--) {
    const q = G.pops[i]; q.t++; q.y -= 0.45;
    if (q.t > q.life) G.pops.splice(i, 1);
  }
  G.shake *= 0.88; if (G.shake < 0.25) G.shake = 0;
  if (G.muteMsg > 0) G.muteMsg--;
}

// ---------------------------------------------------------------- state transitions
function setState(s) { G.state = s; G.stateT = 0; }
function goTitle() {
  setState('title'); G.demoCam = START_Y - PSY; G.obs = []; G.bundles = []; G.pap = []; G.parts = []; G.pops = [];
  G.banner = null; G.paused = false;
  META = META || houseMeta();
  initHouses(); G.p = null;
  music('title');
}
function newGame() {
  G.day = 0; G.score = 0; G.lives = 3; G.papers = 10; G.nextLife = 10000; G.newHi = false;
  initHouses();
  startIntro();
}
function startIntro() {
  setState('intro'); buildDay(); sfx('start'); music(null);
}
function startRide() {
  setState('ride'); G.paused = false; music('ride');
}
function endDay() {
  // evaluate
  let delivered = 0, missed = 0, broken = 0, subs = 0;
  for (const h of G.houses) {
    if (!h.sub) { h.status = 'non'; continue; }
    subs++;
    if (h.brokeSub) { h.status = 'broken'; broken++; }
    else if (!h.delivered) { h.status = 'missed'; missed++; }
    else { h.status = 'ok'; delivered++; }
  }
  const perfect = subs > 0 && missed === 0 && broken === 0;
  const S = { delivered, missed, broken, subs, perfect, bonus: 0, newSub: -1, reveal: 0, musicT: 0, after: 'next', winBonus: 0 };
  for (const h of G.houses) if (h.status === 'missed' || h.status === 'broken') { h.sub = false; h.wasCancelled = true; }
  if (perfect) {
    const non = G.houses.map((h, i) => ({ h, i })).filter((e) => !e.h.sub);
    const pool = non.filter((e) => e.h.wasCancelled);
    const c = (pool.length ? pool : non);
    if (c.length) { const e = pick(c); e.h.sub = true; e.h.status = 'won'; S.newSub = e.i; }
    S.bonus = 1000 + 100 * G.day;
    addScore(S.bonus);
  }
  S.subsNow = subCount();
  if (S.subsNow <= 0) S.after = 'nosubs';
  else if (G.day >= DAYS.length - 1) {
    S.after = 'win'; S.winBonus = S.subsNow * 500; addScore(S.winBonus);
  }
  G.summary = S;
  setState('summary'); sfx('day_clear'); music(null);
}
function nextAfterSummary() {
  const S = G.summary;
  if (S.after === 'nosubs') gameOver('NO SUBSCRIBERS LEFT');
  else if (S.after === 'win') win();
  else { G.day++; startIntro(); }
}
function recordHi() {
  G.newHi = false;
  if (G.score > G.hi) { G.hi = G.score; G.newHi = true; saveHi(G.hi); }
}
function gameOver(reason) {
  G.overReason = reason; recordHi(); setState('gameover'); sfx('game_over'); music('gameover');
}
function win() {
  recordHi(); setState('win'); sfx('day_clear'); music('title'); G.confetti = [];
}

// ---------------------------------------------------------------- main update
function update() {
  G.stateT++;
  const confirm = act.confirm || (act.throw && G.state !== 'ride');
  switch (G.state) {
    case 'title':
      G.demoCam -= 0.9; if (G.demoCam < END_Y + 400) G.demoCam = START_Y - PSY;
      if (confirm && G.stateT > 10) { sfx('select'); newGame(); }
      break;
    case 'intro':
      G.cam = G.p.y - PSY;
      if (G.stateT > 150 || (confirm && G.stateT > 20)) startRide();
      updateFx();
      break;
    case 'ride':
      if (act.pause) { G.paused = !G.paused; if (G.paused) { try { if (window.Sfx) window.Sfx.stopMusic(); } catch (e) { /* */ } sfx('select'); } else music('ride'); }
      else if (G.paused && confirm) { G.paused = false; music('ride'); }
      if (!G.paused) updateRide();
      break;
    case 'summary': {
      const S = G.summary;
      if (S.reveal < NH * 5 + 10) {
        S.reveal++;
        if (S.reveal % 5 === 0 && S.reveal / 5 <= NH) {
          const h = G.houses[S.reveal / 5 - 1];
          const st = h.status;
          if (st === 'ok') sfx('select'); else if (st === 'missed' || st === 'broken') sfx('cancel'); else if (st === 'won') sfx('extra_life');
        }
      }
      S.musicT++;
      if (S.musicT === 150) music('summary');
      if (confirm && G.stateT > 30) {
        if (S.reveal < NH * 5) S.reveal = NH * 5 + 10; else { sfx('select'); nextAfterSummary(); }
      }
      break;
    }
    case 'gameover':
      if (confirm && G.stateT > 60) { sfx('select'); goTitle(); }
      break;
    case 'win':
      updateConfetti();
      if (confirm && G.stateT > 90) { sfx('select'); goTitle(); }
      break;
    default: break;
  }
  act.confirm = act.throw = act.pause = false;
}
function updateConfetti() {
  if (G.stateT % 2 === 0) G.confetti.push({ x: rnd(0, W), y: -4, vy: rnd(0.6, 1.6), vx: rnd(-0.3, 0.3), c: pick(['#ffd84a', '#ff5a5a', '#5ad1ff', '#7dff8a', '#ff8be0']), t: 0 });
  for (let i = G.confetti.length - 1; i >= 0; i--) { const c = G.confetti[i]; c.t++; c.x += c.vx + Math.sin(c.t * 0.1) * 0.3; c.y += c.vy; if (c.y > H + 4) G.confetti.splice(i, 1); }
}

// ---------------------------------------------------------------- rendering
function rowBand(wy) { return Math.ceil((FIRST_TOP + HOUSE_H + 32 - wy) / SPACING) - 1; }

function drawGround(cam) {
  const y0 = -(((Math.floor(cam) % 16) + 16) % 16) - 16;
  for (let sy = y0; sy < H + 16; sy += 16) {
    const wy = Math.floor(cam) + sy;
    const r = Math.floor(wy / 16);
    const band = rowBand(wy + 8);
    const h = band >= 0 && band < NH ? G.houses[band] : null;
    const dead = h && !h.sub;
    for (let x = 0; x < SIDE_X + 8; x += 16) {
      if (dead) spr('grass_dead', x, sy, 0);
      else spr('grass', x, sy, (((x >> 4) * 7 + r * 13) & 1));
    }
    spr('sidewalk', SIDE_X, sy, 0); spr('sidewalk', SIDE_X + 16, sy, 0);
    spr('curb', CURB_X, sy, 0);
    for (let x = ROAD_X, k = 0; x < W + 8; x += 16, k++) spr(k === 2 && (r & 1) === 0 ? 'road_line' : 'road', x, sy, 0);
  }
}
function visible(y, h, cam) { const sy = y - cam; return sy < H + 8 && sy + h > -8; }

function drawHouses(cam) {
  for (let i = 0; i < NH; i++) {
    const top = hTop(i);
    if (!visible(top - 20, HOUSE_H + 60, cam)) continue;
    const h = G.houses[i], sy = top - cam;
    // driveway + flower bed decor in the gap below the house
    spr('driveway', 104, sy + HOUSE_H + 10, 0); spr('driveway', 120, sy + HOUSE_H + 10, 0);
    if (h.sub) spr('flowers', 94, sy + HOUSE_H - 14, 0);
    spr(h.sub ? 'house_sub' : 'house_nonsub', 0, sy, 0);
    for (let k = 0; k < META.windows.length; k++) spr(h.win[k] ? 'window' : 'window_broken', META.windows[k].x, sy + META.windows[k].y, 0);
    spr('door', META.door.x, sy + META.door.y, 0);
    const mr = mailRect(i);
    spr(h.mb === 'ok' ? 'mailbox' : h.mb === 'hit' ? 'mailbox_hit' : 'mailbox_broken', mr.x, mr.y - cam, 0);
  }
}
function shadow(x, y, w) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(Math.round(x) + 1, Math.round(y), w - 2, 1);
  ctx.fillRect(Math.round(x), Math.round(y) + 1, w, 2);
  ctx.fillRect(Math.round(x) + 1, Math.round(y) + 3, w - 2, 1);
}

function drawEntities(cam, withPlayer) {
  const list = [];
  for (const o of G.obs) {
    if (!visible(o.y, OB[o.t].h + 4, cam)) continue;
    list.push({ y: o.y + OB[o.t].h, o });
  }
  for (const b of G.bundles) if (!b.got && visible(b.y, 12, cam)) list.push({ y: b.y + b.h, b });
  if (withPlayer && G.p) list.push({ y: G.p.y + 24, pl: true });
  list.sort((a, b) => a.y - b.y);
  // shadows first
  for (const e of list) {
    if (e.o) {
      const d = OB[e.o.t];
      if (e.o.t === 'fence' || e.o.t === 'car') continue;
      shadow(e.o.x + 1, e.o.y - cam + d.h - 2, d.w - 2);
    } else if (e.b) shadow(e.b.x, e.b.y - cam + 8, 12);
    else if (e.pl && G.phase !== 'crash') shadow(G.p.x + 3, G.p.y - cam + 20, 11);
  }
  for (const e of list) {
    if (e.o) {
      const o = e.o, sy = o.y - cam;
      switch (o.t) {
        case 'car': spr('car', o.x, sy, (o.anim >> 3) & 1); break;
        case 'dog': spr('dog', o.x, sy, (o.anim >> 2) & 1, o.flip); break;
        case 'skater': spr('skater', o.x, sy, (o.anim >> 3) & 1); break;
        case 'worker': spr('worker', o.x, sy, (o.anim >> 3) & 1); break;
        default: spr(OB[o.t].s, o.x, sy, 0);
      }
    } else if (e.b) spr('paper_bundle', e.b.x, e.b.y - cam, 0);
    else if (e.pl) drawPlayer(cam);
  }
}
function drawPlayer(cam) {
  const P = G.p, sy = P.y - cam;
  if (G.phase === 'crash') {
    const f = G.phaseT < 10 ? 0 : G.phaseT < 28 ? 1 : 2;
    spr('paperboy_crash', P.x - 4, sy, f, false);
    return;
  }
  if (P.invuln > 0 && ((P.invuln >> 2) & 1)) return;
  if (P.throwT >= 0) spr('paperboy_throw', P.x, sy, P.throwT < 4 ? 0 : 1, false);
  else spr('paperboy', P.x, sy, Math.floor(P.anim) & 3, false);
}
function drawPapers(cam) {
  for (const p of G.pap) {
    const sy = p.y - cam;
    if (sy < -10 || sy > H + 10) continue;
    if (p.fade) { if (p.gone <= 0 || (p.gone & 2)) continue; }
    if (!p.rest) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(Math.round(p.x) - 2, Math.round(sy) + 1, 5, 2);
      spr('paper', p.x - 4, sy - 4 - p.z * 0.5, (p.age >> 1) & 3);
    } else spr('paper', p.x - 4, sy - 4, 0);
  }
}
function drawFx(cam) {
  for (const q of G.parts) {
    const a = Math.min(1, q.life / (q.max * 0.5));
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = q.c; ctx.fillRect(Math.round(q.x), Math.round(q.y - cam), q.s, q.s);
  }
  ctx.globalAlpha = 1;
  for (const q of G.pops) {
    const sy = q.y - cam;
    if (q.t > q.life - 14 && (q.t & 2)) continue;
    const w = tw(q.text, 1);
    txt(q.text, clamp(q.x, w / 2 + 2, W - w / 2 - 2), sy, q.color, 1, 'center');
  }
}
function drawFinishLine(cam) {
  const wy = END_Y + 8, sy = wy - cam;
  if (sy < -10 || sy > H) return;
  for (let r = 0; r < 2; r++) for (let x = SIDE_X, k = 0; x < W; x += 8, k++) {
    ctx.fillStyle = (k + r) & 1 ? '#111' : '#f4f4f4'; ctx.fillRect(x, Math.round(sy) + r * 4, 8, 4);
  }
  txt('FINISH', 144, sy - 10, '#ffd84a', 1, 'left');
}

function drawWorld(cam, withPlayer) {
  drawGround(cam);
  drawHouses(cam);
  drawFinishLine(cam);
  drawPapers(cam);
  drawEntities(cam, withPlayer);
  drawFx(cam);
}

function drawHUD() {
  ctx.fillStyle = 'rgba(8,10,24,0.72)'; ctx.fillRect(0, 0, W, 20);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, 20, W, 1);
  txt('SCORE ' + pad(G.score, 6), 3, 2, '#fff');
  txt(DAYS[G.day], W - 3, 2, '#ffd84a', 1, 'right');
  // row 2
  spr('icon_paper', 3, 11, 0);
  const low = G.papers <= 2 && ((G.t >> 3) & 1);
  txt('x' + G.papers, 13, 11, low ? '#ff5a5a' : '#fff');
  if (G.lives <= 4) for (let i = 0; i < G.lives; i++) spr('icon_life', 52 + i * 9, 11, 0);
  else { spr('icon_life', 52, 11, 0); txt('x' + G.lives, 62, 11); }
  spr('icon_house', 100, 11, 0);
  txt(deliveredCount() + '/' + subCount(), 110, 11, deliveredCount() === subCount() && subCount() > 0 ? '#7dff8a' : '#fff');
  // route progress
  const prog = clamp((START_Y - G.p.y) / (START_Y - END_Y), 0, 1);
  ctx.fillStyle = '#222a48'; ctx.fillRect(160, 13, 92, 4);
  ctx.fillStyle = '#ffd84a'; ctx.fillRect(160, 13, Math.round(92 * prog), 4);
  ctx.fillStyle = '#fff'; ctx.fillRect(160 + Math.round(90 * prog), 12, 2, 6);
}
function drawBanner() {
  const b = G.banner; if (!b) return;
  const a = Math.min(1, b.t / 15, (b.max - b.t) / 6 + 0.2);
  ctx.globalAlpha = Math.max(0, a);
  txt(b.text, W / 2, 58, b.color, 2, 'center');
  ctx.globalAlpha = 1;
}
function drawMuteIcon() {
  const m = isMuted();
  if (!m && G.muteMsg <= 0) return;
  const x = 3, y = H - 11;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 2, y - 2, 56, 12);
  ctx.fillStyle = m ? '#ff7a7a' : '#7dff8a';
  ctx.fillRect(x, y + 2, 2, 4); ctx.fillRect(x + 2, y + 1, 1, 6); ctx.fillRect(x + 3, y, 1, 8);
  if (m) { ctx.fillRect(x + 6, y + 1, 1, 1); ctx.fillRect(x + 7, y + 2, 1, 1); ctx.fillRect(x + 8, y + 3, 1, 2); ctx.fillRect(x + 7, y + 5, 1, 1); ctx.fillRect(x + 6, y + 6, 1, 1); }
  else { ctx.fillRect(x + 6, y + 2, 1, 4); ctx.fillRect(x + 8, y + 1, 1, 6); }
  txt(m ? 'MUTED' : 'SOUND', x + 12, y + 1, m ? '#ff7a7a' : '#7dff8a', 1, 'left', false);
}
function panel(x, y, w, h) {
  ctx.fillStyle = 'rgba(8,10,30,0.82)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffd84a'; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
}
const blink = (n) => ((G.stateT / (n || 30)) | 0) % 2 === 0;

function renderTitle() {
  drawWorld(G.demoCam, false);
  const t = G.stateT;
  ctx.fillStyle = 'rgba(8,10,30,0.55)'; ctx.fillRect(0, 0, W, H);
  spr('logo', 48, 14 + Math.round(Math.sin(t * 0.05) * 1.5), 0);
  txt('ONE WEEK  SEVEN STREETS', W / 2, 62, '#9fd0ff', 1, 'center');
  spr('paperboy', 120, 80, (t >> 3) & 3);
  if (blink(30)) txt('PRESS ENTER', W / 2, 116, '#ffd84a', 2, 'center');
  txt('HIGH SCORE ' + pad(G.hi, 6), W / 2, 142, '#fff', 1, 'center');
  const y0 = 164;
  txt('ARROWS OR WASD  STEER AND SPEED', W / 2, y0, '#cfd6ff', 1, 'center');
  txt('SPACE Z J  THROW PAPER LEFT', W / 2, y0 + 11, '#cfd6ff', 1, 'center');
  txt('P PAUSE   M MUTE', W / 2, y0 + 22, '#cfd6ff', 1, 'center');
  txt('MAILBOX 250   PORCH 100', W / 2, y0 + 38, '#7dff8a', 1, 'center');
  txt('DONT BREAK SUBSCRIBER WINDOWS!', W / 2, y0 + 49, '#ff8a8a', 1, 'center');
}
function renderIntro() {
  drawWorld(G.cam, true);
  ctx.fillStyle = 'rgba(8,10,30,0.45)'; ctx.fillRect(0, 0, W, H);
  panel(24, 40, 208, 150);
  txt(DAYS[G.day], W / 2, 54, '#ffd84a', 3, 'center');
  txt('DAY ' + (G.day + 1) + ' OF 7', W / 2, 84, '#fff', 1, 'center');
  txt('SUBSCRIBERS ' + subCount() + ' OF ' + NH, W / 2, 100, '#7dff8a', 1, 'center');
  txt('PAPERS ' + G.papers + '   LIVES ' + G.lives, W / 2, 112, '#fff', 1, 'center');
  txt('MAILBOX 250   PORCH 100', W / 2, 132, '#fff', 1, 'center');
  txt('NON SUB WINDOW 50 MAILBOX 100', W / 2, 144, '#cfd6ff', 1, 'center');
  txt('SUB WINDOW BROKEN: CANCEL!', W / 2, 156, '#ff8a8a', 1, 'center');
  if (G.day >= 1) txt('WATCH OUT FOR DOGS AND CARS', W / 2, 168, '#ffb347', 1, 'center');
  if (blink(24)) txt('GET READY', W / 2, 178, '#ffd84a', 1, 'center');
}
function renderRide() {
  const sh = G.shake;
  ctx.save();
  try {
    if (sh > 0) ctx.translate(Math.round((Math.random() - 0.5) * 2 * sh), Math.round((Math.random() - 0.5) * 2 * sh));
    drawWorld(G.cam, true);
  } finally { ctx.restore(); }
  if (G.day >= 2) { ctx.fillStyle = 'rgba(30,10,70,' + (0.04 * (G.day - 1)).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
  if (G.phase === 'crash' && G.phaseT < 6) { ctx.fillStyle = 'rgba(255,255,255,' + (0.5 - G.phaseT * 0.08).toFixed(2) + ')'; ctx.fillRect(0, 0, W, H); }
  drawHUD();
  drawBanner();
  if (G.hint > 0 && G.day === 0 && G.phase === 'play') {
    txt('THROW LEFT AT MAILBOXES!', W / 2, H - 22, '#fff', 1, 'center');
  }
  if (G.paused) {
    ctx.fillStyle = 'rgba(0,0,20,0.7)'; ctx.fillRect(0, 0, W, H);
    txt('PAUSED', W / 2, 90, '#ffd84a', 3, 'center');
    txt('P OR ESC TO RESUME', W / 2, 124, '#fff', 1, 'center');
    txt('M TOGGLES SOUND', W / 2, 138, '#cfd6ff', 1, 'center');
  }
}
function renderSummary() {
  const S = G.summary;
  ctx.fillStyle = '#12142a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1b1f40'; ctx.fillRect(0, 0, W, 26);
  txt(DAYS[G.day] + ' COMPLETE', W / 2, 8, '#ffd84a', 2, 'center');
  const shown = Math.floor(S.reveal / 5);
  for (let i = 0; i < NH; i++) {
    const cx = 8 + (i % 10) * 24, cy = 34 + Math.floor(i / 10) * 30;
    const h = G.houses[i];
    const done = i < shown;
    ctx.fillStyle = '#05060f'; ctx.fillRect(cx, cy, 22, 28);
    ctx.fillStyle = done ? COL[h.status] || COL.non : '#2a2d50'; ctx.fillRect(cx + 1, cy + 1, 20, 26);
    txt(String(i + 1), cx + 11, cy + 3, done ? '#000' : '#8088b0', 1, 'center', false);
    spr('icon_house', cx + 7, cy + 11, 0);
    const sym = { ok: 'OK', missed: 'M', broken: 'X', non: '-', won: '+' }[h.status] || '-';
    if (done) txt(sym, cx + 11, cy + 20, '#000', 1, 'center', false);
  }
  const leg = [['ok', 'DELIVERED'], ['missed', 'MISSED'], ['broken', 'CANCELLED'], ['non', 'NON SUB'], ['won', 'NEW SUB']];
  for (let k = 0; k < leg.length; k++) {
    const lx = 10 + (k % 3) * 82, ly = 98 + Math.floor(k / 3) * 12;
    ctx.fillStyle = COL[leg[k][0]]; ctx.fillRect(lx, ly, 8, 8);
    txt(leg[k][1], lx + 11, ly + 1, '#cfd6ff', 1, 'left', false);
  }
  if (S.reveal >= NH * 5) {
    let y = 128;
    const line = (s, c) => { txt(s, W / 2, y, c || '#fff', 1, 'center'); y += 11; };
    line('DELIVERED ' + S.delivered + ' OF ' + S.subs, S.delivered === S.subs ? '#7dff8a' : '#fff');
    if (S.missed) line(S.missed + ' MISSED  THEY CANCEL', '#ffb347');
    if (S.broken) line(S.broken + (S.broken === 1 ? ' WINDOW' : ' WINDOWS') + ' BROKEN  CANCELLED', '#ff6a6a');
    if (S.perfect) { line('PERFECT DAY!  BONUS +' + S.bonus, '#ffd84a'); if (S.newSub >= 0) line('HOUSE ' + (S.newSub + 1) + ' SUBSCRIBES AGAIN!', '#35d0ff'); }
    line('SUBSCRIBERS NOW ' + S.subsNow, '#fff');
    if (S.after === 'win') line('WEEK BONUS +' + S.winBonus, '#ffd84a');
    if (S.after === 'nosubs') line('NO SUBSCRIBERS LEFT!', '#ff5a5a');
    line('SCORE ' + pad(G.score, 6) + '   LIVES ' + G.lives, '#fff');
    if (blink(30)) txt('PRESS ENTER', W / 2, 218, '#ffd84a', 1, 'center');
  } else if (blink(30)) txt('ENTER TO SKIP', W / 2, 222, '#667', 1, 'center', false);
}
function renderGameOver() {
  drawWorld(G.cam, false);
  ctx.fillStyle = 'rgba(20,0,0,0.7)'; ctx.fillRect(0, 0, W, H);
  txt('GAME OVER', W / 2, 62, '#ff4a4a', 3, 'center');
  txt(G.overReason, W / 2, 96, '#fff', 1, 'center');
  txt('SCORE ' + pad(G.score, 6), W / 2, 122, '#fff', 2, 'center');
  txt('HIGH SCORE ' + pad(G.hi, 6), W / 2, 146, G.newHi ? '#ffd84a' : '#cfd6ff', 1, 'center');
  if (G.newHi && blink(15)) txt('NEW HIGH SCORE!', W / 2, 160, '#ffd84a', 1, 'center');
  txt('YOU REACHED ' + DAYS[G.day], W / 2, 176, '#9fd0ff', 1, 'center');
  if (G.stateT > 60 && blink(30)) txt('PRESS ENTER', W / 2, 200, '#ffd84a', 1, 'center');
}
function renderWin() {
  ctx.fillStyle = '#10204a'; ctx.fillRect(0, 0, W, H);
  for (const c of G.confetti) { ctx.fillStyle = c.c; ctx.fillRect(Math.round(c.x), Math.round(c.y), 3, 3); }
  txt('YOU WIN!', W / 2, 40, '#ffd84a', 4, 'center');
  txt('THE WHOLE WEEK DELIVERED', W / 2, 80, '#fff', 1, 'center');
  spr('paperboy', 120, 98, (G.stateT >> 3) & 3);
  txt('FINAL SCORE ' + pad(G.score, 6), W / 2, 136, '#fff', 1, 'center');
  txt('SUBSCRIBERS LEFT ' + subCount() + ' OF ' + NH, W / 2, 150, '#7dff8a', 1, 'center');
  txt('HIGH SCORE ' + pad(G.hi, 6), W / 2, 164, G.newHi ? '#ffd84a' : '#cfd6ff', 1, 'center');
  if (G.newHi && blink(15)) txt('NEW HIGH SCORE!', W / 2, 178, '#ffd84a', 1, 'center');
  if (G.stateT > 90 && blink(30)) txt('PRESS ENTER', W / 2, 206, '#ffd84a', 1, 'center');
}
function render() {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  switch (G.state) {
    case 'title': renderTitle(); break;
    case 'intro': renderIntro(); break;
    case 'ride': renderRide(); break;
    case 'summary': renderSummary(); break;
    case 'gameover': renderGameOver(); break;
    case 'win': renderWin(); break;
    default: break;
  }
  drawMuteIcon();
}

// ---------------------------------------------------------------- input
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down'
};
const THROW_KEYS = { Space: 1, KeyZ: 1, KeyJ: 1 };
function firstGesture() { audioInit(); }
window.addEventListener('keydown', (e) => {
  firstGesture();
  const k = e.code;
  if (KEYMAP[k]) { held[KEYMAP[k]] = true; e.preventDefault(); return; }
  if (THROW_KEYS[k]) { if (!e.repeat) act.throw = true; e.preventDefault(); return; }
  if (e.repeat) { if (k === 'Enter' || k === 'NumpadEnter') e.preventDefault(); return; }
  if (k === 'Enter' || k === 'NumpadEnter') { act.confirm = true; e.preventDefault(); }
  else if (k === 'KeyP' || k === 'Escape') { act.pause = true; e.preventDefault(); }
  else if (k === 'KeyM') toggleMute();
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) held[KEYMAP[e.code]] = false; });
window.addEventListener('blur', () => {
  for (const k in held) held[k] = false;
  if (G.state === 'ride' && !G.paused) { G.paused = true; try { if (window.Sfx) window.Sfx.stopMusic(); } catch (e) { /* */ } }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.state === 'ride' && !G.paused) { G.paused = true; try { if (window.Sfx) window.Sfx.stopMusic(); } catch (e) { /* */ } }
});
window.addEventListener('pointerdown', firstGesture);
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (G.state === 'ride') { if (G.paused) act.confirm = true; } else act.confirm = true;
});

// touch controls
function setupTouch() {
  const bar = document.getElementById('touch');
  if (!bar) return;
  const qs = location.search || '';
  const isTouch = qs.indexOf('touch') >= 0 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (qs.indexOf('notouch') >= 0 || !isTouch) return;
  bar.hidden = false;
  bar.querySelectorAll('[data-key]').forEach((b) => {
    const k = b.dataset.key;
    const down = (e) => { e.preventDefault(); firstGesture(); vheld[k] = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (x) { /* */ } };
    const up = (e) => { e.preventDefault(); vheld[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  bar.querySelectorAll('[data-act]').forEach((b) => {
    const a = b.dataset.act;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); firstGesture(); b.classList.add('on');
      if (a === 'mute') toggleMute(); else act[a] = true;
    });
    const off = () => b.classList.remove('on');
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

// ---------------------------------------------------------------- sizing
function resize() {
  const stage = document.getElementById('stage');
  const sw = stage.clientWidth, sh = stage.clientHeight;
  let s = Math.min(sw / W, sh / H);
  if (s >= 2) s = Math.floor(s); else s = Math.max(0.5, Math.floor(s * 100) / 100);
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 100));
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------- loop
let lastT = 0, acc = 0;
const errSeen = {};
function reportErr(e) { const m = String(e && e.stack || e); if (!errSeen[m]) { errSeen[m] = 1; try { console.error('[paperboy] ' + m); } catch (x) { /* */ } } }
function frame(now) {
  requestAnimationFrame(frame);
  let dt = now - lastT; lastT = now;
  if (dt > 250) dt = 250; if (dt < 0) dt = 0;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 6) { try { update(); } catch (e) { reportErr(e); act.confirm = act.throw = act.pause = false; } acc -= STEP; n++; }
  if (n >= 6) acc = 0;
  try { render(); } catch (e) { reportErr(e); }
}

function boot() {
  try { if (window.Sprites) window.Sprites.init(); } catch (e) { reportErr(e); }
  META = houseMeta();
  setupTouch();
  resize();
  goTitle();
  requestAnimationFrame((t) => { lastT = t; frame(t); });
}

// test / debug hook
window.__pb = {
  G, update, render, act, held, mailRect, startIntro, endDay,
  tick(n) { for (let i = 0; i < n; i++) update(); },
  skipToEnd() { if (G.p) { G.p.y = END_Y + 30; } }
};

boot();
})();
