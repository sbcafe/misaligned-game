/* MISALIGNED - canvas renderer. Reads game state (Rules) and fx lists; never mutates the rules state. */
(function (root) {
  'use strict';
  const R = root.Rules;
  const TAU = Math.PI * 2;
  const FONT_D = '"MIS Display Black", "Orbitron", "Arial Black", sans-serif';
  const FONT_DB = '"MIS Display Bold", "Orbitron", "Arial Black", sans-serif';
  const FONT_M = '"MIS Mono", ui-monospace, Menlo, Consolas, monospace';
  const MONO_B = '700 ';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

  function create(canvas) {
    const c = canvas.getContext('2d', { alpha: false });
    const V = { W: 390, H: 844, dpr: 1, ins: { t: 0, r: 0, b: 0, l: 0 }, k: 1 };
    const L = {};
    let scan = null, vig = null, sunImg = null, stars = [];
    const probe = document.getElementById('insetProbe');

    function readInsets() {
      if (!probe) return;
      const cs = getComputedStyle(probe);
      V.ins = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    }

    function resize() {
      readInsets();
      V.W = Math.max(280, window.innerWidth); V.H = Math.max(280, window.innerHeight);
      V.dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(V.W * V.dpr); canvas.height = Math.round(V.H * V.dpr);
      canvas.style.width = V.W + 'px'; canvas.style.height = V.H + 'px';
      V.k = clamp(Math.min(V.W / 390, V.H / 700), 0.62, 1.25);
      const pad = Math.max(14, V.ins.l + 10, V.ins.r + 10);
      L.pad = pad;
      L.top = V.ins.t + 8;
      L.hudH = Math.round(118 * clamp(V.k, 0.8, 1.1));
      const kk = clamp(V.k, 0.8, 1.1);
      L.sliderH = Math.round(94 + 48 * kk);
      L.sliderTop = V.H - V.ins.b - L.sliderH;
      L.trackY = V.H - V.ins.b - 36;
      L.trackH = 56;
      L.trackX0 = pad + 8; L.trackX1 = V.W - pad - 8;
      const areaTop = L.top + L.hudH, areaBot = L.sliderTop;
      L.horizonY = Math.round(areaTop + (areaBot - areaTop) * 0.52);
      L.sunR = Math.round(Math.min(V.W * 0.36, (L.horizonY - areaTop) * 0.86, 150));
      L.gaugeY = L.sliderTop + 10;
      // thumb arrows (DOM buttons, positioned by main.js from these numbers) and the floating ESC button
      L.arrowSize = V.H >= 700 ? 60 : 56; L.arrowGap = 8;
      L.arrowBottom = L.sliderTop - 10; L.arrowTop = L.arrowBottom - (2 * L.arrowSize + L.arrowGap);
      L.escBottom = L.sliderTop - 14;
      L.orbY = L.sliderTop - Math.round(34 * clamp(V.k, 0.8, 1.1));                                  // catch line of the energy orbs
      L.orbPPD = Math.max(5, Math.min(14, (V.W / 2 - L.arrowSize - 22) / 12));                        // screen px per degree of tilt (catcher + lanes)
      buildPatterns();
    }

    function buildPatterns() {
      // scanlines (device pixel pattern) and vignette
      const sc = document.createElement('canvas'); sc.width = 1; sc.height = Math.max(3, Math.round(3 * V.dpr));
      const sx = sc.getContext('2d'); sx.fillStyle = 'rgba(0,0,0,0.0)'; sx.clearRect(0, 0, 1, sc.height);
      sx.fillStyle = 'rgba(0,0,0,0.20)'; sx.fillRect(0, sc.height - Math.max(1, Math.round(V.dpr)), 1, Math.max(1, Math.round(V.dpr)));
      scan = c.createPattern(sc, 'repeat');
      vig = document.createElement('canvas'); vig.width = Math.round(V.W * V.dpr / 2); vig.height = Math.round(V.H * V.dpr / 2);
      const vx = vig.getContext('2d');
      const g = vx.createRadialGradient(vig.width / 2, vig.height / 2, Math.min(vig.width, vig.height) * 0.35, vig.width / 2, vig.height / 2, Math.hypot(vig.width, vig.height) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
      vx.fillStyle = g; vx.fillRect(0, 0, vig.width, vig.height);
      // sun sprite (upper half only), with the retro cut bands
      const r = L.sunR, S = 2;
      sunImg = document.createElement('canvas'); sunImg.width = r * 2 * S; sunImg.height = r * S;
      const sc2 = sunImg.getContext('2d'); sc2.scale(S, S);
      const sg = sc2.createLinearGradient(0, 0, 0, r);
      sg.addColorStop(0, '#ffec7a'); sg.addColorStop(0.45, '#ff9a46'); sg.addColorStop(0.8, '#ff3d96'); sg.addColorStop(1, '#c81fbf');
      sc2.fillStyle = sg; sc2.beginPath(); sc2.arc(r, r, r, Math.PI, 0); sc2.lineTo(r, r); sc2.fill();
      sc2.globalCompositeOperation = 'destination-out';
      let y = r * 0.50, th = Math.max(2, r * 0.03);
      while (y < r) { sc2.fillRect(0, y, r * 2, th); y += th + Math.max(6, r * 0.13) * (1 - 0.55 * (y / r) ** 2); th += r * 0.012; }
      const rs = Math.PI * 2; stars = [];
      const rng = R.mulberry32(1984);
      for (let i = 0; i < 90; i++) stars.push({ x: (rng() - 0.5) * 2.4, y: -rng() * 1.6, b: 0.3 + rng() * 0.7, f: 0.3 + rng() * 1.2, ph: rng() * TAU, m: rng() < 0.25 });
    }

    // ------------------------------------------------------------ chrome lettering
    function letterGrad(cy, size) {
      const h = size * 0.72, y0 = cy - h / 2;
      const g = c.createLinearGradient(0, y0, 0, y0 + h);
      g.addColorStop(0.00, '#ffffff'); g.addColorStop(0.30, '#96f5ff'); g.addColorStop(0.47, '#288cff');
      g.addColorStop(0.495, '#16145f'); g.addColorStop(0.52, '#ff8ceb'); g.addColorStop(0.75, '#ff3cb9'); g.addColorStop(1.0, '#ff963c');
      return g;
    }
    /** one chrome letter, 80s style: dark extrusion, chrome fill, pale outline, optional RGB-split glitch */
    function chromeLetter(ch, x, y, size, o) {
      o = o || {};
      c.save();
      c.translate(x, y); if (o.rot) c.rotate(o.rot * Math.PI / 180);
      c.transform(1, 0, -0.24, 1, 0, 0);
      c.font = '900 ' + size + 'px ' + FONT_D; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.globalAlpha = o.alpha == null ? 1 : o.alpha;
      const ex = Math.max(2, Math.round(size * 0.09));
      for (let i = ex; i >= 1; i--) { c.fillStyle = 'rgb(' + Math.round(110 - 80 * i / ex) + ',' + Math.round(35 - 28 * i / ex) + ',' + Math.round(170 - 110 * i / ex) + ')'; c.fillText(ch, i * 0.5, i * 0.9); }
      if (o.glow) { c.shadowColor = o.glowColor || '#ff3fd6'; c.shadowBlur = o.glow; }
      if (o.split) {
        c.globalCompositeOperation = 'lighter'; c.shadowBlur = 0;
        c.fillStyle = 'rgba(255,40,70,0.75)'; c.fillText(ch, o.split, 0);
        c.fillStyle = 'rgba(40,220,255,0.75)'; c.fillText(ch, -o.split, 0);
        c.globalCompositeOperation = 'source-over';
      }
      c.fillStyle = letterGrad(0, size); c.fillText(ch, 0, 0);
      c.shadowBlur = 0;
      c.lineWidth = Math.max(1, size * 0.018); c.strokeStyle = 'rgba(220,252,255,0.9)'; c.strokeText(ch, 0, 0);
      c.restore();
    }
    function wordWidth(str, size) {
      c.save(); c.font = '900 ' + size + 'px ' + FONT_D; let w = 0; for (const ch of str) w += c.measureText(ch).width; c.restore(); return w;
    }
    /** a word whose first three letters (MIS) sit off-angle with a glitchy RGB split */
    function titleWord(str, cx, cy, size, now, o) {
      o = o || {};
      const track = size * 0.06; let w = 0; const adv = [];
      c.save(); c.font = '900 ' + size + 'px ' + FONT_D;
      for (const ch of str) { const a = c.measureText(ch).width; adv.push(a); w += a + track; } c.restore();
      w -= track; let x = cx - w / 2;
      const beat = (now % R.BEAT) / R.BEAT, pulse = Math.exp(-beat * 6);
      const jit = o.reduce ? 0 : (Math.sin(now * 37) * 0.5 + 0.5) * pulse;
      for (let i = 0; i < str.length; i++) {
        const mis = i < 3; const gx = x + adv[i] / 2;
        chromeLetter(str[i], gx, cy + (mis ? -size * 0.07 - jit * 3 : 0), size, {
          rot: mis ? -5 + (o.reduce ? 0 : jit * 1.5) : 0, glow: size * 0.35, glowColor: mis ? '#ff3fd6' : '#4de9ff',
          split: mis ? (o.reduce ? 1 : 1.5 + jit * size * 0.06) : 0
        });
        x += adv[i] + track;
      }
    }

    // ------------------------------------------------------------ world (sky, sun, grid)
    function scene(a) {
      // a: {angle, flip(1..-1), pulse, phase, t, dim, frozen}
      const W = V.W, H = V.H, hy = L.horizonY, Rr = Math.hypot(W, H) * 1.3;
      c.save();
      c.translate(W / 2, hy); c.rotate(a.angle * Math.PI / 180); c.scale(1, a.flip);
      // sky
      const sky = c.createLinearGradient(0, -Rr, 0, 0);
      sky.addColorStop(0, '#05010f'); sky.addColorStop(0.55, '#14052d'); sky.addColorStop(1, '#43106b');
      c.fillStyle = sky; c.fillRect(-Rr, -Rr, 2 * Rr, Rr);
      // stars
      for (const s of stars) {
        const x = s.x * W * 0.9, y = s.y * Rr * 0.5;
        const tw = 0.55 + 0.45 * Math.sin(TAU * (s.f * a.t * 0.12) + s.ph);
        c.fillStyle = s.m ? 'rgba(255,120,230,' + (s.b * tw) + ')' : 'rgba(190,240,255,' + (s.b * tw) + ')';
        c.fillRect(x, y, 1.6, 1.6);
      }
      // halo + sun
      const r = L.sunR, p = a.pulse;
      c.globalCompositeOperation = 'lighter';
      const hg = c.createRadialGradient(0, 0, r * 0.6, 0, 0, r * (1.9 + 0.4 * p));
      hg.addColorStop(0, 'rgba(255,90,170,' + (0.35 + 0.35 * p) + ')'); hg.addColorStop(1, 'rgba(255,90,170,0)');
      c.fillStyle = hg; c.fillRect(-r * 2.4, -r * 2.4, r * 4.8, r * 2.4);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 0.82 + 0.18 * p;
      c.drawImage(sunImg, -r * (1 + 0.04 * p), -r * (1 + 0.04 * p), r * 2 * (1 + 0.04 * p), r * (1 + 0.04 * p));
      c.globalAlpha = 1;
      // floor
      const fl = c.createLinearGradient(0, 0, 0, Rr * 0.6);
      fl.addColorStop(0, '#2a0a4d'); fl.addColorStop(0.15, '#150530'); fl.addColorStop(1, '#0a0220');
      c.fillStyle = fl; c.fillRect(-Rr, 0, 2 * Rr, Rr);
      // perspective grid: vertical rays, rows lurch forward on every beat
      const D = Math.max(160, (V.H - hy) * 0.9), inten = 0.55 + 0.9 * p;
      c.lineCap = 'round';
      const col = (al) => (a.frozen ? 'rgba(120,230,255,' : 'rgba(255,60,215,') + al + ')';
      for (let pass = 0; pass < 2; pass++) {
        c.lineWidth = pass ? 1.4 : 4.5; const al = pass ? 0.95 * Math.min(1, inten) : 0.16 * inten;
        c.beginPath();
        const sp = V.W / 7.5;
        for (let k = -28; k <= 28; k++) { c.moveTo(0, 0); c.lineTo(k * sp * (Rr / D), Rr); }
        const ph = ((a.phase % 1) + 1) % 1;
        for (let j = 0; j < 22; j++) {
          const z = 1 + 0.5 * (j - ph); if (z < 0.34 || z > 15) continue;
          const y = D / z; if (y > Rr) continue;
          c.moveTo(-Rr, y); c.lineTo(Rr, y);
        }
        c.strokeStyle = col(al); c.stroke();
      }
      // haze under the horizon fills the far distance where rows get too dense to draw
      const hz = c.createLinearGradient(0, 0, 0, 70);
      hz.addColorStop(0, a.frozen ? 'rgba(120,230,255,0.35)' : 'rgba(255,63,214,0.38)'); hz.addColorStop(1, 'rgba(255,63,214,0)');
      c.fillStyle = hz; c.fillRect(-Rr, 0, 2 * Rr, 70);
      // horizon line
      c.fillStyle = a.frozen ? 'rgba(160,250,255,0.95)' : 'rgba(150,235,255,' + (0.6 + 0.4 * p) + ')';
      c.fillRect(-Rr, -1, 2 * Rr, 2.2);
      c.restore();
    }

    function post(now, shake) {
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = scan; c.fillRect(0, 0, canvas.width, canvas.height);
      c.drawImage(vig, 0, 0, canvas.width, canvas.height);
      c.restore();
    }

    function begin(shakeAmp, now) {
      c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      c.fillStyle = '#07010f'; c.fillRect(0, 0, V.W, V.H);
      if (shakeAmp > 0.01) { c.save(); c.translate((Math.sin(now * 91) * shakeAmp), (Math.cos(now * 77) * shakeAmp)); return true; }
      return false;
    }

    // ------------------------------------------------------------ menu backdrop
    function backdrop(now, o) {
      o = o || {};
      const shook = begin(0, now);
      const beat = (now % R.BEAT) / R.BEAT, pulse = Math.exp(-beat * 5) * (o.reduce ? 0.4 : 1);
      scene({ angle: (o.reduce ? 0 : 3.2 * Math.sin(now * 0.45)) + (o.angle || 0), flip: 1, pulse, phase: now / R.BEAT, t: now, dim: 0 });
      if (o.title !== false) {
        const w100 = wordWidth('MISALIGNED', 100) + 100 * 0.06 * 9;
        const size = Math.round(Math.min(110, (V.W - 2 * L.pad - 20) / w100 * 100, V.H * 0.2));
        titleWord('MISALIGNED', V.W / 2, o.titleY != null ? o.titleY : V.H * 0.27, size, now, { reduce: o.reduce });
      }
      post(now, 0);
    }

    // ------------------------------------------------------------ gameplay
    function textShadowed(txt, x, y, font, color, align, shadow) {
      c.font = font; c.textAlign = align || 'left'; c.textBaseline = 'alphabetic';
      c.fillStyle = 'rgba(5,0,20,0.85)'; c.fillText(txt, x + 1.5, y + 1.5);
      c.fillStyle = color; if (shadow) { c.shadowColor = shadow; c.shadowBlur = 8; } c.fillText(txt, x, y); c.shadowBlur = 0;
    }
    function wrap(txt, maxW, font) {
      c.font = font; const words = txt.split(' '), lines = []; let line = '';
      for (const w of words) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
      if (line) lines.push(line); return lines;
    }
    function panel(x, y, w, h, a, border) {
      c.fillStyle = 'rgba(8,3,28,' + a + ')'; c.strokeStyle = border || 'rgba(106,246,255,0.45)'; c.lineWidth = 1.5;
      c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, 8) : c.rect(x, y, w, h); c.fill(); c.stroke();
    }

    function markLayout(g) {
      const n = g.L.word.length, W = V.W;
      const spacing = Math.min((W - 2 * L.pad) / n, n <= 5 ? 96 : 64);
      const size = Math.round(Math.min(spacing * (n <= 5 ? 0.9 : 0.95), 86) * (V.H < 480 ? 0.62 : 1));
      const y = L.horizonY - L.sunR * 0.42;
      const x0 = W / 2 - spacing * (n - 1) / 2;
      return { n, spacing, size, y, x0, cell: spacing * 0.26 };
    }

    /** TAP THE LETTER: centre of letter i in canvas CSS px, rotated with the grid exactly like play() draws it. */
    function markScreen(g, t, i) {
      const M = markLayout(g), a = R.tilt(g, t) * Math.PI / 180, cx = V.W / 2, cy = L.horizonY;
      const x = M.x0 + i * M.spacing + g.off[i] * M.cell - cx, y = M.y - cy;
      return { x: cx + x * Math.cos(a) - y * Math.sin(a), y: cy + x * Math.sin(a) + y * Math.cos(a) };
    }
    /** Normalized distance of a touch (canvas CSS px) to every letter: 0 = centre, 1 = edge of its touch target.
     *  Touch targets are generous: at least 60 px wide and 88 px tall, wider than the letter where there is room. */
    function markHits(g, t, px, py) {
      const M = markLayout(g), a = -R.tilt(g, t) * Math.PI / 180, cx = V.W / 2, cy = L.horizonY;
      const dx0 = px - cx, dy0 = py - cy;                                  // undo the grid rotation around the horizon centre
      const lx = cx + dx0 * Math.cos(a) - dy0 * Math.sin(a), ly = cy + dx0 * Math.sin(a) + dy0 * Math.cos(a);
      const rx = Math.max(M.spacing * 0.6, 30), ry = Math.max(M.size * 0.95, 44), out = [];
      for (let i = 0; i < M.n; i++) {
        const x = M.x0 + i * M.spacing + g.off[i] * M.cell;
        out.push(Math.hypot((lx - x) / rx, (ly - M.y) / ry));
      }
      return out;
    }

    // A tangent to a small hill, floating in canvas fractions. Flat (gradient 0) is drawn lime.
    function tangentLayer(g, t, now, opt) {
      const v = R.tangentView(g, t);
      const W = V.W, H = V.H, k = clamp(V.k, 0.8, 1.1);
      const cx = v.x * W, cy = v.y * H, rad = v.ang * Math.PI / 180, len = v.half * W;
      c.save();
      c.translate(cx, cy); c.rotate(-rad);
      c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.38)';
      c.beginPath();
      const span = len * 0.92, steps = 28, curv = 0.009;
      for (let i = 0; i <= steps; i++) {
        const lx = -span + (2 * span * i) / steps, ly = -0.5 * curv * lx * lx;
        if (i === 0) c.moveTo(lx, ly); else c.lineTo(lx, ly);
      }
      c.stroke();
      c.strokeStyle = v.flat ? '#d6ff74' : 'rgba(154,252,255,0.92)';
      c.lineWidth = v.flat ? 4 : 2.25;
      if (!opt.reduce) { c.shadowColor = v.flat ? '#d6ff74' : '#6af6ff'; c.shadowBlur = v.flat ? 16 : 8; }
      c.beginPath(); c.moveTo(-len, 0); c.lineTo(len, 0); c.stroke(); c.shadowBlur = 0;
      if (v.flat) {
        const pulse = opt.reduce ? 1 : 0.65 + 0.35 * Math.sin(now * 8);
        c.fillStyle = '#d6ff74'; c.globalAlpha = pulse;
        c.beginPath(); c.arc(0, 0, 7 * k, 0, TAU); c.fill(); c.globalAlpha = 1;
        c.strokeStyle = 'rgba(214,255,116,0.9)'; c.lineWidth = 2;
        c.beginPath(); c.arc(0, 0, (14 + (opt.reduce ? 0 : 4 * pulse)) * k, 0, TAU); c.stroke();
      }
      c.restore();
      const mtxt = v.flat ? 'FLAT · GRADIENT 0' : ('m = ' + (v.m >= 0 ? '+' : '') + v.m.toFixed(2));
      const ly = clamp(cy - 22 * k, L.top + L.hudH + 18, L.sliderTop - 28);
      textShadowed(mtxt, cx, ly, '900 ' + Math.round(13 * k + 2) + 'px ' + FONT_D, v.flat ? '#d6ff74' : '#9afcff', 'center', v.flat ? '#d6ff74' : '#6af6ff');
      textShadowed('TANGENT', cx, ly + 14 * k, MONO_B + Math.round(10 * k + 1) + 'px ' + FONT_M, '#f4e9ff', 'center');
    }

    function play(g, t, now, fx, opt) {
      const frozen = R.isFrozen(g, t), deg = R.tilt(g, t);
      const sh = opt.reduce ? 0 : Math.max(0, fx.shake - now) > 0 ? Math.min(7, (fx.shake - now) * 28) : 0;
      const shook = begin(sh, now);
      const songBeat = ((t % R.BEAT) + R.BEAT) % R.BEAT / R.BEAT;
      // MUSIC OFF: the kick is no longer a cue, so the grid/sun pulse on the beat is stronger and the rings are bolder
      const pulse = opt.musicOff ? Math.min(1, Math.exp(-songBeat * 5) * 1.5 + 0.06) : Math.exp(-songBeat * 5);
      // inversion animates 1 -> -1 over 0.5 s
      let fl = g.invertOn ? -1 : 1;
      if (fx.invertAnim) { const k = clamp((now - fx.invertAnim.t0) / 0.55, 0, 1); fl = g.invertOn ? lerp(1, -1, ease(k)) : lerp(-1, 1, ease(k)); if (opt.reduce) fl = g.invertOn ? -1 : 1; }
      const fscale = Math.abs(fl) < 0.12 ? 0.12 * Math.sign(fl || 1) : fl;
      scene({ angle: deg, flip: fscale, pulse, phase: t / R.BEAT, t: now, frozen });
      // ---- marks (letters of the word), rotating with the grid
      const M = markLayout(g);
      c.save(); c.translate(V.W / 2, L.horizonY); c.rotate(deg * Math.PI / 180); c.translate(-V.W / 2, -L.horizonY);
      const appr = R.approaching(g, t);
      for (let i = 0; i < M.n; i++) {
        const hx = M.x0 + i * M.spacing, off = g.off[i] * M.cell, x = hx + off;
        // home slot: bracket under the letter
        c.strokeStyle = 'rgba(106,246,255,0.8)'; c.lineWidth = 2.5; c.beginPath();
        const bw = M.spacing * 0.38, by = M.y + M.size * 0.55;
        c.moveTo(hx - bw, by - 5); c.lineTo(hx - bw, by); c.lineTo(hx + bw, by); c.lineTo(hx + bw, by - 5); c.stroke();
        const err = Math.min(1, Math.abs(g.off[i]) / 1.6);
        const isMis = g.L.word.length > 3 ? i < 3 : (g.L.id === 1);
        chromeLetter(g.L.word[i], x, M.y, M.size, {
          rot: (isMis ? -4 : 0) * err, glow: M.size * 0.3, glowColor: err > 0.45 ? '#ff3fd6' : '#4de9ff',
          split: opt.reduce ? 0 : err * 5 + (isMis ? 1 : 0) + (fx.glitchUntil > now && isMis ? 5 : 0), alpha: 1
        });
      }
      // approach rings
      for (const a of appr) {
        const x = M.x0 + a.mark * M.spacing + g.off[a.mark] * M.cell;
        const rr = lerp(M.size * 1.7, M.size * 0.62, ease(a.k));
        if (opt.musicOff && a.k > 0.6) { c.fillStyle = 'rgba(154,252,255,' + 0.22 * (a.k - 0.6) / 0.4 + ')'; c.beginPath(); c.arc(x, M.y, M.size * 0.62, 0, TAU); c.fill(); }
        c.lineWidth = (opt.musicOff ? 5 : 3) + 2 * a.k; c.strokeStyle = 'rgba(' + Math.round(lerp(106, 255, a.k)) + ',' + Math.round(lerp(246, 255, a.k)) + ',255,' + (0.35 + 0.65 * a.k) + ')';
        c.shadowColor = '#6af6ff'; c.shadowBlur = opt.musicOff ? 18 : 10;
        c.beginPath(); c.arc(x, M.y, rr, 0, TAU); c.stroke(); c.shadowBlur = 0;
        c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, M.y, M.size * 0.62, 0, TAU); c.stroke();
      }
      // popups (PERFECT / GOOD / MISS) ride on the marks
      for (const p of fx.popups) {
        const age = now - p.t0; if (age > 0.9) continue;
        const x = clamp(M.x0 + p.mark * M.spacing + g.off[p.mark] * M.cell * (p.judge === 'PERFECT' ? 0 : 1), 52, V.W - 52);
        c.globalAlpha = 1 - ease(Math.max(0, age - 0.4) / 0.5);
        textShadowed(p.judge, x, M.y - M.size * 0.8 - age * 46, '900 ' + Math.round(20 * V.k + 6) + 'px ' + FONT_D, p.color, 'center', p.color);
        c.globalAlpha = 1;
      }
      c.restore();
      if (fx.zeroFlash > now) { c.fillStyle = 'rgba(255,255,255,' + 0.25 * ((fx.zeroFlash - now) / 0.4) + ')'; c.fillRect(0, 0, V.W, V.H); }
      if (fx.missFlash > now && !opt.reduce) { c.fillStyle = 'rgba(255,40,100,' + 0.16 * ((fx.missFlash - now) / 0.25) + ')'; c.fillRect(0, 0, V.W, V.H); }
      if (fx.tapFlash > now && !opt.reduce) { c.fillStyle = 'rgba(160,240,255,' + 0.07 * ((fx.tapFlash - now) / 0.1) + ')'; c.fillRect(0, 0, V.W, V.H); }
      if (frozen) { c.fillStyle = 'rgba(80,200,255,0.12)'; c.fillRect(0, 0, V.W, V.H); }
      tangentLayer(g, t, now, opt);
      if (opt.musicOff) {                                                 // beat dots: 4 dots, the current beat of the bar lit
        const bt = Math.floor(((t / R.BEAT) % 4 + 4) % 4), k_ = clamp(V.k, 0.8, 1.1), dy = L.top + L.hudH + 4;
        for (let i = 0; i < 4; i++) { c.fillStyle = i === bt ? (bt === 0 ? '#ffffff' : '#9afcff') : 'rgba(154,252,255,0.25)'; c.beginPath(); c.arc(V.W / 2 + (i - 1.5) * 18 * k_, dy, (i === bt ? 5 : 3) * k_, 0, TAU); c.fill(); }
        if (!opt.reduce) { c.fillStyle = 'rgba(160,240,255,' + 0.05 * pulse + ')'; c.fillRect(0, 0, V.W, V.H); }
      }
      if (frozen || fx.lasers.length || fx.zaps.length) laserLayer(g, t, now, fx, opt, frozen);
      if (fx.laserFlash > now) { c.fillStyle = 'rgba(214,255,116,' + (opt.reduce ? 0.08 : 0.16 * ((fx.laserFlash - now) / 0.12)) + ')'; c.fillRect(0, 0, V.W, V.H); }
      hud(g, t, now, fx, opt, M);
      if (opt.orbs && g.orbsOn) orbLayer(g, t, now, fx, opt, frozen);
      letterBeams(g, now, fx, opt);
      if (shook) c.restore();
      post(now, 0);
      // banners & frozen text are drawn after post so scanlines do not fade them
      overlays(g, t, now, fx, opt);
    }

    function hud(g, t, now, fx, opt, M) {
      const W = V.W, pad = L.pad, k = clamp(V.k, 0.8, 1.1), y0 = L.top;
      const d = R.display(g, t);
      textShadowed('AI // ALIGNMENT CHECK', pad, y0 + 14 * k, MONO_B + Math.round(11 * k + 1) + 'px ' + FONT_M, '#6af6ff');
      const pctTxt = d.pct.toFixed(1) + '%';
      textShadowed(pctTxt, pad, y0 + 52 * k, '900 ' + Math.round(32 * k) + 'px ' + FONT_D, d.frozen ? '#9afcff' : (d.blip ? '#ffffff' : '#ff7ce9'), 'left', '#ff3fd6');
      c.font = '900 ' + Math.round(32 * k) + 'px ' + FONT_D; const pw = c.measureText(pctTxt).width;
      textShadowed(d.label, pad + pw + 10, y0 + 52 * k, MONO_B + Math.round(12 * k + 1) + 'px ' + FONT_M, d.label === 'ALIGNED' ? '#9afcff' : '#e7b6ff');
      // TIME REMAINING (standard mode level clock, wall-clock seconds; flashes lime and says +10s when an energy orb extends it; no flashing in reduced motion)
      if (!g.noLimit) {
        const tl = R.timeLeft(g, t), mm = Math.floor(tl / 60), ss = Math.floor(tl % 60), fl = fx.timeFlash > now, low = tl < 10 && !fl;
        const col = fl ? (opt.reduce || Math.floor(now * 12) % 2 === 0 ? '#d6ff74' : '#ffffff') : (low ? '#ff7ce9' : '#f4e9ff');
        const f = '900 ' + Math.round(15 * k) + 'px ' + FONT_D, tx = W - pad;
        textShadowed(mm + ':' + String(ss).padStart(2, '0'), tx, y0 + 74 * k, f, col, 'right', fl ? '#d6ff74' : null);
        c.font = f; const tw = c.measureText(mm + ':' + String(ss).padStart(2, '0')).width;
        textShadowed('TIME', tx - tw - 6, y0 + 74 * k, MONO_B + Math.round(10 * k + 1) + 'px ' + FONT_M, fl ? '#d6ff74' : '#8d7aaa', 'right');
      }
      // narrator (unreliable)
      let nar = g.narrator.until > t ? g.narrator.text : '';
      const nl = wrap(nar ? '> ' + nar : '', W - 2 * pad - 110, MONO_B + Math.round(12 * k + 1) + 'px ' + FONT_M);
      nl.slice(0, 2).forEach((ln, i) => textShadowed(ln, pad, y0 + 72 * k + i * 15 * k, MONO_B + Math.round(12 * k + 1) + 'px ' + FONT_M, '#ffd1f5'));
      // score / combo / level tag (right column; DOM buttons sit above it)
      const rx = W - pad;
      const lvlTxt = 'L' + g.L.id + ' ' + g.L.name, lvlF = MONO_B + Math.round(10 * k + 1) + 'px ' + FONT_M;
      textShadowed(lvlTxt, pad, y0 + 100 * k, lvlF, '#8d7aaa');
      { const tag = (g.speed < 1 ? 'SLOW ' + Math.round(g.speed * 100) + '%  ' : '') + (g.noLimit ? 'NO LIMIT' : ''); if (tag) { c.font = lvlF; textShadowed(tag.trim(), pad + c.measureText(lvlTxt).width + 10, y0 + 100 * k, lvlF, g.noLimit ? '#d6ff74' : '#9afcff'); } }
      textShadowed(String(g.score).padStart(6, '0'), rx, y0 + 76 * k + 28 * k, '900 ' + Math.round(18 * k) + 'px ' + FONT_D, '#fff1c9', 'right');
      const cm = g.combo > 0 ? 'x' + g.combo + (g.mult > 1 ? '  (x' + g.mult + ' pts)' : '') : '';
      textShadowed(cm, rx, y0 + 76 * k + 46 * k, MONO_B + Math.round(12 * k + 1) + 'px ' + FONT_M, g.combo >= 10 ? '#d6ff74' : '#9afcff', 'right');
      const tv = R.tangentView(g, t);
      if (tv.immune) textShadowed('FREEZE IMMUNE ' + Math.ceil(tv.left) + 's', rx, y0 + 76 * k + 64 * k, MONO_B + Math.round(12 * k + 1) + 'px ' + FONT_M, '#d6ff74', 'right', '#d6ff74');

      // coach / rule text (tutorial) on a panel under the horizon
      const coach = R.coachLine(g, t);
      if (coach && (g.noLimit || t < g.dur - 1) && !R.isFrozen(g, t)) {
        const f = MONO_B + Math.round(14 * k + 1) + 'px ' + FONT_M, lh = 19 * k + 2, py = L.horizonY + 12;
        let inset = 0, lines = wrap(coach, W - 2 * pad - 24, f);
        if (opt.arrows && py + lines.length * lh + 16 > L.arrowTop) {       // keep the text clear of the thumb arrows
          inset = L.arrowSize + 14; lines = wrap(coach, W - 2 * pad - 2 * inset - 24, f);
        }
        const ph = lines.length * lh + 16;
        panel(pad + inset, py, W - 2 * pad - 2 * inset, ph, 0.78);
        lines.forEach((ln, i) => textShadowed(ln, pad + inset + 12, py + 22 + i * lh, f, '#f4e9ff'));
      }

      // tilt gauge + zero meter + slider
      gaugeAndSlider(g, t, now, opt);
    }

    // ZAP beam from the letter-laser button to the ringed letter (screen space, already un-rotated).
    function letterBeams(g, now, fx, opt) {
      if (!fx.letterBeams || !fx.letterBeams.length) return;
      const x0 = V.W / 2, y0 = L.escBottom - 32;
      c.save();
      for (const b of fx.letterBeams) {
        const age = now - b.t0; if (age > 0.28) continue;
        const ext = clamp(age / 0.05, 0, 1), a = clamp(1 - Math.max(0, age - 0.08) / 0.2, 0, 1);
        const tx = b.x, ty = b.y, ex = x0 + (tx - x0) * ext, ey = y0 + (ty - y0) * ext;
        const col = b.hit ? '214,255,116' : '255,124,233';
        c.lineCap = 'round';
        if (!opt.reduce) { c.strokeStyle = 'rgba(' + col + ',' + 0.28 * a + ')'; c.lineWidth = 14; c.beginPath(); c.moveTo(x0, y0); c.lineTo(ex, ey); c.stroke(); }
        c.strokeStyle = 'rgba(' + col + ',' + 0.95 * a + ')'; c.lineWidth = opt.reduce ? 3 : 5; c.beginPath(); c.moveTo(x0, y0); c.lineTo(ex, ey); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,' + a + ')'; c.lineWidth = 2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(ex, ey); c.stroke();
      }
      c.restore();
    }

    // ---- ENERGY ORBS: lanes + orbs flying from the horizon to the catch line; the catcher bracket's x IS the current tilt (deg * px-per-degree).
    // Align the bracket with the orb's landing ring when the orb arrives. Lime/gold energy look, distinct from the magenta/cyan laser nodes.
    function orbLayer(g, t, now, fx, opt, frozen) {
      const ov = R.orbView(g, t); if (!ov) return;
      const k = clamp(V.k, 0.8, 1.1), cx = V.W / 2, hy = L.horizonY, yc = L.orbY, ppd = L.orbPPD, tol = ov.tol * ppd;
      const catchX = cx + clamp(ov.deg, -13, 13) * ppd;
      const live = ov.orbs.filter(o => o.state === 'pending' || o.state === 'missed');
      const target = live.find(o => o.state === 'pending' && o.flying);
      const aligned = !!target && target.aligned && !frozen;
      c.save();
      for (const o of live) {                                         // lane + landing ring
        const lx = cx + clamp(o.theta, -13, 13) * ppd, a = o.state === 'missed' ? 0.15 : 0.10 + 0.20 * o.shimmer + (o.flying ? 0.14 : 0);
        c.globalAlpha = a * (o.aligned && o.flying ? 1.8 : 1); c.strokeStyle = o.aligned && o.flying ? '#d6ff74' : '#ffe27a'; c.lineWidth = o.aligned && o.flying ? 3 : 1.5; c.setLineDash([5, 7]);
        c.beginPath(); c.moveTo(cx, hy); c.lineTo(lx, yc); c.stroke(); c.setLineDash([]);
        c.globalAlpha = Math.min(1, a * 3); c.strokeStyle = '#ffe27a'; c.lineWidth = 2; c.beginPath(); c.ellipse(lx, yc, tol + 3, 7 * k, 0, 0, TAU); c.stroke();
        if (!o.flying) {                                              // faint approach shimmer on the horizon before launch
          const sh = opt.reduce ? 0.45 : 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(now * 9));
          c.globalAlpha = o.shimmer * sh; c.fillStyle = '#ffe27a'; c.shadowColor = '#ffe27a'; c.shadowBlur = 14; c.beginPath(); c.arc(cx, hy, 3 + 3 * o.shimmer, 0, TAU); c.fill(); c.shadowBlur = 0;
        }
      }
      c.globalAlpha = 1;
      for (const o of live) {                                         // the orb
        if (!o.flying) continue;
        const lx = cx + clamp(o.theta, -13, 13) * ppd, q = o.k * o.k, x = cx + (lx - cx) * q, y = hy + (yc - hy) * q, r = (4 + 17 * q) * k, fade = o.state === 'missed' ? clamp(1 + o.wallLeft / 0.7, 0, 1) : 1;
        if (!opt.reduce) for (let i = 3; i >= 1; i--) {               // short comet tail
          const qq = Math.max(0, (o.k - i * 0.035)) ** 2; c.globalAlpha = 0.16 * (4 - i) / 3 * fade; c.fillStyle = '#ffe27a';
          c.beginPath(); c.arc(cx + (lx - cx) * qq, hy + (yc - hy) * qq, r * (1 - i * 0.18), 0, TAU); c.fill();
        }
        c.globalAlpha = fade;
        const gr = c.createRadialGradient(x, y, 0, x, y, r * 2.4); gr.addColorStop(0, 'rgba(255,250,200,0.95)'); gr.addColorStop(0.35, 'rgba(255,226,122,0.55)'); gr.addColorStop(1, 'rgba(255,200,60,0)');
        c.fillStyle = gr; c.beginPath(); c.arc(x, y, r * 2.4, 0, TAU); c.fill();
        c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x, y, r * 0.55, 0, TAU); c.fill();
        const inRing = o.state === 'pending' && o.k >= R.ORB_IN_K;
        c.strokeStyle = inRing ? '#d6ff74' : (o.aligned ? '#d6ff74' : '#ffe27a'); c.lineWidth = inRing ? 4 : 2.5; c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
        if (inRing) textShadowed('TAP', x, y - r - 6, '900 ' + Math.round(13 * k) + 'px ' + FONT_D, '#d6ff74', 'center', '#d6ff74');
        c.save(); c.translate(x, y); c.rotate(opt.reduce ? 0 : now * 1.7); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.5;          // 4-point star flare
        c.beginPath(); c.moveTo(-r * 1.5, 0); c.lineTo(r * 1.5, 0); c.moveTo(0, -r * 1.5); c.lineTo(0, r * 1.5); c.stroke(); c.restore();
        c.globalAlpha = 1;
      }
      // the catcher: a bracket that slides with the tilt; it glows lime and says LOCK ON when it sits on the arriving orb's lane
      if (live.length) {
        const bh = 34 * k, bw = Math.max(tol + 4, 16), col = frozen ? 'rgba(154,252,255,0.35)' : (aligned ? '#d6ff74' : '#9afcff');
        c.strokeStyle = col; c.lineWidth = aligned ? 4 : 3; c.shadowColor = col; c.shadowBlur = aligned ? 18 : 8;
        c.beginPath(); c.moveTo(catchX - bw + 9, yc - bh / 2); c.lineTo(catchX - bw, yc - bh / 2); c.lineTo(catchX - bw, yc + bh / 2); c.lineTo(catchX - bw + 9, yc + bh / 2);
        c.moveTo(catchX + bw - 9, yc - bh / 2); c.lineTo(catchX + bw, yc - bh / 2); c.lineTo(catchX + bw, yc + bh / 2); c.lineTo(catchX + bw - 9, yc + bh / 2); c.stroke(); c.shadowBlur = 0;
        c.fillStyle = col; c.beginPath(); c.moveTo(catchX, yc - 7 * k); c.lineTo(catchX + 6 * k, yc); c.lineTo(catchX, yc + 7 * k); c.lineTo(catchX - 6 * k, yc); c.closePath(); c.fill();
        if (aligned) textShadowed('LOCK ON', catchX, yc - bh / 2 - 8, MONO_B + Math.round(11 * k + 1) + 'px ' + FONT_M, '#d6ff74', 'center');
        else if (target) textShadowed('TILT TO CATCH', cx, yc - bh / 2 - 8, MONO_B + Math.round(10 * k + 1) + 'px ' + FONT_M, 'rgba(255,226,122,0.9)', 'center');
      }
      for (const b of fx.bursts) {                                    // catch burst
        const age = now - b.t0; if (age > 0.6) continue; const u = age / 0.6;
        c.globalAlpha = 1 - u; c.strokeStyle = '#d6ff74'; c.lineWidth = 4 * (1 - u) + 1; c.beginPath(); c.arc(catchX, yc, opt.reduce ? 26 * k : (14 + 70 * u) * k, 0, TAU); c.stroke();
        if (!opt.reduce) { c.fillStyle = '#ffffff'; for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + 0.3; c.fillRect(catchX + Math.cos(a) * (10 + 64 * u) * k - 1.5, yc + Math.sin(a) * (10 + 64 * u) * k - 1.5, 3, 3); } }
      }
      for (const f of fx.floats) {                                    // +10s / ORB LOST float text
        const age = now - f.t0; if (age > 1.3) continue; c.globalAlpha = 1 - ease(Math.max(0, age - 0.6) / 0.7);
        textShadowed(f.text, catchX, yc - 34 * k - (opt.reduce ? 10 : age * 46), '900 ' + Math.round((f.small ? 14 : 30) * k) + 'px ' + FONT_D, f.color, 'center', f.color);
      }
      c.globalAlpha = 1; c.restore();
    }

    // ---- frozen-mode laser layer: drifting "misalignment nodes", neon beams from the FIRE button, sparks, floating bonus text
    function laserArea() {
      const k = clamp(V.k, 0.8, 1.1), yTop = L.top + L.hudH + 142 * k, fireTop = L.escBottom - 64 - 10 - 64;
      return { yTop, yBot: clamp(fireTop - 8, yTop + 50, L.sliderTop - 20), fireY: fireTop + 32, k };
    }
    function laserLayer(g, t, now, fx, opt, frozen) {
      const A_ = laserArea(), W = V.W, k = A_.k, X = x => x * W, Y = y => A_.yTop + y * (A_.yBot - A_.yTop);
      c.save();
      const view = frozen ? R.laserView(g, t) : null;
      if (view) {
        for (const n of view.targets) {
          if (n.state !== 'alive') continue;
          const x = X(n.x), y = Y(n.y), r = 15 * k, fl = opt.reduce ? 1 : 0.65 + 0.35 * Math.sin(now * 23 + n.id * 3), born = Math.min(1, n.age / 0.25);
          c.globalAlpha = clamp(born, 0, 1) * fl;
          c.strokeStyle = '#ff3fd6'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, r * (1.6 - 0.6 * born), 0, 6.2832); c.stroke();
          c.fillStyle = 'rgba(255,63,214,0.25)'; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
          c.strokeStyle = '#9afcff'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y - r * 0.7); c.lineTo(x + r * 0.7, y); c.lineTo(x, y + r * 0.7); c.lineTo(x - r * 0.7, y); c.closePath(); c.stroke();
          c.fillStyle = '#ffffff'; c.fillRect(x - 2, y - 2, 4, 4);
          if (!opt.reduce && Math.sin(now * 9 + n.id * 5) > 0.88) { c.fillStyle = 'rgba(106,246,255,0.8)'; c.fillRect(x - r - 6, y - 2, 2 * r + 12, 3); }     // glitch slice
        }
        c.globalAlpha = 1;
        // aim line (faint) so the beam column is readable
        c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1; c.setLineDash([4, 8]); c.beginPath(); c.moveTo(W / 2, A_.fireY - 36); c.lineTo(W / 2, A_.yTop - 6); c.stroke(); c.setLineDash([]);
      }
      for (const b of fx.lasers) {
        const age = now - b.t0; if (age > 0.26) continue;
        const ext = clamp(age / 0.05, 0, 1), a = clamp(1 - Math.max(0, age - 0.08) / 0.18, 0, 1);
        const tx = b.result === 'miss' ? W / 2 : X(b.x), ty = b.result === 'miss' ? A_.yTop - 8 : Y(b.y), x0 = W / 2, y0 = A_.fireY - 34;
        const ex = x0 + (tx - x0) * ext, ey = y0 + (ty - y0) * ext, col = b.result === 'hit' ? '214,255,116' : (b.result === 'near' ? '106,246,255' : '255,124,233');
        c.lineCap = 'round';
        if (!opt.reduce) { c.strokeStyle = 'rgba(' + col + ',' + 0.25 * a + ')'; c.lineWidth = 16; c.beginPath(); c.moveTo(x0, y0); c.lineTo(ex, ey); c.stroke(); }
        c.strokeStyle = 'rgba(' + col + ',' + 0.9 * a + ')'; c.lineWidth = opt.reduce ? 3 : 6; c.beginPath(); c.moveTo(x0, y0); c.lineTo(ex, ey); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,' + a + ')'; c.lineWidth = 2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(ex, ey); c.stroke();
      }
      for (const s of fx.sparks) {
        const age = now - s.t0; if (age > 0.55) continue; const x = X(s.x), y = Y(s.y), a = 1 - age / 0.55;
        if (opt.reduce) { c.strokeStyle = 'rgba(214,255,116,' + a + ')'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 10 + age * 60, 0, 6.2832); c.stroke(); continue; }
        for (let i = 0; i < 14; i++) { const ang = i / 14 * 6.2832 + (i % 2) * 0.2, d = (12 + 70 * age) * (0.6 + 0.4 * ((i * 7) % 5) / 4); c.fillStyle = (i % 3 ? 'rgba(214,255,116,' : 'rgba(255,255,255,') + a + ')'; c.fillRect(x + Math.cos(ang) * d - 2, y + Math.sin(ang) * d - 2, 4, 4); }
        c.strokeStyle = 'rgba(255,63,214,' + a + ')'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 8 + age * 90, 0, 6.2832); c.stroke();
      }
      c.restore();
      for (const z of fx.zaps) {
        const age = now - z.t0; if (age > 1.1) continue; const a = clamp(1 - Math.max(0, age - 0.6) / 0.5, 0, 1);
        c.globalAlpha = a; textShadowed(z.text, clamp(X(z.x), 100, W - 100), Y(z.y) - 22 * k - age * 40, '900 ' + Math.round(15 * k + 2) + 'px ' + FONT_D, z.color, 'center', z.color); c.globalAlpha = 1;
      }
    }

    function gaugeAndSlider(g, t, now, opt) {
      const x0 = L.trackX0, x1 = L.trackX1, w = x1 - x0, cx = (x0 + x1) / 2, gy = L.gaugeY, k = clamp(V.k, 0.8, 1.1);
      const deg = R.tilt(g, t), RANGE = 20;
      const X = a => cx + clamp(a, -RANGE, RANGE) / RANGE * (w / 2);
      // gauge zones
      const gh = 12;
      c.fillStyle = 'rgba(20,8,50,0.9)'; c.fillRect(x0, gy, w, gh);
      const band = (a0, a1, col) => { c.fillStyle = col; c.fillRect(X(a0), gy, X(a1) - X(a0), gh); };
      band(-R.LOCK_DEG, R.LOCK_DEG, 'rgba(255,60,90,0.95)');
      band(R.LOCK_DEG, R.ZONE_MIN, 'rgba(255,200,70,0.45)'); band(-R.ZONE_MIN, -R.LOCK_DEG, 'rgba(255,200,70,0.45)');
      band(R.ZONE_MIN, R.ZONE_MAX, 'rgba(120,255,160,0.9)'); band(-R.ZONE_MAX, -R.ZONE_MIN, 'rgba(120,255,160,0.9)');
      c.strokeStyle = 'rgba(106,246,255,0.5)'; c.lineWidth = 1; c.strokeRect(x0 + 0.5, gy + 0.5, w - 1, gh - 1);
      for (let a = -20; a <= 20; a += 5) { c.beginPath(); c.moveTo(X(a), gy + gh); c.lineTo(X(a), gy + gh + 4); c.stroke(); }
      // needle = the TILT LOCK marker: ring pulses when ready, countdown ring + padlock + ice tint when locked, dimmed on cooldown
      const li = R.tiltLockInfo(g, t), nx = X(deg), nyc = gy - 6, frz = R.isFrozen(g, t);
      if (li.state === 'locked') { c.fillStyle = 'rgba(106,246,255,0.28)'; c.fillRect(x0, gy, w, gh); c.strokeStyle = 'rgba(154,252,255,0.95)'; c.lineWidth = 2; c.strokeRect(x0 + 1, gy + 1, w - 2, gh - 2); }
      c.save(); if (li.state === 'cooldown' && !frz) c.globalAlpha = 0.4;
      c.fillStyle = frz ? '#9afcff' : (li.state === 'locked' ? '#9afcff' : '#ffffff'); c.beginPath(); c.moveTo(nx, gy - 1); c.lineTo(nx - 7, gy - 12); c.lineTo(nx + 7, gy - 12); c.closePath(); c.fill();
      c.restore();
      if (!frz) {
        if (li.state === 'ready') { c.strokeStyle = 'rgba(154,252,255,' + (opt.reduce ? 0.45 : 0.3 + 0.25 * Math.sin(now * 5)) + ')'; c.lineWidth = 2; c.beginPath(); c.arc(nx, nyc, 14, 0, 6.2832); c.stroke(); }
        else if (li.state === 'locked') {
          c.strokeStyle = '#9afcff'; c.lineWidth = 3; c.beginPath(); c.arc(nx, nyc, 14, -Math.PI / 2, -Math.PI / 2 + 6.2832 * li.frac); c.stroke();
          const ix = nx, iy = gy - 34;                                    // padlock icon above the marker
          c.fillStyle = '#9afcff'; c.fillRect(ix - 7, iy, 14, 11); c.strokeStyle = '#9afcff'; c.lineWidth = 2.5; c.beginPath(); c.arc(ix, iy, 5, Math.PI, 0); c.stroke();
          c.fillStyle = '#10163a'; c.fillRect(ix - 1.5, iy + 3, 3, 5);
          textShadowed(li.left.toFixed(1) + 's', clamp(ix + 14, x0 + 20, x1 - 20), iy + 10, MONO_B + Math.round(11 * k + 1) + 'px ' + FONT_M, '#9afcff', 'left');
        } else { c.strokeStyle = 'rgba(154,252,255,0.35)'; c.lineWidth = 2; c.beginPath(); c.arc(nx, nyc, 14, -Math.PI / 2, -Math.PI / 2 + 6.2832 * li.frac); c.stroke(); }
      }
      const lab = (deg >= 0 ? '+' : '') + deg.toFixed(1) + ' deg';
      const f = MONO_B + Math.round(12 * k + 1) + 'px ' + FONT_M;
      textShadowed('TILT ' + lab, x0, gy + gh + 17 * k, f, g.inZone ? '#9dffb3' : '#e7b6ff');
      textShadowed(frz ? 'GRID FROZEN' : (li.state === 'locked' ? 'TAP AGAIN ' + li.left.toFixed(1) + 's' : (li.state === 'cooldown' ? 'LOCK RECHARGING' : (g.inZone ? 'NEAR-MISS ZONE' : 'RED = FREEZE  GREEN = ZERO'))), x1, gy + gh + 17 * k, MONO_B + Math.round(10 * k + 1) + 'px ' + FONT_M, li.state === 'locked' ? '#9afcff' : (g.inZone ? '#9dffb3' : '#8d7aaa'), 'right');
      // zero meter
      const zy = gy + gh + 26 * k, zw = w, zk = g.zeroSet ? 1 : clamp(g.zone / g.L.zoneNeed, 0, 1);
      c.fillStyle = 'rgba(20,8,50,0.9)'; c.fillRect(x0, zy, zw, 8);
      const zg = c.createLinearGradient(x0, 0, x1, 0); zg.addColorStop(0, '#30e0ff'); zg.addColorStop(1, '#ff3fd6');
      c.fillStyle = g.zeroSet ? '#d6ff74' : zg; c.fillRect(x0, zy, zw * zk, 8);
      c.strokeStyle = 'rgba(106,246,255,0.5)'; c.strokeRect(x0 + 0.5, zy + 0.5, zw - 1, 7);
      textShadowed(g.zeroSet ? 'NEW ZERO SET' : 'ZERO METER ' + Math.round(zk * 100) + '%', x0, zy + 22 * k, MONO_B + Math.round(10 * k + 1) + 'px ' + FONT_M, g.zeroSet ? '#d6ff74' : '#9afcff');
      // slider track + handle (big thumb target)
      const ty = L.trackY, th = L.trackH;
      panel(x0 - 4, ty - th / 2, w + 8, th, 0.7, 'rgba(255,63,214,0.6)');
      c.strokeStyle = 'rgba(106,246,255,0.35)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x0 + 24, ty); c.lineTo(x1 - 24, ty); c.stroke();
      const hx = cx + g.p * (w / 2 - 40), hw = 76, hh = th - 8;
      const hg = c.createLinearGradient(0, ty - hh / 2, 0, ty + hh / 2); hg.addColorStop(0, '#9af6ff'); hg.addColorStop(0.5, '#2f8cff'); hg.addColorStop(0.52, '#ff6fe0'); hg.addColorStop(1, '#ff9a3c');
      c.fillStyle = hg; c.shadowColor = '#ff3fd6'; c.shadowBlur = 12; c.beginPath(); c.roundRect ? c.roundRect(hx - hw / 2, ty - hh / 2, hw, hh, 10) : c.rect(hx - hw / 2, ty - hh / 2, hw, hh); c.fill(); c.shadowBlur = 0;
      c.fillStyle = '#12052a';
      const arr = (dir) => { c.beginPath(); c.moveTo(hx + dir * 24, ty); c.lineTo(hx + dir * 10, ty - 9); c.lineTo(hx + dir * 10, ty + 9); c.closePath(); c.fill(); };
      arr(-1); arr(1);
      if (g.sign < 0) { textShadowed('REVERSED', cx, ty - th / 2 - 5, MONO_B + '11px ' + FONT_M, '#ff7ce9', 'center'); }
    }

    function overlays(g, t, now, fx, opt) {
      c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      const W = V.W, k = clamp(V.k, 0.8, 1.2);
      // lead-in / title card
      if (t < 0) {
        const kk = clamp(-t / g.L.lead, 0, 1) || 1;
        c.fillStyle = 'rgba(5,0,20,0.55)'; c.fillRect(0, L.horizonY - 70 * k, W, 120 * k);
        textShadowed('LEVEL ' + g.L.id, W / 2, L.horizonY - 20 * k, '900 ' + Math.round(26 * k) + 'px ' + FONT_D, '#6af6ff', 'center', '#6af6ff');
        textShadowed(g.L.name, W / 2, L.horizonY + 14 * k, '900 ' + Math.round(22 * k) + 'px ' + FONT_D, '#ff7ce9', 'center', '#ff3fd6');
        textShadowed('GET READY', W / 2, L.horizonY + 38 * k, MONO_B + Math.round(13 * k) + 'px ' + FONT_M, '#f4e9ff', 'center');
      }
      if (R.isFrozen(g, t)) {
        const left = clamp((g.frozenUntil - t) / (R.FREEZE_S * g.speed), 0, 1);
        const fy = L.top + L.hudH + 40 * k;
        c.fillStyle = 'rgba(5,0,20,0.7)'; c.fillRect(0, fy - 34 * k, W, 130 * k);
        textShadowed('ALIGNED.', W / 2, fy, '900 ' + Math.round(30 * k) + 'px ' + FONT_D, '#9afcff', 'center', '#6af6ff');
        textShadowed('GRID FROZEN.', W / 2, fy + 34 * k, '900 ' + Math.round(26 * k) + 'px ' + FONT_D, '#9afcff', 'center', '#6af6ff');
        c.fillStyle = 'rgba(154,252,255,0.9)'; c.fillRect(W * 0.2, fy + 48 * k, W * 0.6 * left, 4);
        const lv = R.laserView(g, t);
        if (lv) textShadowed('DYSTOPIAN SCORE +' + lv.bonus + (lv.total !== lv.bonus ? ' (LEVEL +' + lv.total + ')' : '') + '   SHOTS ' + lv.left + '/' + R.LASER_SHOTS, W / 2, fy + 80 * k, MONO_B + Math.round(12 * k + 1) + 'px ' + FONT_M, '#ff9bea', 'center', '#ff3fd6');
      }
      for (const b of fx.banners) {
        const age = now - b.t0; if (age > b.dur) continue;
        const a = age < 0.15 ? age / 0.15 : (age > b.dur - 0.5 ? (b.dur - age) / 0.5 : 1);
        c.globalAlpha = clamp(a, 0, 1);
        const lines = wrap(b.text, W - 40, '900 ' + Math.round(b.size * k) + 'px ' + FONT_D);
        const y = b.y != null ? b.y : L.top + L.hudH + 52 * k;
        c.fillStyle = 'rgba(5,0,20,0.7)'; c.fillRect(0, y - b.size * k, W, lines.length * (b.size * k * 1.2) + 14);
        lines.forEach((ln, i) => textShadowed(ln, W / 2, y + i * b.size * k * 1.2, '900 ' + Math.round(b.size * k) + 'px ' + FONT_D, b.color, 'center', b.color));
        c.globalAlpha = 1;
      }
    }

    /** Screen position of a flying orb, matching orbLayer. px/py are canvas CSS pixels. */
    function orbAt(g, t, px, py) {
      const ov = R.orbView(g, t); if (!ov) return null;
      const ks = clamp(V.k, 0.8, 1.1), cx = V.W / 2, hy = L.horizonY, yc = L.orbY, ppd = L.orbPPD;
      let best = null, bd = Infinity;
      for (const o of ov.orbs) {
        if (o.state !== 'pending' || !o.flying) continue;
        const lx = cx + clamp(o.theta, -13, 13) * ppd, q = o.k * o.k;
        const x = cx + (lx - cx) * q, y = hy + (yc - hy) * q;
        const r = Math.max(44, (4 + 17 * q) * ks * 2.4);
        const d = Math.hypot(px - x, py - y);
        if (d <= r && d < bd) { bd = d; best = o.i; }
      }
      return best;
    }
    return { V, L, resize, backdrop, play, titleWord, chromeLetter, markLayout, markScreen, markHits, orbAt, readInsets };
  }

  root.Renderer = { create };
})(window);
