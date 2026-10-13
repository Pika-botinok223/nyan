/* Paperboy — sprites.js
 * All art is generated in code. window.Sprites is built synchronously by init().
 * Pixel grids are drawn with a tiny helper (Grid) and rendered to offscreen
 * canvases. No anti-aliasing, integer coordinates, limited NES-like palette.
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------ palette
  var PAL = {
    ink: '#14101c', white: '#fcfcfc',
    grey1: '#c8ccd4', grey2: '#8890a0', grey3: '#4c5264',
    red: '#e0381c', darkred: '#98180c', maroon: '#6c1008',
    orange: '#f89030', darkorange: '#b8581c',
    yellow: '#fcdc3c', darkyellow: '#c09a18',
    lime: '#9ce040', green: '#44b030', darkgreen: '#1c7028',
    sky: '#8cd4fc', blue: '#3c78e0', darkblue: '#2040a0',
    skin: '#fcc8a0', skinShade: '#d88c60',
    brown: '#a46630', darkbrown: '#5c3416', tan: '#d89a4c',
    sand: '#ecd6a4', cream: '#fcf0c8',
    purple: '#8c4cb4', darkpurple: '#4c2c6c', pink: '#fc88a8',
    asphalt: '#3c404c', asphaltLight: '#4a4e5c', asphaltDark: '#30343e',
    grassA: '#4cae34', grassB: '#3a9428', grassC: '#68c444',
    deadA: '#a8904c', deadB: '#8c7438', deadC: '#c4aa64', dirt: '#7c5c34',
    concrete: '#c8c8d0', concreteLight: '#e0e0e8', concreteDark: '#9c9cac',
    gloomWall: '#9488a4', gloomWallDark: '#6c6478', gloomDark: '#544c64',
    roofLit: '#e8502c', roofLitLine: '#b02c14', roofLitHi: '#f88c58',
    roofShade: '#b8301c', roofShadeLine: '#7c1810',
    gRoofLit: '#6a5e80', gRoofLitLine: '#463c5c', gRoofHi: '#857a9a',
    gRoofShade: '#4c4264', gRoofShadeLine: '#30284a'
  };

  // one-char palette used by the string sprites
  var CH = {
    k: PAL.ink, w: PAL.white, g: PAL.grey1, G: PAL.grey2, d: PAL.grey3,
    r: PAL.red, R: PAL.darkred, o: PAL.orange, O: PAL.darkorange,
    y: PAL.yellow, Y: PAL.darkyellow, l: PAL.lime, n: PAL.green, N: PAL.darkgreen,
    c: PAL.sky, b: PAL.blue, B: PAL.darkblue, p: PAL.skin, P: PAL.skinShade,
    t: PAL.brown, T: PAL.darkbrown, h: PAL.tan, s: PAL.sand, C: PAL.cream,
    m: PAL.purple, M: PAL.darkpurple, q: PAL.pink,
    a: PAL.asphalt, A: PAL.asphaltLight,
    x: PAL.gloomWallDark, X: PAL.gloomDark, z: PAL.gloomWall
  };

  function col(c) {
    if (c === null || c === undefined || c === '.' || c === ' ') return null;
    if (c.charAt(0) === '#') return c;
    return CH[c] || '#ff00ff';
  }

  // ----------------------------------------------------------------- helpers
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var warnings = [];

  function Grid(w, h) {
    this.w = w; this.h = h;
    this.d = new Array(w * h);
    for (var i = 0; i < w * h; i++) this.d[i] = null;
  }
  Grid.prototype = {
    p: function (x, y, c) {
      x = Math.floor(x); y = Math.floor(y);
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
      this.d[y * this.w + x] = col(c);
      return this;
    },
    pw: function (x, y, c) { // wrapping set (for seamless tiles)
      x = ((Math.floor(x) % this.w) + this.w) % this.w;
      y = ((Math.floor(y) % this.h) + this.h) % this.h;
      this.d[y * this.w + x] = col(c);
      return this;
    },
    g: function (x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
      return this.d[y * this.w + x];
    },
    rect: function (x, y, w, h, c) {
      for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) this.p(x + i, y + j, c);
      return this;
    },
    fill: function (c) { return this.rect(0, 0, this.w, this.h, c); },
    line: function (x0, y0, x1, y1, c, keep) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
      for (;;) {
        if (!keep || this.g(x0, y0)) this.p(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        var e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
      return this;
    },
    brush: function (x0, y0, x1, y1, r, c) { // thick line made of discs
      var n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (var i = 0; i <= n; i++) {
        var t = i / n;
        this.ell(x0 + (x1 - x0) * t + 0.5, y0 + (y1 - y0) * t + 0.5, r, r, c);
      }
      return this;
    },
    ell: function (cx, cy, rx, ry, c) {
      for (var y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (var x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          var nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
          if (nx * nx + ny * ny <= 1) this.p(x, y, typeof c === 'function' ? c(x, y, nx, ny) : c);
        }
      }
      return this;
    },
    ring: function (cx, cy, r, c) {
      for (var y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
        for (var x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
          var d = Math.sqrt(Math.pow(x + 0.5 - cx, 2) + Math.pow(y + 0.5 - cy, 2));
          if (d <= r + 0.5 && d >= r - 0.9) this.p(x, y, c);
        }
      }
      return this;
    },
    rrect: function (x, y, w, h, r, c) {
      for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
        var dx = Math.min(i, w - 1 - i), dy = Math.min(j, h - 1 - j);
        if (dx < r && dy < r && (r - dx) + (r - dy) > r + 0) continue;
        this.p(x + i, y + j, typeof c === 'function' ? c(x + i, y + j, i / (w - 1) * 2 - 1, j / (h - 1) * 2 - 1) : c);
      }
      return this;
    },
    blob: function (circles, fn) {
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, i;
      for (i = 0; i < circles.length; i++) {
        var c = circles[i];
        x0 = Math.min(x0, c[0] - c[2]); x1 = Math.max(x1, c[0] + c[2]);
        y0 = Math.min(y0, c[1] - c[2]); y1 = Math.max(y1, c[1] + c[2]);
      }
      for (var y = Math.floor(y0); y <= Math.ceil(y1); y++) {
        for (var x = Math.floor(x0); x <= Math.ceil(x1); x++) {
          for (i = 0; i < circles.length; i++) {
            var cc = circles[i], dx = x + 0.5 - cc[0], dy = y + 0.5 - cc[1];
            if (dx * dx + dy * dy <= cc[2] * cc[2]) { this.p(x, y, fn(x, y)); break; }
          }
        }
      }
      return this;
    },
    str: function (rows, ox, oy) {
      for (var j = 0; j < rows.length; j++) {
        var row = rows[j];
        if (row.length !== this.w && ox === 0 && rows.fullWidth !== false) {
          warnings.push('row length ' + row.length + ' at ' + j + ': ' + row);
        }
        for (var i = 0; i < row.length; i++) {
          var ch = row.charAt(i);
          if (ch !== '.' && ch !== ' ') this.p(ox + i, oy + j, ch);
        }
      }
      return this;
    },
    outline: function (c, diag) {
      var w = this.w, h = this.h, src = this.d.slice(), x, y;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        if (src[y * w + x]) continue;
        var hit = false;
        if (x > 0 && src[y * w + x - 1]) hit = true;
        else if (x < w - 1 && src[y * w + x + 1]) hit = true;
        else if (y > 0 && src[(y - 1) * w + x]) hit = true;
        else if (y < h - 1 && src[(y + 1) * w + x]) hit = true;
        else if (diag) {
          if (x > 0 && y > 0 && src[(y - 1) * w + x - 1]) hit = true;
          else if (x < w - 1 && y > 0 && src[(y - 1) * w + x + 1]) hit = true;
          else if (x > 0 && y < h - 1 && src[(y + 1) * w + x - 1]) hit = true;
          else if (x < w - 1 && y < h - 1 && src[(y + 1) * w + x + 1]) hit = true;
        }
        if (hit) this.d[y * w + x] = col(c);
      }
      return this;
    },
    blit: function (o, ox, oy) {
      for (var y = 0; y < o.h; y++) for (var x = 0; x < o.w; x++) {
        var v = o.d[y * o.w + x];
        if (v) this.p(ox + x, oy + y, v);
      }
      return this;
    }
  };

  // light from the top-left: returns a colour function for ell/rrect
  function lit(hi, mid, lo, t1, t2) {
    t1 = t1 == null ? -0.3 : t1; t2 = t2 == null ? 0.3 : t2;
    return function (x, y, nx, ny) {
      var v = (nx + ny) * 0.5;
      return v < t1 ? hi : (v > t2 ? lo : mid);
    };
  }

  // ------------------------------------------------------------------ sprites
  var defs = {};
  var order = [];
  function def(name, w, h, frames, fn) {
    defs[name] = { w: w, h: h, frames: frames, fn: fn };
    order.push(name);
  }

  // ---- paperboy ------------------------------------------------------------
  var PB_BODY = [
    '...rGGGGGGGGr...', // y6  handlebars
    '...p..RRRR..p...', // y7  visor
    '...p.rrrrrr.p...', // y8  cap
    '...pbrrrrrRbp...', // y9
    '...bbttttttbb...', // y10 hair
    '....bbPPPPbb....', // y11 neck
    '....bbbbbbbbTTT.', // y12 shoulders + bag
    '....bwwwwwwbtwT.', // y13 shirt stripe
    '....bbbbbbbbttT.', // y14
    '....BBBBBBBBttT.', // y15
    '....ssssssssTT..'  // y16 hips
  ];

  function tire(g, y0, ph) {
    g.rect(7, y0, 2, 5, 'k');
    g.p(7 + (ph & 1), y0 + (ph % 5), 'G');
    g.p(8 - (ph & 1), y0 + ((ph + 2) % 5), 'G');
  }

  function paperboy(f, mode) {
    var g = new Grid(16, 24);
    var ph = mode === 'ride' ? f : 0;
    tire(g, 1, ph);
    tire(g, 18, ph + 2);
    g.rect(7, 6, 2, 2, 'r');
    g.rect(7, 16, 2, 2, 'r');
    g.str(PB_BODY, 0, 6);
    g.rect(7, 12, 2, 4, 'B');         // saddle seen under the back
    var L, R;
    if (mode === 'ride') { L = [3, 2, 0, 1][f]; R = [0, 1, 3, 2][f]; } else { L = 1; R = 2; }
    [[4, L], [10, R]].forEach(function (lg) {
      var x = lg[0], e = lg[1];
      g.rect(x, 17, 2, e + 1, 's');
      g.rect(x + 1, 17, 1, e + 1, 'h');
      g.rect(x, 18 + e, 2, 1, 'w');
      g.rect(x, 19 + e, 2, 1, 'r');
    });
    if (mode === 'wind') {
      var yy; for (yy = 7; yy <= 11; yy++) { g.p(3, yy, null); g.p(4, yy, null); }
      g.p(3, 11, 'b'); g.p(2, 10, 'b'); g.p(2, 9, 'b'); g.p(2, 8, 'p'); g.p(1, 8, 'p');
      g.rect(0, 3, 2, 5, 'w'); g.p(0, 5, 'r'); g.p(1, 5, 'r'); g.p(1, 3, 'g'); g.p(1, 7, 'g');
    } else if (mode === 'release') {
      for (var y2 = 7; y2 <= 11; y2++) { g.p(3, y2, null); g.p(4, y2, null); }
      g.rect(3, 12, 2, 2, 'b'); g.rect(1, 12, 2, 2, 'b'); g.rect(0, 12, 1, 2, 'p');
      g.p(1, 10, 'g'); g.p(0, 9, 'g'); g.p(2, 11, 'g');
    }
    return g.outline('k');
  }
  def('paperboy', 16, 24, 4, function (f) { return paperboy(f, 'ride'); });
  def('paperboy_throw', 16, 24, 2, function (f) { return paperboy(f, f === 0 ? 'wind' : 'release'); });

  // crash helpers
  function bikeAt(g, cx, cy, ang, len) {
    var a = ang * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    var fx = cx + dx * len * 0.5, fy = cy + dy * len * 0.5;
    var rx = cx - dx * len * 0.5, ry = cy - dy * len * 0.5;
    var mx = cx + dx * len * 0.18, my = cy + dy * len * 0.18;
    var sx = cx - dx * len * 0.12, sy = cy - dy * len * 0.12;
    var fw = [cx + dx * len * 0.5, cy + dy * len * 0.5, cx + dx * len * 0.16, cy + dy * len * 0.16];
    var rw = [cx - dx * len * 0.5, cy - dy * len * 0.5, cx - dx * len * 0.18, cy - dy * len * 0.18];
    g.brush(fw[0], fw[1], fw[2], fw[3], 1, 'k');
    g.brush(rw[0], rw[1], rw[2], rw[3], 1, 'k');
    g.line(fw[0], fw[1], fw[2], fw[3], 'G');
    g.line(rw[0], rw[1], rw[2], rw[3], 'G');
    g.line(mx, my, sx, sy, 'r');
    g.line(mx + 1, my, sx + 1, sy, 'r');
    // handlebar perpendicular
    g.line(fw[2] - dy * 3, fw[3] + dx * 3, fw[2] + dy * 3, fw[3] - dx * 3, 'G');
    g.p(sx, sy, 'k'); g.p(sx + 1, sy, 'k');
    return g;
  }
  function puppet(g, head, hip, hL, hR, fL, fR) {
    g.brush(hip[0], hip[1], fL[0], fL[1], 0.8, 's');
    g.brush(hip[0], hip[1], fR[0], fR[1], 0.8, 's');
    g.rect(fL[0] - 1, fL[1] - 1, 2, 2, 'w'); g.p(fL[0], fL[1], 'r');
    g.rect(fR[0] - 1, fR[1] - 1, 2, 2, 'w'); g.p(fR[0], fR[1], 'r');
    g.brush(head[0], head[1], hip[0], hip[1], 1.6, 'b');
    g.line(head[0], head[1] + 1, hip[0], hip[1] - 1, 'c');
    g.brush(head[0], head[1], hL[0], hL[1], 0.6, 'b');
    g.brush(head[0], head[1], hR[0], hR[1], 0.6, 'b');
    g.p(hL[0], hL[1], 'p'); g.p(hR[0], hR[1], 'p');
    g.ell(head[0] + 0.5, head[1] + 0.5, 2.5, 2.5, lit('r', 'r', 'R', -0.2, 0.2));
    g.p(head[0] + 2, head[1], 'R'); g.p(head[0] + 2, head[1] + 1, 'R');
  }
  function star(g, x, y, c) {
    g.p(x, y, c); g.p(x - 1, y, c); g.p(x + 1, y, c); g.p(x, y - 1, c); g.p(x, y + 1, c);
  }
  function paperRoll(g, x, y) { g.rect(x, y, 3, 2, 'w'); g.p(x + 1, y, 'r'); g.p(x + 2, y + 1, 'g'); }

  function crash(f) {
    var g = new Grid(24, 24);
    if (f === 0) {            // losing control
      bikeAt(g, 15, 13, 32, 19);
      puppet(g, [6, 7], [9, 12], [2, 3], [10, 3], [6, 17], [11, 18]);
      star(g, 20, 4, 'y'); star(g, 3, 19, 'y');
      paperRoll(g, 19, 20);
    } else if (f === 1) {     // airborne
      bikeAt(g, 16, 17, 78, 18);
      puppet(g, [6, 8], [11, 8], [3, 3], [9, 2], [16, 5], [15, 11]);
      star(g, 3, 15, 'y'); star(g, 12, 3, 'y');
      paperRoll(g, 1, 20); paperRoll(g, 19, 4);
    } else {                  // flat on the ground, dizzy
      bikeAt(g, 15, 19, 98, 17);
      puppet(g, [5, 15], [10, 15], [3, 11], [3, 19], [14, 14], [15, 11]);
      star(g, 3, 6, 'y'); star(g, 9, 3, 'y'); star(g, 15, 5, 'y'); star(g, 21, 8, 'o');
      paperRoll(g, 1, 21); paperRoll(g, 20, 12);
    }
    return g.outline('k');
  }
  def('paperboy_crash', 24, 24, 3, crash);

  // ---- papers ---------------------------------------------------------------
  function paperFrame(f, size) {
    var g = new Grid(8, 8), a = f * Math.PI / 4;
    var dx = Math.cos(a) * 1.7, dy = Math.sin(a) * 1.7;
    var x0 = 4 - dx, y0 = 4 - dy, x1 = 4 + dx, y1 = 4 + dy;
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
      var px = x + 0.5, py = y + 0.5;
      var vx = x1 - x0, vy = y1 - y0, L = vx * vx + vy * vy;
      var t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / L));
      var ex = x0 + vx * t - px, ey = y0 + vy * t - py;
      var dd = Math.sqrt(ex * ex + ey * ey);
      if (dd <= 1.35) {
        var c = 'w';
        if (t > 0.42 && t < 0.58) c = 'r';
        else if (dd > 0.75 && (px + py) > 8) c = 'g';
        else if ((x + y) % 3 === 0 && dd > 0.3) c = 'g';
        g.p(x, y, c);
      }
    }
    return g.outline('k');
  }
  def('paper', 8, 8, 4, function (f) { return paperFrame(f); });
  def('icon_paper', 8, 8, 1, function () { return paperFrame(1); });

  def('paper_bundle', 12, 10, 1, function () {
    var g = new Grid(12, 10);
    g.rect(1, 1, 10, 4, 'w');           // top face
    g.rect(1, 5, 10, 4, 'g');           // front face
    g.rect(1, 6, 10, 1, 'G'); g.rect(1, 8, 10, 1, 'G');
    g.rect(2, 2, 4, 1, 'G'); g.rect(2, 3, 6, 1, 'g'); g.p(8, 2, 'r'); g.p(9, 2, 'r');
    g.rect(3, 1, 1, 8, 'y'); g.rect(8, 1, 1, 8, 'y');
    g.p(3, 1, 'Y'); g.p(8, 1, 'Y');
    return g.outline('k');
  });

  // ---- icons ----------------------------------------------------------------
  def('icon_life', 8, 8, 1, function () {
    return new Grid(8, 8).str([
      '..kkkk..',
      '.krrrrk.',
      'krrRRrrk',
      'kppppppk',
      'kpkppkpk',
      'kppppppk',
      '.kppppk.',
      '..kkkk..'], 0, 0);
  });
  def('icon_house', 8, 8, 1, function () {
    return new Grid(8, 8).str([
      '...kk...',
      '..krrk..',
      '.krrrrk.',
      'krrrrrrk',
      '.kwwwwk.',
      '.kwyywk.',
      '.kwyywk.',
      '.kkkkkk.'], 0, 0);
  });

  // ---- houses ---------------------------------------------------------------
  var HOUSE = {
    windows: [{ x: 64, y: 10, w: 10, h: 10 }, { x: 64, y: 60, w: 10, h: 10 }],
    door: { x: 64, y: 31, w: 12, h: 16 },
    porch: { x: 80, y: 28, w: 14, h: 24 }
  };

  function zig(g, x, y, steps, c, keep) {
    var cx = x, cy = y;
    for (var i = 0; i < steps.length; i++) {
      var nx = cx + steps[i][0], ny = cy + steps[i][1];
      g.line(cx, cy, nx, ny, c, keep);
      cx = nx; cy = ny;
    }
  }

  function house(sub) {
    var g = new Grid(96, 80), x, y, i;
    var RX1 = 53, RIDGE = 27, WX = 54;   // roof right edge, ridge column, wall left edge
    var Rl = sub ? PAL.roofLit : PAL.gRoofLit, Rll = sub ? PAL.roofLitLine : PAL.gRoofLitLine;
    var Rh = sub ? PAL.roofLitHi : PAL.gRoofHi;
    var Rs = sub ? PAL.roofShade : PAL.gRoofShade, Rsl = sub ? PAL.roofShadeLine : PAL.gRoofShadeLine;
    // roof
    for (y = 2; y <= 77; y++) for (x = 2; x <= RX1; x++) {
      var dx = Math.min(x - 2, RX1 - x), dy = Math.min(y - 2, 77 - y);
      if (dx + dy < 3) continue;
      var band = Math.floor((y - 2) / 4), r = (y - 2) % 4, c;
      if (x === RIDGE) c = sub ? PAL.roofLitHi : PAL.gRoofHi;
      else if (x === RIDGE + 1) c = sub ? PAL.roofShadeLine : PAL.gRoofShadeLine;
      else if (x < RIDGE) {
        c = Rl;
        if (r === 3) c = Rll;
        else if (r === 0 && (x + band) % 3 !== 0) c = Rh;
        else if (((x - (band % 2) * 3) % 6 + 6) % 6 === 0) c = Rll;
      } else {
        c = Rs;
        if (r === 3) c = Rsl;
        else if (((x - (band % 2) * 3) % 6 + 6) % 6 === 0) c = Rsl;
      }
      g.p(x, y, c);
    }
    // eave / fascia on the street side
    for (y = 4; y <= 75; y++) {
      g.p(RX1 - 1, y, sub ? '#fcf0e0' : PAL.gloomWall);
      g.p(RX1, y, sub ? '#d8c8b0' : PAL.gloomWallDark);
    }
    // chimney (brick, with cap and shadow)
    var cxh = 8, cyh = 18, brick = sub ? '#c0502c' : '#5c5070', mort = sub ? '#ecb89c' : '#7c7090';
    g.rect(cxh, cyh, 9, 10, brick);
    for (y = 0; y < 10; y++) {
      if (y % 3 === 2) g.rect(cxh, cyh + y, 9, 1, mort);
      else for (x = ((Math.floor(y / 3) % 2) * 2 + 1); x < 9; x += 4) g.p(cxh + x, cyh + y, mort);
    }
    g.rect(cxh + 6, cyh, 3, 10, sub ? 'R' : 'X');       // shaded side
    for (y = 0; y < 10; y++) if (y % 3 === 2) g.p(cxh + 6, cyh + y, sub ? '#a8685c' : '#605478');
    g.rect(cxh - 1, cyh - 1, 11, 3, sub ? 'g' : 'G'); g.rect(cxh - 1, cyh + 1, 11, 1, sub ? 'G' : 'd');
    g.rect(cxh + 2, cyh, 5, 1, 'k');
    g.rect(cxh + 10, cyh + 1, 2, 10, sub ? PAL.roofLitLine : PAL.gRoofLitLine);   // cast shadow on roof
    // wall
    var wallC = sub ? PAL.cream : PAL.gloomWall, wallL = sub ? PAL.sand : PAL.gloomWallDark;
    g.rect(WX, 3, 80 - WX, 74, wallC);
    for (y = 3; y <= 76; y++) {
      if ((y - 3) % 3 === 2) for (x = WX; x < 80; x++) g.p(x, y, wallL);
      g.p(WX, y, 'k');
      g.p(WX + 1, y, sub ? '#d0b078' : PAL.gloomDark);       // eave shadow
      g.p(WX + 2, y, sub ? '#e4cc98' : PAL.gloomWallDark);
    }
    g.rect(WX, 3, 80 - WX, 2, sub ? 'w' : PAL.gloomWallDark);
    g.rect(WX, 75, 80 - WX, 2, sub ? 'w' : PAL.gloomWallDark);
    g.rect(WX, 4, 80 - WX, 1, 'k'); g.rect(WX, 76, 80 - WX, 1, 'k');
    // downspout and wall lamp
    if (sub) {
      g.rect(57, 6, 2, 68, 'g'); g.rect(58, 6, 1, 68, 'G');
      for (y = 12; y < 74; y += 14) g.rect(56, y, 4, 1, 'G');
      g.rect(61, 34, 3, 4, 'k'); g.rect(62, 35, 1, 2, 'y'); g.p(61, 33, 'G');
    } else {
      g.rect(57, 6, 2, 30, 'G'); g.rect(58, 6, 1, 30, 'd');
      g.rect(59, 40, 2, 34, 'G'); g.rect(60, 40, 1, 34, 'd'); g.p(58, 36, 'G'); g.p(59, 38, 'd');
      g.rect(61, 34, 3, 4, 'k'); g.p(62, 36, 'M'); g.p(62, 35, 'd');
    }
    // shutters + flower boxes
    HOUSE.windows.forEach(function (wn, wi) {
      var wy = wn.y, lx = wn.x - 3, rx = wn.x + 11, bx0 = wn.x - 1;
      if (sub) {
        [lx, rx].forEach(function (sx) {
          g.rect(sx, wy, 2, 10, 'n');
          for (var k = 1; k < 10; k += 2) g.rect(sx, wy + k, 2, 1, 'N');
          g.p(sx, wy, 'l'); g.p(sx, wy + 4, 'l'); g.p(sx, wy + 8, 'l');
        });
        for (var fx = bx0; fx < bx0 + 12; fx += 2) { g.p(fx, wy + 10, (fx % 4 === 1) ? 'r' : 'y'); g.p(fx + 1, wy + 10, (fx % 4 === 1) ? 'q' : 'n'); }
        g.rect(bx0, wy + 11, 12, 2, 't'); g.rect(bx0, wy + 12, 12, 1, 'T');
      } else {
        g.rect(lx, wy + 3, 2, 8, 'M');                // dangling, dropped shutter
        for (var k2 = 4; k2 < 11; k2 += 2) g.rect(lx, wy + k2, 2, 1, 'k');
        g.p(lx, wy + 3, 'x'); g.p(lx + 1, wy + 2, 'M');
        g.rect(rx, wy, 2, 10, PAL.gloomDark);          // outline of a missing shutter
        g.p(rx, wy, 'M'); g.p(rx, wy + 1, 'M'); g.p(rx + 1, wy + 2, 'M'); g.p(rx + 1, wy + 3, 'k');
        g.rect(bx0, wy + 11, 12, 2, 'X');
        g.p(bx0 + 2, wy + 10, 'T'); g.p(bx0 + 3, wy + 9, 'T'); g.p(bx0 + 7, wy + 10, 'T'); g.p(bx0 + 8, wy + 10, 'T'); g.p(bx0 + 9, wy + 9, 'T');
        g.p(bx0 + 5, wy + 12, 'k'); g.p(bx0 + 6, wy + 11, 'k');
        zig(g, bx0 + 1, wy + 14, [[2, 2], [-1, 3], [3, 3]], 'x', true);
      }
    });
    // door frame, awning
    g.rect(63, 30, 14, 18, sub ? 'w' : PAL.gloomWallDark);
    g.rect(63, 30, 14, 1, sub ? 'g' : 'X');
    for (x = 60; x < 80; x++) {
      for (y = 25; y <= 28; y++) {
        var stripe = ((x - 60) >> 1) % 2 === 0;
        if (sub) g.p(x, y, stripe ? 'r' : 'w');
        else g.p(x, y, stripe ? 'X' : 'M');
      }
      if (sub) g.p(x, 29, ((x - 60) >> 1) % 2 === 0 ? 'R' : 'g');
      else if (x % 3 !== 1) g.p(x, 29, 'M');
    }
    if (!sub) { g.p(64, 28, null); g.p(65, 28, null); g.p(71, 27, null); g.p(71, 28, null); g.p(72, 28, null); g.p(77, 27, null); }
    // stoop / porch
    var stoop = sub ? '#e8dcc0' : '#8e869c', stoopHi = sub ? '#fcf4dc' : '#a29aae', stoopLo = sub ? '#b8a888' : '#5a5268';
    g.rect(80, 28, 13, 24, stoop);
    g.rect(80, 28, 13, 1, stoopHi);
    g.rect(80, 51, 13, 1, stoopLo);
    g.rect(91, 28, 2, 24, stoopLo); g.rect(90, 29, 1, 22, stoopLo);   // step edge
    g.rect(93, 35, 3, 10, sub ? PAL.concrete : '#8a8498');                // walkway start
    g.rect(93, 35, 3, 1, sub ? PAL.concreteLight : stoopHi);
    g.rect(93, 44, 3, 1, sub ? PAL.concreteDark : stoopLo);
    if (sub) {
      g.rect(81, 34, 5, 10, 'r');
      for (y = 35; y < 43; y += 2) g.rect(82, y, 3, 1, 'R');
      g.rect(81, 34, 5, 1, 'o'); g.rect(81, 43, 5, 1, 'R');
      g.rect(87, 30, 3, 3, 't'); g.p(88, 29, 'n'); g.p(87, 29, 'l'); g.p(89, 29, 'n'); g.p(88, 28, 'r');
      g.rect(87, 46, 3, 3, 't'); g.p(88, 45, 'n'); g.p(87, 45, 'n'); g.p(89, 45, 'l'); g.p(88, 44, 'y');
    } else {
      zig(g, 82, 28, [[2, 6], [-2, 5], [3, 6], [-1, 6]], 'k', true);
      zig(g, 88, 40, [[2, 3], [-1, 3], [2, 3]], 'k', true);
      g.p(84, 38, 'N'); g.p(85, 37, 'N'); g.p(85, 38, 'N'); g.p(86, 36, 'N');
      g.p(82, 47, 'N'); g.p(83, 46, 'N'); g.p(83, 47, 'N');
      g.p(87, 31, 'T'); g.p(88, 32, 'T'); g.p(86, 49, 'T'); g.p(84, 44, 'T');
    }
    // roof character
    if (sub) {
      g.ell(12.5, 10.5, 2.5, 2, 'w'); g.ell(16, 7, 2, 1.7, 'g'); g.ell(13, 4, 1.6, 1.3, 'w');   // smoke
      g.rect(12, 42, 8, 8, 'c'); g.rect(12, 42, 8, 1, 'w'); g.rect(12, 42, 1, 8, 'w');
      g.rect(16, 42, 1, 8, 'w'); g.rect(12, 46, 8, 1, 'w'); g.p(14, 44, 'w'); g.p(18, 48, 'b');
      g.rect(12, 50, 8, 1, 'k'); g.rect(20, 42, 1, 9, 'k');                                 // skylight
      g.rect(34, 25, 3, 1, 'o'); g.rect(40, 55, 3, 1, 'r');
    } else {
      [[6, 40, 7, 5], [14, 62, 6, 4], [36, 20, 6, 4], [40, 46, 7, 6], [20, 8, 5, 3]].forEach(function (pt) {
        for (var yy = 0; yy < pt[3]; yy++) for (var xx = 0; xx < pt[2]; xx++) {
          if (((xx * 7 + yy * 3) % 5) === 0 && (yy === 0 || xx === 0)) continue;
          g.p(pt[0] + xx, pt[1] + yy, (xx + yy) % 4 === 0 ? 'X' : '#2a2238');
        }
      });
      var rr = rng(7);
      for (i = 0; i < 26; i++) g.p(4 + Math.floor(rr() * 48), 4 + Math.floor(rr() * 72), '#3c5c34');
      zig(g, 24, 3, [[-2, 7], [3, 6], [-3, 9], [2, 8], [-1, 10]], 'k', true);
      zig(g, 44, 28, [[2, 5], [-3, 6], [2, 7], [-2, 6]], 'k', true);
      g.line(34, 14, 39, 8, 'k'); g.line(34, 14, 36, 8, 'k'); g.line(34, 14, 42, 12, 'k');  // tilted aerial
    }
    if (!sub) {
      zig(g, 70, 4, [[1, 5], [-2, 4], [2, 6], [-1, 6]], 'k', true);
      zig(g, 70, 50, [[1, 3], [-2, 4], [2, 4], [0, 6]], 'k', true);
      zig(g, 74, 70, [[-1, 3], [2, 3]], 'k', true);
    }
    return g.outline('k');
  }
  def('house_sub', 96, 80, 1, function () { return house(true); });
  def('house_nonsub', 96, 80, 1, function () { return house(false); });

  // ---- window, door ----------------------------------------------------------
  function windowG(broken) {
    var g = new Grid(10, 10);
    g.rect(0, 0, 10, 10, 'k');
    g.rect(1, 1, 8, 8, 'w');
    g.rect(2, 2, 6, 6, 'c');
    g.rect(2, 7, 6, 1, 'b');            // darker sky under
    g.rect(4, 2, 2, 6, 'w'); g.rect(2, 4, 6, 2, 'w'); // muntins
    g.p(2, 2, 'w'); g.p(3, 3, 'w'); g.p(6, 2, 'w'); g.p(7, 3, 'w'); // glints
    g.rect(1, 9, 8, 1, 'G'); g.rect(0, 9, 10, 1, 'k');
    g.rect(1, 8, 8, 1, 'g');
    if (broken) {
      var pat = ['ccw...', 'cw....', 'w....w', '....wc', '...wcc', 'c.wccc'];
      for (var j = 0; j < 6; j++) for (var i = 0; i < 6; i++) {
        var ch = pat[j].charAt(i);
        g.p(2 + i, 2 + j, ch === '.' ? '#241c3c' : ch);
      }
      g.p(3, 3, 'M'); g.p(5, 4, '#3a2c5c'); g.p(4, 6, '#3a2c5c');   // shapes inside the dark room
      g.p(1, 3, 'g'); g.p(8, 6, 'g');                                // chipped frame
    }
    return g;
  }
  def('window', 10, 10, 1, function () { return windowG(false); });
  def('window_broken', 10, 10, 1, function () { return windowG(true); });

  def('door', 12, 16, 1, function () {
    var g = new Grid(12, 16);
    g.rect(0, 0, 12, 16, 'k');
    g.rect(1, 1, 10, 15, 'w');             // frame
    g.rect(2, 2, 8, 14, 't');
    g.rect(2, 2, 8, 1, 'O');
    g.rect(3, 3, 6, 3, 'c');                // little window
    g.p(3, 3, 'w'); g.p(4, 4, 'w'); g.rect(3, 5, 6, 1, 'b');
    g.rect(3, 3, 6, 1, 'w'); g.rect(5, 3, 1, 3, 'w'); g.rect(3, 3, 1, 3, 'w'); g.rect(8, 3, 1, 3, 'w');
    g.rect(3, 7, 3, 3, 'T'); g.rect(6, 7, 3, 3, 'T');
    g.rect(3, 11, 3, 4, 'T'); g.rect(6, 11, 3, 4, 'T');
    // bevels of recessed panels
    [[3, 7], [6, 7], [3, 11], [6, 11]].forEach(function (pn, i) {
      var h = i < 2 ? 3 : 4;
      g.rect(pn[0], pn[1], 3, 1, 'O'); g.rect(pn[0], pn[1], 1, h, 'O');
      g.rect(pn[0] + 2, pn[1] + 1, 1, h - 1, 'h'); g.rect(pn[0] + 1, pn[1] + h - 1, 2, 1, 'h');
    });
    g.p(8, 6, 'y'); g.p(8, 7, 'Y');          // knob (street side hand)
    g.p(9, 6, 'y');
    g.rect(1, 15, 10, 1, 'g');
    return g;
  });

  // ---- mailbox ----------------------------------------------------------------
  function mailbox(state) {
    var g = new Grid(8, 12);
    if (state === 'broken') {
      g.line(0, 11, 5, 8, 'T'); g.line(0, 10, 5, 7, 't');   // snapped post lying down
      g.rect(3, 5, 5, 5, 'b'); g.rect(3, 5, 5, 1, 'c'); g.rect(3, 9, 5, 1, 'B');
      g.rect(6, 5, 2, 5, 'M');                                  // open end
      g.p(4, 6, 'c'); g.p(5, 7, 'B');
      g.line(3, 5, 4, 7, 'k'); g.line(7, 6, 6, 9, 'G');
      g.p(2, 3, 'r'); g.p(1, 3, 'r'); g.p(2, 4, 'R');           // bent flag
      g.p(6, 11, 'w'); g.p(7, 11, 'g'); g.p(5, 11, 'g');         // spilled paper
      return g.outline('k');
    }
    g.rect(3, 7, 2, 5, 'T'); g.p(3, 7, 't'); g.p(3, 8, 't'); g.p(3, 9, 't');
    g.ell(4, 4, 3.2, 2.7, lit('c', 'b', 'B', -0.35, 0.35));
    g.rect(3, 1, 3, 1, 'c');
    g.p(6, 3, 'M'); g.p(6, 4, 'M'); g.p(6, 5, 'M');       // mouth faces the street
    if (state === 'hit') {
      g.rect(5, 3, 3, 2, 'w'); g.p(7, 3, 'g'); g.p(5, 4, 'g');
      g.rect(0, 0, 1, 4, 'r'); g.p(1, 0, 'r'); g.p(1, 1, 'R');
    } else {
      g.rect(0, 5, 1, 3, 'r'); g.p(0, 7, 'R');
    }
    return g.outline('k');
  }
  def('mailbox', 8, 12, 1, function () { return mailbox('idle'); });
  def('mailbox_hit', 8, 12, 1, function () { return mailbox('hit'); });
  def('mailbox_broken', 8, 12, 1, function () { return mailbox('broken'); });

  // ---- car ------------------------------------------------------------------
  def('car', 20, 32, 2, function (f) {
    var g = new Grid(20, 32);
    var body = lit('#f46a48', 'r', 'R', -0.25, 0.3);
    // wheels
    [[0, 6], [0, 21], [18, 6], [18, 21]].forEach(function (w) { g.rect(w[0], w[1], 2, 6, 'k'); g.p(w[0] + (w[0] ? 0 : 1), w[1] + 1, 'd'); g.p(w[0] + (w[0] ? 0 : 1), w[1] + 4, 'd'); });
    g.rrect(2, 1, 16, 29, 3, body);
    g.rect(2, 28, 16, 2, 'R');             // front bumper shade
    g.rect(4, 30, 12, 1, 'G'); g.rect(5, 30, 10, 1, 'g');
    // hood details
    g.rect(9, 21, 2, 7, 'R'); g.rect(8, 22, 1, 5, 'o'); g.rect(11, 22, 1, 5, 'R');
    g.rect(4, 22, 3, 1, 'o'); g.rect(13, 22, 3, 1, 'R');
    // windshield (front is the bottom, slanted trapezoid)
    for (var y = 0; y < 5; y++) {
      var inset = y < 2 ? 3 + (1 - y) : 3;
      g.rect(inset + 1 - 1 + 0, 15 + y, 20 - 2 * (inset), 1, y < 3 ? 'c' : 'b');
    }
    g.rect(4, 15, 12, 1, 'k'); g.rect(3, 19, 14, 1, 'k');
    g.p(5, 16, 'w'); g.p(6, 16, 'w'); g.p(6, 17, 'w'); g.p(10, 16, 'w');
    // roof
    g.rect(4, 8, 12, 7, '#f46a48'); g.rect(4, 8, 12, 1, '#f89878'); g.rect(4, 14, 12, 1, 'R');
    g.rect(15, 8, 1, 7, 'R');
    g.rect(5, 9, 5, 1, '#fac0a8');
    // rear window + trunk
    g.rect(5, 4, 10, 4, 'B'); g.rect(5, 4, 10, 1, 'b'); g.p(6, 5, 'c'); g.p(7, 5, 'c');
    g.rect(4, 3, 12, 1, 'R');
    // tail lights
    g.rect(3, 1, 3, 2, 'o'); g.rect(14, 1, 3, 2, 'o'); g.p(3, 1, 'y'); g.p(16, 1, 'y');
    // mirrors
    g.p(1, 15, 'R'); g.p(1, 16, 'R'); g.p(18, 15, 'R'); g.p(18, 16, 'R');
    // grille / plate
    g.rect(8, 29, 4, 1, 'k');
    g.outline('k');
    // headlights (front = bottom), flicker between frames
    if (f === 0) {
      g.rect(3, 27, 4, 3, 'w'); g.rect(13, 27, 4, 3, 'w');
      g.rect(4, 28, 2, 2, 'y'); g.rect(14, 28, 2, 2, 'y');
      g.rect(3, 31, 4, 1, 'y'); g.rect(13, 31, 4, 1, 'y');
    } else {
      g.rect(3, 27, 4, 3, 'Y'); g.rect(13, 27, 4, 3, 'Y');
      g.rect(4, 28, 2, 2, 'y'); g.rect(14, 28, 2, 2, 'y');
      g.rect(4, 31, 2, 1, 'Y'); g.rect(14, 31, 2, 1, 'Y');
    }
    return g;
  });

  // ---- dog ------------------------------------------------------------------
  def('dog', 16, 12, 2, function (f) {
    var g = new Grid(16, 12);
    var fur = lit('h', 't', 't', -0.35, 0.8);
    if (f === 0) {            // stretched out, mid-leap
      g.brush(9, 7, 13, 10, 0.8, 'T'); g.brush(4, 7, 1, 10, 0.8, 'T');
      g.brush(11, 7, 15, 10, 0.8, 't'); g.brush(6, 7, 3, 10, 0.8, 't');
    } else {                  // legs gathered under the body
      g.brush(8, 7, 9, 10, 0.8, 'T'); g.brush(4, 7, 4, 10, 0.8, 'T');
      g.brush(10, 7, 11, 10, 0.8, 't'); g.brush(6, 7, 7, 10, 0.8, 't');
    }
    g.ell(7, 5, 5.3, 3, fur);
    g.rect(3, 7, 8, 1, 'T');                          // belly shade
    g.ell(12.5, 3.5, 2.8, 2.6, lit('h', 'h', 't', -0.4, 0.6));
    g.rect(14, 3, 2, 3, 'h'); g.p(15, 3, 'k'); g.p(14, 5, 'P');      // snout, nose, mouth
    g.rect(9, 1, 2, 4, 'T'); g.p(9, 5, 'T'); g.p(10, 0, 'T');       // floppy ear
    g.p(13, 2, 'k');                                                   // eye
    g.rect(14, 6, 1, 2, 'q');                                          // tongue
    g.rect(9, 5, 1, 2, 'r');                                           // collar
    if (f === 0) { g.line(2, 4, 0, 1, 't'); g.line(2, 5, 1, 2, 't'); g.p(0, 0, 'h'); }
    else { g.line(2, 4, 0, 3, 't'); g.line(2, 5, 0, 4, 't'); g.p(0, 2, 'h'); }
    return g.outline('k');
  });

  // ---- skater ---------------------------------------------------------------
  def('skater', 12, 20, 2, function (f) {
    var g = new Grid(12, 20);
    // deck + wheels
    g.rrect(3, 0, 6, 20, 2, lit('m', 'm', 'M', -0.3, 0.5));
    g.rect(5, 1, 2, 2, 'q'); g.rect(5, 17, 2, 2, 'q');
    g.rect(2, 3, 1, 2, 'k'); g.rect(9, 3, 1, 2, 'k'); g.rect(2, 15, 1, 2, 'k'); g.rect(9, 15, 1, 2, 'k');
    // legs
    g.rect(4, 12, 2, 4, 'B'); g.rect(6, 11, 2, 4, 'b');
    g.rect(4, 16, 2, 1, 'w'); g.rect(6, 15, 2, 1, 'w'); g.p(4, 16, 'r'); g.p(5, 16, 'w');
    // torso
    g.rrect(3, 7, 6, 6, 1, lit('o', 'o', 'O', -0.4, 0.4));
    g.rect(3, 9, 6, 1, 'y');
    // arms balance
    if (f === 0) {
      g.line(3, 8, 0, 6, 'o'); g.line(8, 10, 11, 12, 'o'); g.p(0, 5, 'p'); g.p(11, 13, 'p');
    } else {
      g.line(3, 10, 0, 12, 'o'); g.line(8, 8, 11, 6, 'o'); g.p(0, 13, 'p'); g.p(11, 5, 'p');
    }
    // head with cap worn backwards
    g.ell(6, 5, 2.6, 2.6, lit('p', 'p', 'P', -0.5, 0.5));
    g.rect(4, 3, 5, 2, 'g'); g.rect(4, 3, 5, 1, 'w'); g.p(8, 5, 'g');
    g.p(5, 5, 'k'); g.p(7, 5, 'k');
    return g.outline('k');
  });

  // ---- worker / breakdancer -----------------------------------------------------
  def('worker', 12, 20, 2, function (f) {
    var g = new Grid(12, 20);
    if (f === 0) {
      g.rect(3, 14, 3, 5, 'B'); g.rect(6, 14, 3, 5, 'b');
      g.rect(3, 18, 3, 1, 'k'); g.rect(6, 18, 3, 1, 'k');
      g.rrect(2, 7, 8, 8, 2, lit('o', 'o', 'O', -0.4, 0.4));
      g.rect(5, 7, 1, 8, 'y'); g.rect(2, 11, 8, 1, 'y');
      g.rect(0, 9, 2, 6, 'o'); g.rect(10, 9, 2, 6, 'O'); g.p(0, 15, 'p'); g.p(1, 15, 'p'); g.p(10, 15, 'p'); g.p(11, 15, 'p');
      g.ell(6, 4.5, 3.2, 3.2, lit('y', 'y', 'Y', -0.4, 0.4));
      g.rect(3, 6, 6, 1, 'Y');
      g.p(5, 3, 'w');
    } else {
      // headspin / windmill: legs V up, arms out
      g.line(5, 13, 1, 19, 'b'); g.line(6, 13, 2, 19, 'B'); g.rect(0, 18, 3, 2, 'k');
      g.line(7, 13, 10, 19, 'b'); g.line(6, 13, 9, 19, 'B'); g.rect(9, 18, 3, 2, 'k');
      g.rrect(2, 7, 8, 7, 2, lit('o', 'o', 'O', -0.4, 0.4));
      g.rect(5, 7, 1, 7, 'y'); g.rect(2, 10, 8, 1, 'y');
      g.line(2, 8, 0, 4, 'o'); g.line(9, 9, 11, 13, 'O'); g.p(0, 3, 'p'); g.p(11, 14, 'p');
      g.ell(6, 3.5, 3.2, 3.2, lit('y', 'y', 'Y', -0.4, 0.4));
      g.rect(3, 5, 6, 1, 'Y');
      g.p(4, 2, 'w');
    }
    return g.outline('k');
  });

  // ---- street furniture --------------------------------------------------------
  def('hydrant', 8, 10, 1, function () {
    var g = new Grid(8, 10);
    g.rect(2, 3, 4, 5, 'r');
    g.rect(2, 3, 1, 5, '#f88868'); g.rect(5, 3, 1, 5, 'R');
    g.ell(4, 3, 2.3, 1.8, lit('#f88868', 'r', 'R', -0.3, 0.3));
    g.rect(3, 0, 2, 1, 'y');
    g.rect(0, 4, 2, 2, 'y'); g.rect(6, 4, 2, 2, 'Y');
    g.rect(1, 8, 6, 1, 'R'); g.rect(1, 7, 6, 1, 'r'); g.rect(1, 7, 1, 1, '#f88868');
    g.rect(2, 6, 4, 1, 'G');
    return g.outline('k');
  });

  def('trashcan', 10, 12, 1, function () {
    var g = new Grid(10, 12);
    g.rect(1, 5, 8, 6, 'G');
    for (var x = 2; x < 9; x += 2) g.rect(x, 5, 1, 6, 'd');
    g.rect(1, 5, 1, 6, 'g'); g.rect(1, 10, 8, 1, 'd');
    g.ell(5, 4, 4.4, 3.3, lit('w', 'g', 'G', -0.4, 0.3));
    g.rect(4, 3, 3, 1, 'd'); g.rect(4, 2, 3, 1, 'G');
    g.p(2, 4, 'w'); g.p(3, 3, 'w');
    return g.outline('k');
  });

  def('tree', 24, 32, 1, function () {
    var g = new Grid(24, 32);
    var r = rng(11);
    // ground shadow (dithered)
    for (var y = 26; y < 31; y++) for (var x = 4; x < 21; x++) {
      var nx = (x - 12.5) / 8.5, ny = (y - 28.5) / 2.5;
      if (nx * nx + ny * ny <= 1 && (x + y) % 2 === 0) g.p(x, y, 'N');
    }
    // trunk
    g.rect(10, 20, 4, 9, 't'); g.rect(10, 20, 1, 9, 'h'); g.rect(13, 20, 1, 9, 'T');
    g.rect(9, 28, 6, 1, 'T'); g.p(9, 27, 'T'); g.p(14, 27, 'T');
    g.outline('k');
    var circles = [[12, 10, 9.5], [6, 12, 5.8], [18, 12, 5.8], [8.5, 5.5, 5.8], [15.5, 5.5, 5.8], [12, 16.5, 5.8]];
    g.blob(circles, function (x, y) {
      var v = (x - 12) + (y - 9);
      var c = v < -5 ? 'l' : (v > 7 ? 'N' : 'n');
      if (c === 'n' && v > 3 && (x + y) % 3 === 0) c = 'N';
      return c;
    });
    for (var i = 0; i < 22; i++) {
      var px = 3 + Math.floor(r() * 18), py = 2 + Math.floor(r() * 17);
      var cur = g.g(px, py);
      if (cur === PAL.green && px + py < 24) g.p(px, py, 'l');
      else if (cur === PAL.green) g.p(px, py, 'N');
    }
    // leaf cluster outlines inside canopy
    [[7, 9], [15, 8], [11, 14], [17, 15], [8, 15]].forEach(function (c) {
      g.p(c[0], c[1], 'N'); g.p(c[0] + 1, c[1], 'N'); g.p(c[0] + 2, c[1] + 1, 'N');
    });
    // outline canopy only (trunk already outlined)
    var snap = g.d.slice(), w = g.w;
    for (y = 0; y < 32; y++) for (x = 0; x < 24; x++) {
      if (snap[y * w + x]) continue;
      if ((x > 0 && snap[y * w + x - 1] && snap[y * w + x - 1] !== PAL.ink) || (x < 23 && snap[y * w + x + 1] && snap[y * w + x + 1] !== PAL.ink) ||
          (y > 0 && snap[(y - 1) * w + x] && snap[(y - 1) * w + x] !== PAL.ink) || (y < 31 && snap[(y + 1) * w + x] && snap[(y + 1) * w + x] !== PAL.ink)) {
        g.d[y * w + x] = PAL.ink;
      }
    }
    return g;
  });

  def('bush', 16, 12, 1, function () {
    var g = new Grid(16, 12);
    g.blob([[8, 6.5, 5.2], [4.5, 7, 3.8], [11.5, 7, 3.8], [6, 4.5, 3.5], [10.5, 4.5, 3.5]], function (x, y) {
      var v = (x - 8) + (y - 6);
      var c = v < -3 ? 'l' : (v > 4 ? 'N' : 'n');
      if (c === 'n' && (x * 3 + y * 5) % 7 === 0) c = 'N';
      return c;
    });
    g.p(5, 4, 'r'); g.p(10, 6, 'r'); g.p(7, 8, 'r'); g.p(12, 8, 'y'); g.p(3, 7, 'y');
    g.rect(3, 10, 10, 1, 'N');
    return g.outline('k');
  });

  def('flowers', 16, 16, 1, function () {
    var g = new Grid(16, 16);
    g.ell(8, 9, 7.5, 5.5, lit('t', 'T', 'T', -0.5, 0.6));
    g.ring(8, 9, 6.6, 'T');
    var leaves = [[3, 8], [6, 6], [10, 7], [12, 10], [5, 11], [9, 12], [8, 9]];
    leaves.forEach(function (l) { g.p(l[0], l[1], 'n'); g.p(l[0] + 1, l[1] + 1, 'N'); g.p(l[0] - 1, l[1] + 1, 'n'); });
    [[3, 7, 'r'], [7, 5, 'y'], [11, 6, 'q'], [13, 9, 'w'], [5, 10, 'y'], [9, 11, 'r'], [8, 8, 'm'], [4, 9, 'q'], [12, 11, 'y']].forEach(function (f) {
      var cx = f[0], cy = f[1], c = f[2];
      g.p(cx - 1, cy, c); g.p(cx + 1, cy, c); g.p(cx, cy - 1, c); g.p(cx, cy + 1, c);
      g.p(cx, cy, c === 'y' ? 'O' : 'y');
    });
    return g;
  });

  // ---- tiles -----------------------------------------------------------------
  function grassTile(seed, dead) {
    var g = new Grid(16, 16), r = rng(seed);
    var base = dead ? PAL.deadA : PAL.grassA, dk = dead ? PAL.deadB : PAL.grassB, lt = dead ? PAL.deadC : PAL.grassC;
    g.fill(base);
    var i, x, y;
    for (i = 0; i < 20; i++) {         // blades
      x = Math.floor(r() * 16); y = Math.floor(r() * 16);
      g.pw(x, y, dk); g.pw(x, y - 1, dk); g.pw(x + 1, y, lt);
    }
    for (i = 0; i < 9; i++) { x = Math.floor(r() * 16); y = Math.floor(r() * 16); g.pw(x, y, lt); }
    if (dead) {
      for (i = 0; i < 4; i++) {         // bare dirt spots
        x = Math.floor(r() * 16); y = Math.floor(r() * 16);
        g.pw(x, y, PAL.dirt); g.pw(x + 1, y, PAL.dirt); g.pw(x, y + 1, PAL.deadB);
      }
    } else {
      for (i = 0; i < 4; i++) { x = Math.floor(r() * 16); y = Math.floor(r() * 16); g.pw(x, y, PAL.grassB); g.pw(x + 1, y + 1, PAL.grassB); }
    }
    return g;
  }
  def('grass', 16, 16, 2, function (f) { return grassTile(f === 0 ? 3 : 29, false); });
  def('grass_dead', 16, 16, 1, function () { return grassTile(41, true); });

  def('sidewalk', 16, 16, 1, function () {
    var g = new Grid(16, 16), r = rng(5), i;
    g.fill(PAL.concrete);
    g.rect(0, 0, 16, 1, PAL.concreteLight);
    g.rect(0, 14, 16, 1, '#b4b4c0');
    g.rect(0, 15, 16, 1, PAL.concreteDark);
    for (i = 0; i < 14; i++) g.pw(r() * 16, 1 + r() * 13, r() < 0.5 ? '#b8b8c4' : '#d8d8e0');
    for (i = 0; i < 3; i++) g.pw(r() * 16, 2 + r() * 11, '#a4a4b2');
    return g;
  });

  function asphalt(seed) {
    var g = new Grid(16, 16), r = rng(seed), i;
    g.fill(PAL.asphalt);
    for (i = 0; i < 22; i++) g.pw(r() * 16, r() * 16, r() < 0.5 ? PAL.asphaltLight : PAL.asphaltDark);
    for (i = 0; i < 5; i++) { var x = r() * 16, y = r() * 16; g.pw(x, y, PAL.asphaltDark); g.pw(x + 1, y, PAL.asphaltDark); }
    return g;
  }
  def('road', 16, 16, 1, function () { return asphalt(17); });
  def('road_line', 16, 16, 1, function () {
    var g = asphalt(17);
    g.rect(7, 2, 2, 8, '#f0e070');
    g.rect(8, 2, 1, 8, '#c8b83c');
    g.rect(7, 2, 2, 1, '#fcf4a8');
    return g;
  });

  def('curb', 4, 16, 1, function () {
    var g = new Grid(4, 16);
    g.rect(0, 0, 1, 16, PAL.concreteLight);
    g.rect(1, 0, 1, 16, PAL.concrete);
    g.rect(2, 0, 1, 16, PAL.concreteDark);
    g.rect(3, 0, 1, 16, '#585870');
    g.rect(0, 15, 3, 1, '#8c8c9c'); g.p(3, 15, '#444458');
    g.p(1, 6, '#b8b8c4'); g.p(0, 10, '#d0d0d8');
    return g;
  });

  def('driveway', 16, 16, 1, function () {
    var g = new Grid(16, 16), r = rng(23), i;
    g.fill('#bcae98');
    g.rect(0, 0, 16, 1, '#d4c8b4');
    g.rect(0, 15, 16, 1, '#8c7c68');
    g.rect(7, 0, 1, 16, '#a89a84');
    for (i = 0; i < 12; i++) g.pw(r() * 16, r() * 16, r() < 0.5 ? '#ccbea8' : '#a89a84');
    for (i = 0; i < 2; i++) { var oy = 3 + i * 6; g.rect(2, oy, 2, 1, '#6c5c4c'); g.rect(11, oy + 2, 2, 1, '#6c5c4c'); }
    return g;
  });

  def('fence', 16, 8, 1, function () {
    var g = new Grid(16, 8);
    g.rect(0, 2, 16, 1, 'G'); g.rect(0, 5, 16, 1, 'G');
    g.rect(0, 3, 16, 1, 'd'); g.rect(0, 6, 16, 1, 'd');
    for (var x = 0; x < 16; x += 4) {
      g.rect(x, 1, 3, 6, 'w');
      g.rect(x + 2, 1, 1, 6, 'g');
      g.p(x + 1, 0, 'w'); g.p(x + 1, 1, 'w');
      g.rect(x, 1, 1, 1, null); g.p(x + 2, 1, 'g');
      g.rect(x, 6, 3, 1, 'g');
      g.p(x, 2, 'G'); g.p(x, 5, 'G');
      g.rect(x + 3, 7, 1, 1, 'N');
      g.rect(x, 7, 3, 1, 'N');
    }
    return g;
  });

  // ---- bitmap font -------------------------------------------------------------
  var FONT = {
    'A': '01110 10001 10001 11111 10001 10001 10001', 'B': '11110 10001 10001 11110 10001 10001 11110',
    'C': '01110 10001 10000 10000 10000 10001 01110', 'D': '11110 10001 10001 10001 10001 10001 11110',
    'E': '11111 10000 10000 11110 10000 10000 11111', 'F': '11111 10000 10000 11110 10000 10000 10000',
    'G': '01110 10001 10000 10111 10001 10001 01111', 'H': '10001 10001 10001 11111 10001 10001 10001',
    'I': '01110 00100 00100 00100 00100 00100 01110', 'J': '00111 00010 00010 00010 00010 10010 01100',
    'K': '10001 10010 10100 11000 10100 10010 10001', 'L': '10000 10000 10000 10000 10000 10000 11111',
    'M': '10001 11011 10101 10101 10001 10001 10001', 'N': '10001 11001 10101 10011 10001 10001 10001',
    'O': '01110 10001 10001 10001 10001 10001 01110', 'P': '11110 10001 10001 11110 10000 10000 10000',
    'Q': '01110 10001 10001 10001 10101 10010 01101', 'R': '11110 10001 10001 11110 10100 10010 10001',
    'S': '01111 10000 10000 01110 00001 00001 11110', 'T': '11111 00100 00100 00100 00100 00100 00100',
    'U': '10001 10001 10001 10001 10001 10001 01110', 'V': '10001 10001 10001 10001 10001 01010 00100',
    'W': '10001 10001 10001 10101 10101 11011 10001', 'X': '10001 10001 01010 00100 01010 10001 10001',
    'Y': '10001 10001 01010 00100 00100 00100 00100', 'Z': '11111 00001 00010 00100 01000 10000 11111',
    '0': '01110 10001 10011 10101 11001 10001 01110', '1': '00100 01100 00100 00100 00100 00100 01110',
    '2': '01110 10001 00001 00010 00100 01000 11111', '3': '11110 00001 00001 01110 00001 00001 11110',
    '4': '00010 00110 01010 10010 11111 00010 00010', '5': '11111 10000 11110 00001 00001 10001 01110',
    '6': '00110 01000 10000 11110 10001 10001 01110', '7': '11111 00001 00010 00100 01000 01000 01000',
    '8': '01110 10001 10001 01110 10001 10001 01110', '9': '01110 10001 10001 01111 00001 00010 01100',
    ' ': '00000 00000 00000 00000 00000 00000 00000',
    '.': '00000 00000 00000 00000 00000 01100 01100', ',': '00000 00000 00000 00000 00100 00100 01000',
    '!': '00100 00100 00100 00100 00100 00000 00100', '?': '01110 10001 00001 00010 00100 00000 00100',
    ':': '00000 01100 01100 00000 01100 01100 00000', '-': '00000 00000 00000 11111 00000 00000 00000',
    '+': '00000 00100 00100 11111 00100 00100 00000', '/': '00001 00001 00010 00100 01000 10000 10000',
    "'": '00100 00100 01000 00000 00000 00000 00000', '%': '11001 11001 00010 00100 01000 10011 10011',
    '@': '01010 11111 11111 11111 01110 00100 00000',
    '(': '00010 00100 01000 01000 01000 00100 00010', ')': '01000 00100 00010 00010 00010 00100 01000',
    '=': '00000 00000 11111 00000 11111 00000 00000', '*': '00000 10101 01110 11111 01110 10101 00000',
    '"': '01010 01010 00000 00000 00000 00000 00000', '_': '00000 00000 00000 00000 00000 00000 11111',
    '<': '00010 00100 01000 10000 01000 00100 00010', '>': '01000 00100 00010 00001 00010 00100 01000',
    '#': '01010 11111 01010 01010 01010 11111 01010', '$': '00100 01111 10100 01110 00101 11110 00100'
  };
  var glyphRows = {};
  Object.keys(FONT).forEach(function (k) { glyphRows[k] = FONT[k].split(' '); });
  function glyphOf(ch) {
    if (ch === '❤') ch = '@';
    var u = ch.toUpperCase();
    return glyphRows[u] || null;
  }

  // ---- logo ------------------------------------------------------------------------
  def('logo', 160, 40, 1, function () {
    var W = 160, H = 40, g = new Grid(W, H), mask = new Grid(W, H);
    var word = 'PAPERBOY', S = 3, gap = 3, lw = 5 * S + 1, x0 = Math.floor((W - (word.length * lw + (word.length - 1) * gap)) / 2) - 1, y0 = 3;
    word.split('').forEach(function (ch, i) {
      var rows = glyphRows[ch], ox = x0 + i * (lw + gap);
      for (var j = 0; j < 7; j++) for (var k = 0; k < 5; k++) {
        if (rows[j].charAt(k) === '1') mask.rect(ox + k * S, y0 + j * S, S + 1, S, 'w');
      }
    });
    function on(m, x, y) { return !!m.g(x, y); }
    var x, y, dx, dy;
    // drop shadow
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
        if (on(mask, x - 2 + dx, y - 2 + dy)) g.p(x, y, PAL.maroon);
      }
    }
    // outline
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
        if (on(mask, x + dx, y + dy)) g.p(x, y, 'k');
      }
    }
    // letters with vertical bevel gradient
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (!on(mask, x, y)) continue;
      var t = y - y0, c = t < 7 ? '#fcf4b0' : (t < 14 ? 'y' : 'o');
      if (!on(mask, x, y - 1)) c = 'w';
      else if (!on(mask, x - 1, y) && t > 1) c = t < 7 ? '#fcf4b0' : (t < 14 ? '#fceb78' : '#fcb860');
      if (!on(mask, x, y + 1)) c = 'O';
      else if (!on(mask, x + 1, y)) c = t < 10 ? 'Y' : 'O';
      g.p(x, y, c);
    }
    // newsprint ribbon
    var ry = 31;
    g.rect(8, ry + 2, 8, 8, 'R'); g.rect(144, ry + 2, 8, 8, 'R');
    g.p(8, ry + 5, null); g.p(9, ry + 4, null); g.p(9, ry + 6, null); g.p(8, ry + 4, null); g.p(8, ry + 6, null);
    g.p(151, ry + 5, null); g.p(150, ry + 4, null); g.p(150, ry + 6, null); g.p(151, ry + 4, null); g.p(151, ry + 6, null);
    g.rect(14, ry, 132, 9, 'r');
    g.rect(14, ry, 132, 1, 'o'); g.rect(14, ry + 8, 132, 1, 'R');
    var msg = 'DELIVER THE NEWS', mx = Math.floor((W - (msg.length * 6 - 1)) / 2);
    msg.split('').forEach(function (ch, i) {
      var rows = glyphRows[ch];
      if (!rows) return;
      for (var j = 0; j < 7; j++) for (var k = 0; k < 5; k++) {
        if (rows[j].charAt(k) === '1') { g.p(mx + i * 6 + k, ry + 1 + j + 1, 'k'); g.p(mx + i * 6 + k, ry + 1 + j, 'w'); }
      }
    });
    // keep outline of ribbon (not the shadow) readable
    var snap = g.d.slice();
    for (y = ry - 1; y <= ry + 10; y++) for (x = 6; x < 154; x++) {
      if (snap[y * W + x]) continue;
      if (y >= ry - 1 && (snap[(y + 1) * W + x] === PAL.red || snap[(y + 1) * W + x] === PAL.orange) ||
          snap[y * W + x - 1] === PAL.darkred || snap[y * W + x + 1] === PAL.darkred || snap[(y - 1) * W + x] === PAL.darkred) g.p(x, y, 'k');
    }
    return g;
  });

  // ------------------------------------------------------------------ runtime
  var store = {};     // name -> [canvas]
  var flipped = {};   // 'name#frame' -> canvas
  var inited = false;

  function gridToCanvas(g) {
    var c = document.createElement('canvas');
    c.width = g.w; c.height = g.h;
    var cx = c.getContext('2d');
    var img = cx.createImageData(g.w, g.h), data = img.data;
    for (var i = 0; i < g.d.length; i++) {
      var v = g.d[i];
      if (!v) continue;
      var n = parseInt(v.slice(1), 16);
      data[i * 4] = (n >> 16) & 255; data[i * 4 + 1] = (n >> 8) & 255; data[i * 4 + 2] = n & 255; data[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    return c;
  }

  function init() {
    if (inited) return;
    inited = true;
    order.forEach(function (name) {
      var d = defs[name], list = [];
      for (var f = 0; f < d.frames; f++) {
        var g = d.fn(f);
        if (g.w !== d.w || g.h !== d.h) warnings.push(name + ' size mismatch');
        list.push(gridToCanvas(g));
      }
      store[name] = list;
    });
  }

  var placeholder = null;
  function get(name, frame) {
    if (!inited) init();
    var list = store[name];
    if (!list) {
      if (!placeholder) {
        var g = new Grid(8, 8);
        g.fill('#ff00ff'); g.rect(1, 1, 6, 6, 'k');
        placeholder = gridToCanvas(g);
      }
      return placeholder;
    }
    var n = list.length, f = ((frame | 0) % n + n) % n;
    return list[f];
  }
  function frames(name) { return defs[name] ? defs[name].frames : 1; }
  function size(name) { var d = defs[name]; return d ? { w: d.w, h: d.h } : { w: 8, h: 8 }; }

  function draw(ctx, name, x, y, frame, flipX) {
    var c = get(name, frame || 0);
    x = Math.round(x); y = Math.round(y);
    if (flipX) {
      var key = name + '#' + ((frame | 0) % frames(name));
      var fc = flipped[key];
      if (!fc) {
        fc = document.createElement('canvas'); fc.width = c.width; fc.height = c.height;
        var fx = fc.getContext('2d');
        fx.translate(c.width, 0); fx.scale(-1, 1); fx.drawImage(c, 0, 0);
        flipped[key] = fc;
      }
      ctx.drawImage(fc, x, y);
    } else {
      ctx.drawImage(c, x, y);
    }
  }

  // text ---------------------------------------------------------------------
  var glyphCache = {};
  function glyphCanvas(ch, color) {
    var key = color + '|' + ch;
    var c = glyphCache[key];
    if (c) return c;
    var rows = glyphOf(ch);
    if (!rows) return null;
    c = document.createElement('canvas'); c.width = 5; c.height = 7;
    var cx = c.getContext('2d');
    cx.fillStyle = color;
    for (var j = 0; j < 7; j++) for (var i = 0; i < 5; i++) if (rows[j].charAt(i) === '1') cx.fillRect(i, j, 1, 1);
    glyphCache[key] = c;
    return c;
  }
  function textWidth(text, scale) { return String(text).length * 6 * (scale || 1); }
  function drawText(ctx, text, x, y, color, scale, align) {
    text = String(text); color = color || '#fff'; scale = scale || 1;
    var w = textWidth(text, scale) - scale;          // visible width (without trailing gap)
    x = Math.round(x); y = Math.round(y);
    if (align === 'center') x -= Math.floor(w / 2);
    else if (align === 'right') x -= w;
    var smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    for (var i = 0; i < text.length; i++) {
      var gc = glyphCanvas(text.charAt(i), color);
      if (gc) ctx.drawImage(gc, x + i * 6 * scale, y, 5 * scale, 7 * scale);
    }
    ctx.imageSmoothingEnabled = smooth;
  }

  // per-sprite hit boxes (relative to sprite top-left) as a convenience
  var meta = {
    house: HOUSE,
    hit: {
      paperboy: { x: 4, y: 2, w: 8, h: 21 },
      car: { x: 1, y: 1, w: 18, h: 30 },
      dog: { x: 1, y: 2, w: 14, h: 9 },
      skater: { x: 3, y: 2, w: 6, h: 17 },
      worker: { x: 1, y: 2, w: 10, h: 17 },
      hydrant: { x: 1, y: 1, w: 6, h: 8 },
      trashcan: { x: 1, y: 1, w: 8, h: 10 },
      tree: { x: 9, y: 18, w: 6, h: 11 },
      bush: { x: 2, y: 2, w: 12, h: 9 },
      mailbox: { x: 0, y: 0, w: 8, h: 12 },
      fence: { x: 0, y: 0, w: 16, h: 8 }
    }
  };

  global.Sprites = {
    init: init, get: get, frames: frames, draw: draw, size: size,
    drawText: drawText, textWidth: textWidth,
    PALETTE: PAL, meta: meta,
    names: function () { return order.slice(); },
    _warnings: warnings
  };
})(typeof window !== 'undefined' ? window : this);
