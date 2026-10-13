/* Paperboy — audio.js
 * Everything is synthesized with the Web Audio API: pulse/triangle/noise voices,
 * gain envelopes, pitch sweeps. Music is written as note-name data and played by
 * a lookahead scheduler running on AudioContext.currentTime (setInterval only
 * wakes the scheduler). Every public method is a safe no-op before init() or
 * without Web Audio, and never throws.
 *
 * Notes:
 *  - Sfx.music(name) while that same track is already playing does nothing
 *    (so a game loop may call it repeatedly); Sfx.music(null) stops.
 *  - Sfx.music(name) before init() is remembered and starts at init().
 */
(function (global) {
  'use strict';

  var AC = global.AudioContext || global.webkitAudioContext;
  var STORE_KEY = 'paperboy.muted';
  var MASTER_VOL = 0.9, SFX_VOL = 1.0, MUSIC_VOL = 0.34;
  var LOOKAHEAD = 0.22, TICK_MS = 40;

  var ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  var pulseCache = {};
  var wantTrack = null;       // track requested before init()
  var cur = null;             // currently playing music {name, td, gain, step, next, timer}
  var built = {};
  var barErrors = [];
  var runErrors = [];         // swallowed exceptions, kept for debugging
  function note(e) { if (runErrors.length < 20) runErrors.push(String(e && e.message || e)); }

  var Sfx = { muted: false };

  try {
    if (global.localStorage && global.localStorage.getItem(STORE_KEY) === '1') Sfx.muted = true;
  } catch (e) { /* storage unavailable */ }

  // ------------------------------------------------------------- note data
  var SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function nf(name) {
    var m = /^([A-G])(#|b)?(\d)$/.exec(name);
    if (!m) return 0;
    var s = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    var midi = 12 * (parseInt(m[3], 10) + 1) + s;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ---------------------------------------------------------- graph helpers
  function pulseWave(duty) {
    var key = String(duty);
    if (pulseCache[key]) return pulseCache[key];
    var N = 48, re = new Float32Array(N), im = new Float32Array(N);
    for (var n = 1; n < N; n++) re[n] = 2 * Math.sin(n * Math.PI * duty) / (n * Math.PI);
    var w = ctx.createPeriodicWave(re, im);
    pulseCache[key] = w;
    return w;
  }

  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function cleanup(node, extra) {
    node.onended = function () {
      try { node.disconnect(); } catch (e) { /* */ }
      if (extra) { try { extra.disconnect(); } catch (e2) { /* */ } }
    };
  }

  // tone({type|'pulse', duty, f, f2, slide, t, dur, vol, a, r, sus, lp, detune, vib, dest})
  function tone(o) {
    var osc = ctx.createOscillator(), g = ctx.createGain(), t0 = o.t, end = t0 + o.dur;
    if (o.type === 'pulse') osc.setPeriodicWave(pulseWave(o.duty || 0.5));
    else osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + (o.slide || o.dur));
    if (o.detune) osc.detune.value = o.detune;
    var vol = o.vol == null ? 0.3 : o.vol, a = o.a == null ? 0.004 : o.a, r = o.r == null ? 0.02 : o.r;
    var sus = o.sus == null ? 1 : o.sus;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + a);
    if (o.decay) {                        // percussive: exponential fall to silence
      g.gain.exponentialRampToValueAtTime(0.0001, end);
    } else {
      var hold = Math.max(t0 + a, end - r);
      g.gain.linearRampToValueAtTime(Math.max(0.0001, vol * sus), hold);
      g.gain.linearRampToValueAtTime(0.0001, end);
    }
    var out = osc, lp = null;
    if (o.lp) {
      lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp; lp.Q.value = 0.7;
      osc.connect(lp); out = lp;
    }
    out.connect(g); g.connect(o.dest || sfxBus);
    var lfo = null, lg = null;
    if (o.vib) {
      lfo = ctx.createOscillator(); lg = ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, t0);
      lg.gain.linearRampToValueAtTime(o.vib, t0 + Math.min(0.18, o.dur * 0.6));
      lfo.connect(lg); lg.connect(osc.detune);
      lfo.start(t0); lfo.stop(end + 0.05);
    }
    osc.start(t0); osc.stop(end + 0.05);
    cleanup(osc, g);
    if (lfo) cleanup(lfo, lg);
  }

  // noise({t, dur, vol, filter, f, f2, q, a, decay, dest})
  function noise(o) {
    var src = ctx.createBufferSource(), g = ctx.createGain(), t0 = o.t, end = t0 + o.dur;
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.f || 1000, t0);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, end);
    f.Q.value = o.q == null ? 0.8 : o.q;
    var vol = o.vol == null ? 0.3 : o.vol, a = o.a == null ? 0.003 : o.a;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + a);
    if (o.decay === false) {
      g.gain.setValueAtTime(vol, Math.max(t0 + a, end - 0.04));
      g.gain.linearRampToValueAtTime(0.0001, end);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, end);
    }
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    src.start(t0, Math.random() * 1.4, o.dur + 0.05);
    src.stop(end + 0.05);
    cleanup(src, g);
  }

  function seq(list, t, beat, voice) {   // [[noteName, startBeat, lenBeats], ...]
    for (var i = 0; i < list.length; i++) {
      var n = list[i], o = {}, k;
      for (k in voice) o[k] = voice[k];
      o.f = nf(n[0]); o.t = t + n[1] * beat; o.dur = n[2] * beat;
      tone(o);
    }
  }

  // ------------------------------------------------------------------ SFX
  var SFX = {
    throw: function (t) {
      noise({ t: t, dur: 0.17, vol: 0.5, filter: 'bandpass', f: 450, f2: 2200, q: 1.4, a: 0.05 });
      tone({ t: t, dur: 0.1, type: 'triangle', f: 520, f2: 260, vol: 0.16, decay: true });
    },
    mailbox: function (t) {
      [[1567.98, 0], [2093.0, 0.085]].forEach(function (n) {
        tone({ t: t + n[1], dur: 0.34, type: 'sine', f: n[0], vol: 0.32, decay: true, a: 0.002 });
        tone({ t: t + n[1], dur: 0.2, type: 'pulse', duty: 0.25, f: n[0] * 2, vol: 0.07, decay: true, a: 0.002 });
        tone({ t: t + n[1], dur: 0.16, type: 'sine', f: n[0] * 2.76, vol: 0.09, decay: true, a: 0.002 });
      });
    },
    porch: function (t) {
      tone({ t: t, dur: 0.2, type: 'sine', f: 190, f2: 52, vol: 0.7, decay: true, a: 0.002 });
      noise({ t: t, dur: 0.08, vol: 0.28, filter: 'lowpass', f: 700, f2: 200 });
      tone({ t: t + 0.11, dur: 0.07, type: 'sine', f: 110, f2: 60, vol: 0.25, decay: true });
    },
    glass: function (t) {
      noise({ t: t, dur: 0.38, vol: 0.5, filter: 'highpass', f: 2400, q: 0.7 });
      noise({ t: t, dur: 0.16, vol: 0.4, filter: 'bandpass', f: 5200, q: 2.5 });
      tone({ t: t, dur: 0.06, type: 'triangle', f: 900, f2: 300, vol: 0.2, decay: true });
      for (var i = 0; i < 9; i++) {
        var st = t + 0.04 + i * 0.038 + Math.random() * 0.02, fr = 2200 + Math.random() * 5200;
        tone({ t: st, dur: 0.1 + Math.random() * 0.1, type: i % 2 ? 'sine' : 'triangle', f: fr, vol: 0.13, decay: true, a: 0.001 });
      }
    },
    crash: function (t) {
      noise({ t: t, dur: 0.7, vol: 0.7, filter: 'lowpass', f: 2400, f2: 160, q: 0.6 });
      tone({ t: t, dur: 0.45, type: 'square', f: 230, f2: 42, vol: 0.28, decay: true });
      tone({ t: t, dur: 0.3, type: 'sine', f: 130, f2: 38, vol: 0.6, decay: true });
      tone({ t: t + 0.06, dur: 0.08, type: 'triangle', f: 1100, f2: 700, vol: 0.18, decay: true });
      tone({ t: t + 0.17, dur: 0.1, type: 'triangle', f: 820, f2: 520, vol: 0.14, decay: true });
      noise({ t: t + 0.3, dur: 0.25, vol: 0.2, filter: 'bandpass', f: 600, q: 1 });
    },
    pickup: function (t) {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        tone({ t: t + i * 0.055, dur: i === 3 ? 0.18 : 0.07, type: 'pulse', duty: 0.25, f: f, vol: 0.26, sus: 0.6 });
      });
    },
    bark: function (t) {
      [0, 0.15].forEach(function (d, i) {
        var f0 = 380 + i * 40;
        tone({ t: t + d, dur: 0.1, type: 'sawtooth', f: f0, f2: f0 * 0.5, vol: 0.3, lp: 1500, decay: true, a: 0.004 });
        noise({ t: t + d, dur: 0.09, vol: 0.4, filter: 'bandpass', f: 1000 + i * 150, q: 3.5 });
        tone({ t: t + d, dur: 0.07, type: 'square', f: f0 * 2.4, f2: f0 * 1.4, vol: 0.06, decay: true });
      });
    },
    horn: function (t) {
      [[349.23, -6], [349.23, 7], [440.0, -5], [440.0, 8]].forEach(function (n) {
        tone({ t: t, dur: 0.5, type: 'square', f: n[0], detune: n[1], vol: 0.09, lp: 2200, a: 0.012, r: 0.06, sus: 0.9 });
      });
      tone({ t: t, dur: 0.5, type: 'sawtooth', f: 174.6, vol: 0.07, lp: 900, a: 0.012, r: 0.06 });
    },
    skid: function (t) {
      noise({ t: t, dur: 0.5, vol: 0.34, filter: 'bandpass', f: 3200, f2: 1700, q: 7, a: 0.03, decay: false });
      tone({ t: t, dur: 0.45, type: 'sawtooth', f: 1900, f2: 1350, vol: 0.06, lp: 3200, a: 0.03, r: 0.12 });
    },
    bump: function (t) {
      tone({ t: t, dur: 0.08, type: 'square', f: 170, f2: 70, vol: 0.36, decay: true });
      noise({ t: t, dur: 0.05, vol: 0.28, filter: 'lowpass', f: 1000, f2: 300 });
    },
    select: function (t) {
      tone({ t: t, dur: 0.045, type: 'pulse', duty: 0.5, f: 880, vol: 0.24, sus: 0.8 });
      tone({ t: t + 0.05, dur: 0.07, type: 'pulse', duty: 0.5, f: 1318.5, vol: 0.24, sus: 0.6 });
    },
    start: function (t) {
      seq([['C5', 0, 1], ['E5', 1, 1], ['G5', 2, 1], ['C6', 3, 1.4], ['G5', 4.4, 0.6], ['C6', 5, 0.6], ['E6', 5.6, 2.2]], t, 0.085,
        { type: 'pulse', duty: 0.25, vol: 0.24, sus: 0.7 });
      seq([['C3', 0, 3], ['G3', 3, 2], ['C3', 5, 3]], t, 0.085, { type: 'triangle', vol: 0.3 });
    },
    day_clear: function (t) {
      var b = 0.13;
      seq([['C5', 0, 1], ['E5', 1, 1], ['G5', 2, 1], ['C6', 3, 2], ['G5', 5, 1], ['A5', 6, 1], ['C6', 7, 1],
        ['E6', 8, 3], ['D6', 11, 1], ['C6', 12, 1], ['D6', 13, 1], ['G6', 14, 4]], t, b,
      { type: 'pulse', duty: 0.25, vol: 0.22, sus: 0.7 });
      seq([['E4', 0, 3], ['G4', 3, 2], ['E4', 5, 3], ['A4', 8, 3], ['B4', 11, 3], ['D5', 14, 4]], t, b,
        { type: 'pulse', duty: 0.125, vol: 0.1, sus: 0.6 });
      seq([['C3', 0, 3], ['G3', 3, 2], ['C3', 5, 3], ['F3', 8, 3], ['G3', 11, 3], ['C3', 14, 4]], t, b,
        { type: 'triangle', vol: 0.34 });
    },
    game_over: function (t) {
      var b = 0.2;
      seq([['E5', 0, 1.5], ['D5', 1.5, 1.5], ['C5', 3, 1.5], ['B4', 4.5, 1], ['A4', 5.5, 3.5]], t, b,
        { type: 'pulse', duty: 0.5, vol: 0.22, sus: 0.7, vib: 14 });
      seq([['A3', 0, 3], ['F3', 3, 3], ['E3', 6, 4]], t, b, { type: 'triangle', vol: 0.34 });
      tone({ t: t + 5.5 * b, dur: 0.9, type: 'sawtooth', f: 110, f2: 38, vol: 0.12, lp: 600, decay: true });
    },
    extra_life: function (t) {
      ['C5', 'E5', 'G5', 'C6', 'E6', 'G6', 'C7'].forEach(function (n, i) {
        tone({ t: t + i * 0.055, dur: i === 6 ? 0.35 : 0.075, type: 'pulse', duty: 0.5, f: nf(n), vol: 0.22, sus: i === 6 ? 0.5 : 0.8, decay: i === 6 });
      });
      tone({ t: t + 0.4, dur: 0.3, type: 'sine', f: 3136, vol: 0.08, decay: true });
    },
    cancel: function (t) {
      tone({ t: t, dur: 0.12, type: 'triangle', f: 440, f2: 330, vol: 0.4, sus: 0.8 });
      tone({ t: t + 0.13, dur: 0.26, type: 'triangle', f: 311, f2: 175, vol: 0.4, sus: 0.8, vib: 25 });
      tone({ t: t + 0.13, dur: 0.22, type: 'square', f: 156, f2: 88, vol: 0.06, lp: 500 });
    }
  };

  // ---------------------------------------------------------------- music data
  // chord -> [bass root, bass fifth, bass octave, arp1, arp2, arp3]
  var CHORD = {
    C: ['C3', 'G3', 'C4', 'C4', 'E4', 'G4'],
    G: ['G2', 'D3', 'G3', 'G3', 'B3', 'D4'],
    Am: ['A2', 'E3', 'A3', 'A3', 'C4', 'E4'],
    F: ['F2', 'C3', 'F3', 'F3', 'A3', 'C4'],
    Dm: ['D3', 'A3', 'D4', 'D4', 'F4', 'A4'],
    E: ['E3', 'B3', 'E4', 'E4', 'G#4', 'B4']
  };

  // bass bar styles: R root, F fifth, O octave; ':n' is length in 16th steps
  var BASS = {
    A: 'R:2 R:2 O:2 R:2 R:2 R:2 O:2 F:2',
    B: 'R:3 R:1 R:2 F:2 R:3 R:1 F:2 O:2',
    P: 'R:2 R:2 R:2 R:2 R:2 R:2 R:2 R:2',
    L: 'R:8 F:4 O:4',
    N: 'r:16'
  };
  // harmony bar styles: 0,1,2 index the chord triad
  var HARM = {
    arp: '0:1 1:1 2:1 1:1 0:1 1:1 2:1 1:1 0:1 1:1 2:1 1:1 0:1 1:1 2:1 1:1',
    arp8: '0:2 1:2 2:2 1:2 0:2 1:2 2:2 1:2',
    stab: 'r:2 0:2 r:2 1:2 r:2 2:2 r:2 1:2',
    pad: '0:4 1:4 2:4 1:4',
    none: 'r:16'
  };
  // drum bars: kick/snare string, hat string (k kick, s snare, h hat, o open hat)
  var DRUM = {
    A: ['k...s...k.k.s...', 'h.h.h.h.h.h.h.h.'],
    B: ['k...s...k..ks...', 'h.h.h.h.h.h.h.hh'],
    F: ['k...s...k.k.s.ss', 'h.h.h.h.h.h.o...'],
    G: ['k...s...s.s.ssss', 'h.h.h.h.........'],
    S: ['k.......k.......', '....h.......h...'],
    N: ['................', '................']
  };

  function rep(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }

  var TRACKS = {
    // upbeat theme: 16 bars before it repeats (A A' B C), C major
    ride: {
      bpm: 152, loop: true, duty: 0.25, leadVol: 1,
      chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'G', 'F', 'C', 'G', 'Am', 'F', 'G', 'C', 'G'],
      lead: [
        'E5:2 E5:1 G5:1 C6:2 G5:2 E5:2 G5:2 E5:2 C5:2',
        'D5:2 D5:1 G5:1 B5:2 G5:2 D5:2 G5:2 B5:4',
        'E5:2 E5:1 A5:1 C6:2 A5:2 E5:2 A5:2 C6:2 E6:2',
        'F5:2 A5:2 C6:2 A5:2 G5:2 F5:2 E5:2 D5:2',
        'E5:2 E5:1 G5:1 C6:2 G5:2 E6:4 D6:2 C6:2',
        'D5:2 D5:1 G5:1 B5:2 G5:2 B5:2 A5:2 G5:4',
        'C6:2 B5:2 A5:2 G5:2 A5:4 r:2 E5:2',
        'G5:2 B5:2 D6:2 B5:2 G5:4 r:4',
        'A5:4 C6:4 F6:4 E6:2 D6:2',
        'E6:4 G5:4 C6:8',
        'B5:4 D6:4 G6:4 F6:2 D6:2',
        'E6:4 C6:2 A5:2 A5:8',
        'F6:2 F6:1 E6:1 D6:2 C6:2 A5:2 C6:2 F6:4',
        'G6:2 G6:1 F6:1 D6:2 B5:2 G5:2 B5:2 D6:4',
        'E6:2 E6:1 D6:1 C6:2 G5:2 C6:2 E6:2 G6:2 C7:2',
        'D6:2 B5:2 G5:2 B5:2 D6:4 r:2 G5:1 A5:1'
      ],
      harm: rep(8, 'arp').concat(rep(4, 'stab'), rep(4, 'arp')),
      bass: rep(8, 'A').concat(rep(4, 'B'), rep(4, 'A')),
      drums: ['A', 'A', 'A', 'F', 'A', 'A', 'A', 'F', 'B', 'B', 'B', 'F', 'B', 'B', 'B', 'G']
    },
    // fanfare for the title screen, 8 bars
    title: {
      bpm: 126, loop: true, duty: 0.25, leadVol: 1,
      chords: ['C', 'F', 'G', 'C', 'Am', 'F', 'G', 'G'],
      lead: [
        'G5:4 G5:2 E5:2 C6:8',
        'A5:4 A5:2 F5:2 A5:4 C6:4',
        'B5:4 B5:2 G5:2 D6:8',
        'E6:4 D6:2 C6:2 G5:8',
        'C6:4 B5:2 A5:2 E6:8',
        'A5:2 C6:2 F6:4 E6:2 D6:2 C6:4',
        'B5:2 D6:2 G6:4 F6:2 D6:2 B5:4',
        'G5:2 A5:2 B5:2 D6:2 G6:4 r:4'
      ],
      harm: rep(8, 'arp8'),
      bass: rep(7, 'A').concat(['B']),
      drums: ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'G']
    },
    // calm end-of-day screen, 8 bars
    summary: {
      bpm: 92, loop: true, duty: 0.5, leadVol: 0.8,
      chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G'],
      lead: [
        'E5:4 G5:4 C6:8',
        'C6:4 A5:4 E5:8',
        'F5:4 A5:4 C6:4 A5:4',
        'B5:4 G5:4 D5:8',
        'E5:4 G5:4 E6:8',
        'C6:4 B5:2 A5:2 E5:8',
        'F5:4 A5:4 D6:4 C6:4',
        'B5:6 G5:2 D5:8'
      ],
      harm: rep(8, 'pad'),
      bass: rep(8, 'L'),
      drums: rep(8, 'S')
    },
    // short, sad, non-looping
    gameover: {
      bpm: 70, loop: false, duty: 0.25, leadVol: 0.9,
      chords: ['Am', 'Dm', 'E', 'Am'],
      lead: ['E5:4 D5:4 C5:4 B4:4', 'D5:4 C5:4 A4:8', 'B4:4 G#4:4 E4:8', 'A4:16'],
      harm: rep(4, 'pad'),
      bass: rep(4, 'L'),
      drums: rep(4, 'N')
    }
  };

  function build(name, d) {
    var bars = d.chords.length, steps = bars * 16, ev = new Array(steps), i;
    for (i = 0; i < steps; i++) ev[i] = null;
    function add(s, e) { (ev[s] || (ev[s] = [])).push(e); }
    function walk(str, bi, fn) {
      var pos = bi * 16, toks = str.split(' ');
      for (var k = 0; k < toks.length; k++) {
        var p = toks[k].split(':'), len = parseInt(p[1], 10);
        if (p[0] !== 'r') fn(pos, p[0], len);
        pos += len;
      }
      if (pos !== (bi + 1) * 16) barErrors.push(name + ' bar ' + (bi + 1) + ' has ' + (pos - bi * 16) + ' steps');
    }
    for (var b = 0; b < bars; b++) {
      var ch = CHORD[d.chords[b]];
      walk(d.lead[b], b, function (s, n, len) { add(s, { c: 'lead', f: nf(n), d: len }); });
      walk(HARM[d.harm[b]], b, function (s, n, len) { add(s, { c: 'harm', f: nf(ch[3 + parseInt(n, 10)]), d: len }); });
      walk(BASS[d.bass[b]], b, function (s, n, len) {
        add(s, { c: 'bass', f: nf(n === 'R' ? ch[0] : n === 'F' ? ch[1] : ch[2]), d: len });
      });
      var dr = DRUM[d.drums[b]], soft = d.drums[b] === 'S';
      for (i = 0; i < 16; i++) {
        var k = dr[0].charAt(i), h = dr[1].charAt(i), s = b * 16 + i;
        if (k === 'k') add(s, { c: 'kick', v: soft ? 0.5 : 1 });
        else if (k === 's') add(s, { c: 'snare' });
        if (h === 'h') add(s, { c: 'hat', v: soft ? 0.6 : 1 });
        else if (h === 'o') add(s, { c: 'hat', open: true });
      }
    }
    return { bpm: d.bpm, loop: d.loop, steps: steps, events: ev, duty: d.duty, leadVol: d.leadVol };
  }

  function playEvent(e, t, sd, dest, td) {
    switch (e.c) {
      case 'lead':
        tone({ t: t, dur: Math.max(0.05, e.d * sd * 0.94), type: 'pulse', duty: td.duty, f: e.f, vol: 0.2 * td.leadVol,
          sus: 0.72, dest: dest, vib: e.d >= 4 ? 12 : 0, a: 0.005 });
        break;
      case 'harm':
        tone({ t: t, dur: Math.max(0.04, e.d * sd * 0.85), type: 'pulse', duty: 0.125, f: e.f, vol: 0.1,
          sus: e.d >= 4 ? 0.7 : 0.45, dest: dest });
        break;
      case 'bass':
        tone({ t: t, dur: Math.max(0.05, e.d * sd * 0.92), type: 'triangle', f: e.f, vol: 0.42, dest: dest, a: 0.004, r: 0.025 });
        break;
      case 'kick':
        tone({ t: t, dur: 0.13, type: 'triangle', f: 170, f2: 42, vol: 0.5 * e.v, decay: true, dest: dest, a: 0.002 });
        break;
      case 'snare':
        noise({ t: t, dur: 0.13, vol: 0.2, filter: 'bandpass', f: 2200, q: 0.7, dest: dest });
        tone({ t: t, dur: 0.07, type: 'triangle', f: 230, f2: 120, vol: 0.16, decay: true, dest: dest });
        break;
      case 'hat':
        noise({ t: t, dur: e.open ? 0.11 : 0.035, vol: 0.09 * (e.v || 1), filter: 'highpass', f: 7000, q: 0.5, dest: dest });
        break;
    }
  }

  // --------------------------------------------------------------- scheduler
  function tick() {
    var c = cur;
    if (!c || !ctx) return;
    try {
      var sd = 60 / c.td.bpm / 4, horizon = ctx.currentTime + LOOKAHEAD;
      if (c.next < ctx.currentTime - 0.15) c.next = ctx.currentTime + 0.05;   // catch up after a throttled tab
      while (c.next < horizon) {
        var evs = c.td.events[c.step];
        if (evs) for (var i = 0; i < evs.length; i++) playEvent(evs[i], c.next, sd, c.gain, c.td);
        c.next += sd; c.step++;
        if (c.step >= c.td.steps) {
          if (c.td.loop) c.step = 0;
          else {                                        // non-looping: let the tail ring out, then clean up
            clearInterval(c.timer);
            var g = c.gain, wait = Math.max(0, c.next - ctx.currentTime) + 1.5;
            cur = null;
            setTimeout(function () { try { g.disconnect(); } catch (e) { /* */ } }, wait * 1000);
            return;
          }
        }
      }
    } catch (e) { note(e); }
  }

  function startMusic(name) {
    var d = TRACKS[name];
    if (!d) { stopMusic(); return; }
    if (cur && cur.name === name) return;
    stopMusic();
    var td = built[name] || (built[name] = build(name, d));
    var gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(musicBus);
    cur = { name: name, td: td, gain: gain, step: 0, next: ctx.currentTime + 0.08, timer: null };
    cur.timer = setInterval(tick, TICK_MS);
    tick();
  }

  function stopMusic() {
    var c = cur;
    cur = null;
    wantTrack = null;
    if (!c) return;
    try {
      clearInterval(c.timer);
      var t = ctx.currentTime;
      c.gain.gain.cancelScheduledValues(t);
      c.gain.gain.setValueAtTime(c.gain.gain.value, t);
      c.gain.gain.linearRampToValueAtTime(0.0001, t + 0.08);
      setTimeout(function () { try { c.gain.disconnect(); } catch (e) { /* */ } }, 400);
    } catch (e) { /* */ }
  }

  // --------------------------------------------------------------- public API
  function applyMute() {
    if (!master || !ctx) return;
    try { master.gain.setTargetAtTime(Sfx.muted ? 0 : MASTER_VOL, ctx.currentTime, 0.01); } catch (e) { /* */ }
  }

  Sfx.init = function () {
    try {
      if (ctx) { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); return; }
      if (!AC) return;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e1) { ctx = new AC(); }
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6;
      comp.attack.value = 0.003; comp.release.value = 0.2;
      master = ctx.createGain(); master.gain.value = Sfx.muted ? 0 : MASTER_VOL;
      sfxBus = ctx.createGain(); sfxBus.gain.value = SFX_VOL;
      musicBus = ctx.createGain(); musicBus.gain.value = MUSIC_VOL;
      sfxBus.connect(master); musicBus.connect(master);
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = makeNoise();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      try {
        if (global.document && global.document.addEventListener) {
          global.document.addEventListener('visibilitychange', function () {
            try {
              if (!ctx) return;
              if (global.document.hidden) ctx.suspend(); else ctx.resume();
            } catch (e) { /* */ }
          });
        }
      } catch (e2) { /* */ }
      if (wantTrack) { var w = wantTrack; wantTrack = null; startMusic(w); }
    } catch (e) {
      ctx = null; master = sfxBus = musicBus = noiseBuf = null;
    }
  };

  Sfx.play = function (name) {
    try {
      if (!ctx || Sfx.muted) return;
      var fn = SFX[name];
      if (!fn) return;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      fn(ctx.currentTime + 0.01);
    } catch (e) { note(e); }
  };

  Sfx.music = function (track) {
    try {
      if (track === null || track === undefined || track === '') { Sfx.stopMusic(); return; }
      if (!ctx) { wantTrack = String(track); return; }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      startMusic(String(track));
    } catch (e) { note(e); }
  };

  Sfx.stopMusic = function () {
    try { stopMusic(); } catch (e) { /* never throw */ }
  };

  Sfx.setMuted = function (m) {
    try {
      Sfx.muted = !!m;
      applyMute();
      try { if (global.localStorage) global.localStorage.setItem(STORE_KEY, Sfx.muted ? '1' : '0'); } catch (e) { /* */ }
    } catch (e2) { /* never throw */ }
  };

  Sfx.toggleMute = function () {
    Sfx.setMuted(!Sfx.muted);
    return Sfx.muted;
  };

  Sfx.names = function () { return Object.keys(SFX); };
  Sfx.tracks = function () { return Object.keys(TRACKS); };
  Sfx._barErrors = barErrors;
  Sfx._runErrors = runErrors;
  Sfx._build = function () { Object.keys(TRACKS).forEach(function (k) { built[k] = built[k] || build(k, TRACKS[k]); }); return barErrors; };

  global.Sfx = Sfx;
})(typeof window !== 'undefined' ? window : this);
