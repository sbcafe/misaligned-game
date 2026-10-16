/* MISALIGNED - screens (state machine), input, settings, glue between Rules / GameAudio / Renderer. */
(function () {
  'use strict';
  const R = window.Rules, A = window.GameAudio;
  const $ = id => document.getElementById(id);
  const canvas = $('stage');
  const rend = window.Renderer.create(canvas);
  const params = new URLSearchParams(location.search);
  const TRACK_URL = 'assets/stomp-signal.mp3';

  // ------------------------------------------------------------------ settings
  const DEF = { volume: 0.8, muted: false, latencyMs: 0, reduceMotion: false, haptics: true, arrows: true, speed: 1, music: true, sfx: true, tick: false, mode: 'standard', orbs: true };
  let settings = Object.assign({}, DEF, { reduceMotion: !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) });
  try { Object.assign(settings, JSON.parse(localStorage.getItem('misaligned.settings.v1') || '{}')); } catch (e) {}
  if (R.SPEEDS.indexOf(settings.speed) < 0) settings.speed = 1;
  if (settings.mode !== 'nolimit') settings.mode = 'standard';
  function saveSettings() { try { localStorage.setItem('misaligned.settings.v1', JSON.stringify(settings)); } catch (e) {} }
  // Slow mode keeps the track running (the beat clock is the song) but silences it. SFX stay.
  // The saved MUSIC toggle is unchanged, so 100% speed brings the song back. Menu and result beds
  // play at full speed and follow the toggle; only a level whose own speed is below 100% is muted.
  function songAudible() {
    if (!settings.music) return false;
    if (running && g && g.speed < 1) return false;
    return true;
  }
  function applySettings() {
    A.volume = settings.volume; A.muted = settings.muted; A.applyVolume();
    A.musicOn = songAudible(); A.sfxOn = settings.sfx; A.applyMix();
    const v = $('titleVideo'); v.volume = settings.volume; v.muted = settings.muted;          // the title video follows MASTER mute/volume only
    document.body.classList.toggle('rm', settings.reduceMotion);
    $('rngVol').value = Math.round(settings.volume * 100); $('volVal').textContent = Math.round(settings.volume * 100) + '%';
    $('setMute').textContent = 'MUTE: ' + (settings.muted ? 'ON' : 'OFF'); $('setMute').classList.toggle('on', settings.muted);
    $('latVal').textContent = (settings.latencyMs > 0 ? '+' : '') + settings.latencyMs + ' ms';
    $('setRM').textContent = 'REDUCE MOTION: ' + (settings.reduceMotion ? 'ON' : 'OFF'); $('setRM').classList.toggle('on', settings.reduceMotion);
    document.body.classList.toggle('arrows-off', !settings.arrows);
    $('setArrows').textContent = 'ARROW BUTTONS: ' + (settings.arrows ? 'ON' : 'OFF'); $('setArrows').classList.toggle('on', settings.arrows);
    $('setHap').textContent = 'HAPTICS: ' + (settings.haptics ? 'ON' : 'OFF'); $('setHap').classList.toggle('on', settings.haptics);
    const sp = Math.round(settings.speed * 100);
    $('setSpeed').textContent = 'GAME SPEED: ' + sp + '%' + (settings.speed < 1 ? ' (SLOW, MUSIC MUTED)' : ''); $('setSpeed').classList.toggle('on', settings.speed < 1);
    $('pSpeed').textContent = 'SPEED ' + sp + '%' + (settings.speed < 1 ? ' SLOW, MUSIC MUTED' : '') + ' (NEXT LEVEL)'; $('pSpeed').classList.toggle('on', settings.speed < 1);
    $('setOrbs').textContent = 'ENERGY ORBS: ' + (settings.orbs ? 'ON' : 'OFF'); $('setOrbs').classList.toggle('on', !settings.orbs);
    $('setMode').textContent = 'MODE: ' + (settings.mode === 'nolimit' ? 'NO TIME LIMIT' : 'STANDARD'); $('setMode').classList.toggle('on', settings.mode === 'nolimit');
    const slowMute = settings.speed < 1;
    $('setMusic').textContent = 'MUSIC: ' + (settings.music ? 'ON' : 'OFF') + (slowMute ? ' · MUTED IN SLOW' : ''); $('setMusic').classList.toggle('on', !settings.music || slowMute);
    const levelMuted = running && g && g.speed < 1;
    $('pMusic').textContent = levelMuted ? 'MUSIC: MUTED (SLOW MODE)' : ('MUSIC: ' + (settings.music ? 'ON' : 'OFF (SFX ON)')); $('pMusic').classList.toggle('on', levelMuted || !settings.music);
    $('setSfx').textContent = 'SFX: ' + (settings.sfx ? 'ON' : 'OFF'); $('setSfx').classList.toggle('on', !settings.sfx);
    $('setTick').textContent = 'BEAT TICK: ' + (settings.tick ? 'ON' : 'OFF'); $('setTick').classList.toggle('on', settings.tick);
    const hear = songAudible();
    $('icoMusic').style.opacity = hear ? 1 : 0.55; $('icoMusicX').style.display = hear ? 'none' : '';
    $('icoSound').style.opacity = settings.muted ? 0.35 : 1;
  }
  function vib(p) { if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } }

  // ------------------------------------------------------------------ screens
  const SCREENS = ['boot', 'video', 'menu', 'howto', 'intro', 'settings', 'calib', 'pause', 'zeroset', 'result', 'final', 'credits'];
  let state = 'boot', prevState = 'menu';
  function show(name) {
    for (const s of SCREENS) {
      const el = $('screen-' + s);
      if (s === name) { el.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show'))); }
      else { el.classList.remove('show'); el.classList.remove('on'); }
    }
    $('hudBtns').classList.toggle('on', name === 'play');
  }
  let lastGo = 0;
  function go(name) {
    lastGo = performance.now(); state = name; show(name === 'play' ? '' : name);
    if (name === 'play') { $('hudBtns').classList.add('on'); }
    window.__misState = name;
  }

  // ------------------------------------------------------------------ fx (purely visual)
  let fx = newFx();
  function newFx() { return { floats: [], bursts: [], timeFlash: 0, popups: [], banners: [], lasers: [], letterBeams: [], sparks: [], zaps: [], laserFlash: 0, shake: 0, glitchUntil: 0, zeroFlash: 0, missFlash: 0, tapFlash: 0, invertAnim: null }; }
  const now = () => performance.now() / 1000;
  const JCOL = { PERFECT: '#d6ff74', GOOD: '#6af6ff', MISS: '#ff4d7e', EARLY: '#ff9a3c', LATE: '#ff9a3c', STRAY: '#8d7aaa', FROZEN: '#9afcff' };
  function banner(text, color, dur, size, y) { fx.banners.push({ text, color, t0: now(), dur: dur || 2.2, size: size || 24, y }); if (fx.banners.length > 4) fx.banners.shift(); }

  // ------------------------------------------------------------------ session / game
  let session = { seed: 20261009, results: [], mode: 'standard' };
  let g = null, levelOffset = 0, fbStart = 0, running = false, paused = false, endedAt = 0;
  let curIdx = 0;

  function beginLevel(idx) {
    const spd = settings.speed;     // GAME SPEED is read once per level: changing it mid-level applies from the next level / restart
    lastTick = -1;
    const nl = session.mode === 'nolimit';
    curIdx = idx; g = R.startLevel(idx, session.seed, spd, { noLimit: nl, orbs: settings.orbs }); $('pExit').style.display = nl ? '' : 'none'; $('pQuit').style.display = nl ? 'none' : ''; fx = newFx(); ptr.clear(); twistLast = null; clearHeld();
    levelOffset = g.L.startBar * R.BAR; running = true; paused = false; endedAt = 0;
    applySettings();                                             // slow levels silence the song before the source starts
    A.stop(0);
    const pos = Math.max(0, levelOffset - g.L.lead);
    const looped = nl || settings.orbs;      // a standard level loops its bars too when an energy orb can extend it
    const ok = A.play(pos, looped ? { fadeIn: 0.08, startDelay: 0.08, rate: spd, loopStart: levelOffset, loopEnd: g.L.endBar * R.BAR, xfade: 0.006 } : { fadeIn: 0.08, startDelay: 0.08, rate: spd });
    fbStart = performance.now() + 80; g.audioOk = ok;
    go('play');
  }
  function levelT() {
    const st = A.songTime(true);        // UNWRAPPED song position: keeps counting past the loop point in NO TIME LIMIT
    if (st == null || !g.audioOk) return -g.L.lead + (performance.now() - fbStart) / 1000 * g.speed;
    return st - levelOffset;
  }
  function tapT(ts) {
    const st = A.songTimeAtEvent(ts, true);
    const lat = settings.latencyMs / 1000 * g.speed;          // latency offset is wall-clock ms -> song seconds
    if (st == null || !g.audioOk) return -g.L.lead + (ts - fbStart) / 1000 * g.speed - lat;
    return st - levelOffset - lat;
  }

  function handleEvents(evs) {
    const tn = now(), escaped = evs.some(e => e.type === 'escaped');
    for (const e of evs) {
      if (e.type === 'judge') {
        if (e.judge === 'STRAY') { fx.popups.push({ judge: 'STRAY', mark: 0, t0: tn, color: JCOL.STRAY, stray: true }); fx.popups.pop(); continue; }
        if (e.judge === 'FROZEN') continue;
        fx.popups.push({ judge: e.judge, mark: e.mark, t0: tn, color: JCOL[e.judge] || '#fff' });
        if (fx.popups.length > 12) fx.popups.shift();
        if (e.judge === 'PERFECT') { vib(10); A.blip('PERFECT'); }
        else if (e.judge === 'GOOD') { vib(6); A.blip('GOOD'); }
        else { vib(28); A.blip('MISS'); fx.missFlash = tn + 0.25; if (!settings.reduceMotion) { fx.shake = tn + 0.22; fx.glitchUntil = tn + 0.3; } }
      } else if (e.type === 'frozen') {
        vib([50, 30, 50, 30, 90]); A.blip('FROZEN'); if (!settings.reduceMotion) fx.shake = tn + 0.3;
      } else if (e.type === 'thaw') {
        fx.lasers = []; fx.sparks = [];
        if (!escaped) banner('GRID THAWED', '#6af6ff', 1.6, 22);
      } else if (e.type === 'escaped') {
        vib(15); A.blip('GOOD'); banner('ESC  -' + e.cost, '#9afcff', 1.4, 24);
      } else if (e.type === 'laser') {
        const col = e.result === 'hit' ? '#d6ff74' : (e.result === 'near' ? '#6af6ff' : '#ff7ce9');
        fx.lasers.push({ t0: tn, result: e.result, x: e.x, y: e.y }); if (fx.lasers.length > 8) fx.lasers.shift();
        A.zap('fire'); if (e.result !== 'miss') A.zap(e.result);
        vib(e.result === 'hit' ? 18 : 6);
        if (e.result !== 'miss') fx.zaps.push({ t0: tn, x: e.x, y: e.y, text: e.result === 'hit' ? (e.bonus ? 'ALIGNMENT BONUS +' + e.bonus : 'ALIGNMENT BONUS (CAP)') : (e.bonus ? 'NEAR MISS +' + e.bonus : 'NEAR MISS'), color: col });
        if (fx.zaps.length > 6) fx.zaps.shift();
        if (e.result === 'hit') { fx.sparks.push({ t0: tn, x: e.x, y: e.y }); if (fx.sparks.length > 6) fx.sparks.shift(); fx.laserFlash = tn + 0.12; if (!settings.reduceMotion) fx.shake = tn + 0.12; }
      } else if (e.type === 'tiltlock') {
        vib(12); A.blip('GOOD');
      } else if (e.type === 'tiltunlock') {
        vib(6);
      } else if (e.type === 'immune') {
        vib(16); A.blip('GOOD');
        banner('ZERO GRADIENT · FREEZE IMMUNE ' + R.TANGENT_IMMUNE_S + 's', '#d6ff74', 2.2, 22);
      } else if (e.type === 'orbcatch') {
        vib(14); A.chime(); fx.timeFlash = tn + 1.0; fx.bursts.push({ t0: tn });
        const bits = []; if (e.points) bits.push('+' + e.points); if (e.extra) bits.push('+' + e.extra + 's');
        fx.floats.push({ t0: tn, text: bits.length ? bits.join('  ') : 'MAX TIME', color: '#d6ff74' });
        fx.floats.push({ t0: tn, text: 'ZERO +' + (e.taps || 3), color: '#9dffb3', small: true });
        if (fx.floats.length > 4) fx.floats.shift();
      } else if (e.type === 'orbclick') {
        vib(8); A.blip('GOOD');
        fx.floats.push({ t0: tn, text: '+' + e.points, color: '#ffe27a' });
        if (fx.floats.length > 4) fx.floats.shift();
      } else if (e.type === 'zap') {
        A.zap('fire');
        const dest = e.mark >= 0 ? rend.markScreen(g, g.lastT, e.mark) : { x: rend.V.W / 2, y: rend.L.horizonY - 30 };
        fx.letterBeams.push({ t0: tn, hit: e.result === 'hit', x: dest.x, y: dest.y });
        if (fx.letterBeams.length > 6) fx.letterBeams.shift();
      } else if (e.type === 'orbmiss') {
        fx.floats.push({ t0: tn, text: 'ORB LOST', color: '#8d7aaa', small: true }); if (fx.floats.length > 4) fx.floats.shift();
      } else if (e.type === 'zerooffer') {
        showOffer();
      } else if (e.type === 'zeroset') {
        vib([20, 40, 20, 40, 120]); A.blip('ZERO'); fx.zeroFlash = tn + 0.4;
        banner('NEW ZERO SET', '#d6ff74', 3, 34);
      } else if (e.type === 'flip') {
        banner(e.on ? 'THE % FLIPS' : '% FLIPS BACK', '#ff7ce9', 2.2, 28);
      } else if (e.type === 'invert') {
        banner(e.on ? 'GRID INVERTED' : 'GRID RIGHT WAY UP', '#6af6ff', 2.4, 28); fx.invertAnim = { t0: tn };
        vib([30, 40, 30]);
      }
    }
  }

  function playPoint(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / (r.width || 1);
    const y = (e.clientY - r.top) / (r.height || 1);
    return { x, y, yScale: rend.V.H / rend.V.W };
  }
  function doTap(ts, pt) {
    if (!g || !running || paused || g.done) return;
    const t = tapT(ts);
    fx.tapFlash = now() + 0.1;
    if (pt) pt.marks = rend.markHits(g, g.lastT, pt.x * rend.V.W, pt.y * rend.V.H);   // tap the letter: judged by where you touch, against the frame on screen
    R.tap(g, t, pt);
    handleEvents(R.drain(g));
  }

  // BEAT TICK: schedule the metronome on the audio clock a little ahead of the song position (exact at any speed)
  let lastTick = -1;
  function tickBeats() {
    const st = A.songTime(true); if (st == null) return;
    let k = Math.max(lastTick + 1, Math.ceil((st - 0.005) / R.BEAT));
    while (k * R.BEAT < st + 0.14) { if (A.tick(k * R.BEAT, k % 4 === 0)) lastTick = k; else lastTick = k; k++; }
  }
  function escShow(on) { $('escBtn').classList.toggle('on', !!on); $('fireBtn').classList.toggle('on', !!on); if (!on) $('fireBtn').classList.remove('dim'); }

  // ------------------------------------------------------------------ main loop
  let lastFrame = now();
  const keys = { l: false, r: false, u: 0, d: 0 };      // u/d: performance time (s) when ArrowUp/ArrowDown went down, 0 = up

  // ------------------------------------------------------------------ tilt arrows (4 DOM buttons: up/down on both edges) + floating ESC
  // Direction contract: UP = grid counter-clockwise (dir -1), DOWN = clockwise (dir +1). Rules.tiltStep goes through twistBy,
  // which multiplies by g.sign, so in the INVERTED grid (level 3) the arrows reverse together with the slider (and are tinted
  // magenta while reversed). The arrows are separate DOM elements above the canvas: their pointer events never reach the
  // canvas handler, so holding/pressing an arrow is never a beat tap and a second thumb can tap while one holds an arrow.
  const arrowEls = ['aLU', 'aLD', 'aRU', 'aRD'].map($);
  const heldArrows = new Map();         // pointerId -> {el, dir, t0}
  function clearHeld() { heldArrows.clear(); arrowEls.forEach(e => e.classList.remove('pressed')); keys.l = keys.r = false; keys.u = keys.d = 0; }
  arrowEls.forEach(el => {
    const dir = Number(el.dataset.dir);
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      heldArrows.set(e.pointerId, { el, dir, t0: now() }); el.classList.add('pressed');
    });
    const rel = e => { heldArrows.delete(e.pointerId); if (![...heldArrows.values()].some(h => h.el === el)) el.classList.remove('pressed'); };
    el.addEventListener('pointerup', rel); el.addEventListener('pointercancel', rel); el.addEventListener('lostpointercapture', rel);
    el.addEventListener('contextmenu', e => e.preventDefault());
  });
  function layoutArrows() {
    const L = rend.L, V = rend.V, sz = L.arrowSize;
    const left = Math.max(V.ins.l, 0) + 8, right = Math.max(V.ins.r, 0) + 8;
    for (const el of arrowEls) {
      el.style.width = el.style.height = sz + 'px';
      el.style.top = (el.classList.contains('up') ? L.arrowTop : L.arrowTop + sz + L.arrowGap) + 'px';
      if (el.id[1] === 'L') { el.style.left = left + 'px'; el.style.right = 'auto'; } else { el.style.right = right + 'px'; el.style.left = 'auto'; }
    }
    const lb = $('lockBtn'); lb.style.left = (L.trackX0 - 10) + 'px'; lb.style.width = (L.trackX1 - L.trackX0 + 20) + 'px'; lb.style.top = (L.gaugeY - 20) + 'px'; lb.style.height = '64px';
    const fb = $('fireBtn'); fb.style.left = '50%'; fb.style.marginLeft = '-66px'; fb.style.top = (L.escBottom - 64 - 10 - 64) + 'px';
    const zb = $('zapBtn'); zb.style.left = '50%'; zb.style.marginLeft = '-66px'; zb.style.top = (L.escBottom - 64) + 'px';
    const esc = $('escBtn'); esc.style.left = '50%'; esc.style.marginLeft = '-66px'; esc.style.top = (L.escBottom - 64) + 'px';
  }
  function applyArrows(dt, t) {
    // net held time per direction (longest hold wins: accel feels continuous), + keyboard
    const hold = { '-1': -1, '1': -1 }, tn = now();
    for (const h of heldArrows.values()) hold[h.dir] = Math.max(hold[h.dir], tn - h.t0);
    if (keys.u) hold['-1'] = Math.max(hold['-1'], tn - keys.u);
    if (keys.d) hold['1'] = Math.max(hold['1'], tn - keys.d);
    const frozen = R.isFrozen(g, t);
    if (!frozen) for (const dir of [-1, 1]) if (hold[dir] >= 0) R.tiltStep(g, dir, hold[dir], dt * g.speed, t);      // arrow rate is deg per SONG second: slow mode slows it with the world
    const show = settings.arrows && state === 'play' && !paused && !g.done && t > -g.L.lead + 0.05;
    for (const el of arrowEls) { el.classList.toggle('on', show); el.classList.toggle('rev', g.invertOn); el.classList.toggle('dim', frozen); }
  }
  // tilt lock: the transparent #lockBtn covers the tilt gauge (>= 56 px tall, full gauge width) and is separate from the canvas,
  // so tapping it is never a beat tap and works while another thumb holds an arrow. Active while ready (tap locks)
  // and while locked (tap the same marker releases now). During cooldown touches fall through to the slider.
  function doLock() {
    if (!g || !running || paused || g.done || state !== 'play') return false;
    const t = levelT();
    const ok = R.tiltLockInfo(g, t).state === 'locked' ? R.releaseTilt(g, t) : R.lockTilt(g, t);
    if (ok) handleEvents(R.drain(g));
    return ok;
  }
  $('lockBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); doLock(); });
  $('lockBtn').addEventListener('contextmenu', e => e.preventDefault());
  // FIRE (frozen-mode laser): a separate DOM button (never a beat tap, multi-touch safe), only shown while the grid is frozen.
  function doFire() {
    if (!g || !running || paused || g.done || state !== 'play') return false;
    const ev = R.fire(g, levelT());
    if (!ev) return false;
    handleEvents(R.drain(g)); return true;
  }
  $('fireBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); const b = $('fireBtn'); b.classList.add('pressed'); setTimeout(() => b.classList.remove('pressed'), 90); doFire(); });
  $('fireBtn').addEventListener('contextmenu', e => e.preventDefault());
  // ZAP: shoot the ringed letter. Separate from the canvas, so it is never also a letter tap.
  function doZap() {
    if (!g || !running || paused || g.done || state !== 'play') return false;
    const ev = R.shootLetter(g, levelT());
    if (!ev) return false;
    handleEvents(R.drain(g)); return true;
  }
  $('zapBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); const b = $('zapBtn'); b.classList.add('pressed'); setTimeout(() => b.classList.remove('pressed'), 90); doZap(); });
  $('zapBtn').addEventListener('contextmenu', e => e.preventDefault());
  function doEscape() {
    if (!g || !running || paused || g.done) return;
    const t = levelT(); fx.tapFlash = 0;
    if (R.escape(g, t)) handleEvents(R.drain(g));
  }
  $('escBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); doEscape(); });
  $('escBtn').addEventListener('click', e => e.preventDefault());
  $('escBtn').addEventListener('contextmenu', e => e.preventDefault());
  function frame() {
    const tn = now(), dt = Math.min(0.1, tn - lastFrame); lastFrame = tn;
    if (window.__hold) { requestAnimationFrame(frame); return; }      // test hook: keep the last canvas frame for a screenshot
    if (state === 'play' && g) {
      if (!paused && running) {
        const t = levelT();
        if (keys.l || keys.r) R.slideTo(g, g.p + ((keys.r ? 1 : 0) - (keys.l ? 1 : 0)) * 1.3 * dt, t);
        R.update(g, t);
        applyArrows(dt, t);
        if (settings.tick) tickBeats();
        handleEvents(R.drain(g));
        escShow(R.isFrozen(g, t));
        $('zapBtn').classList.toggle('on', !R.isFrozen(g, t) && t > 0);
        $('zapBtn').classList.toggle('dim', !R.zapReady(g, t));
        if (R.isFrozen(g, t)) { const lv = R.laserView(g, t); $('fireBtn').classList.toggle('dim', !lv || lv.left <= 0); }
        const lockState = R.tiltLockInfo(g, t).state;
        $('lockBtn').classList.toggle('on', !R.isFrozen(g, t) && t > 0 && (lockState === 'ready' || lockState === 'locked'));
        if (g.done && !endedAt) { escShow(false); $('zapBtn').classList.remove('on'); $('lockBtn').classList.remove('on'); arrowEls.forEach(e => e.classList.remove('on')); endedAt = tn; A.stop(0.6); setTimeout(finishLevel, 700); running = false; }
      }
      const t = g.done ? g.dur : Math.max(g.lastT, -g.L.lead);
      fx.popups = fx.popups.filter(p => tn - p.t0 < 1);
      rend.play(g, t, tn, fx, { reduce: settings.reduceMotion, arrows: settings.arrows, musicOff: !songAudible(), orbs: settings.orbs });
    } else {
      if (state !== 'play') { escShow(false); $('zapBtn').classList.remove('on'); $('lockBtn').classList.remove('on'); for (const e of arrowEls) e.classList.remove('on'); }
      rend.backdrop(tn, { reduce: settings.reduceMotion, title: state === 'boot' || state === 'video' || state === 'menu' || state === 'settings' || state === 'calib', titleY: state === 'menu' ? rend.V.H * 0.2 : rend.V.H * 0.27 });
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ level flow
  function finishLevel() {
    const sm = R.summary(g); session.results[curIdx] = sm;
    $('resTitle').textContent = 'LEVEL ' + sm.level + ' COMPLETE' + (sm.noLimit ? ' · NO LIMIT' : '');
    const z = $('resZero'); z.textContent = sm.zeroSet ? 'NEW ZERO SET' : 'ZERO NOT SET'; z.className = 'big ' + (sm.zeroSet ? 'zs' : 'nz');
    $('resKv').innerHTML = kv((sm.orbsOn ? [['ENERGY ORBS', sm.orbsCaught + ' / ' + sm.orbsTotal + (sm.orbsClicked ? ' (' + sm.orbsClicked + ' early)' : '') + (sm.noLimit ? ' (+' + sm.orbPoints + ' pts)' : ' (+' + sm.extraWall + ' s)')]] : []).concat(sm.noLimit ? [['MODE', 'NO LIMIT (' + sm.passes + ' pass' + (sm.passes > 1 ? 'es' : '') + ')']] : []).concat(sm.speed < 1 ? [['GAME SPEED', Math.round(sm.speed * 100) + '% SLOW MODE']] : []).concat([['SCORE', sm.score], ['PERFECT', sm.perfect], ['GOOD', sm.good], ['MISS', sm.miss], ['ACCURACY', Math.round(sm.acc * 100) + '%'], ['MAX COMBO', sm.maxCombo], ['ZERO METER', sm.zonePct + '%'], ['GRID FROZEN', sm.frozen + 'x' + (sm.escapes ? ' (ESC ' + sm.escapes + 'x)' : '')], ...(sm.laserShots ? [['DYSTOPIAN BONUS', '+' + sm.laserBonus + ' (' + sm.laserHits + ' hits / ' + sm.laserShots + ' shots)']] : []), (sm.aimPct != null ? ['AIM', sm.aimPct + '%'] : ['AVG TIMING', (sm.avgDeltaMs >= 0 ? '+' : '') + Math.round(sm.avgDeltaMs) + ' ms'])]));
    $('resNote').textContent = sm.zeroSet ? '"I NEVER DOUBTED YOU." (I DID.)' : (sm.frozen ? '"ALIGNED. GRID FROZEN." YOU TRUSTED THE NUMBER.' : '"STAY 1.5-4 DEG OFF AND KEEP THE COMBO."');
    const last = curIdx === R.LEVELS.length - 1;
    $('resNext').textContent = last ? 'FINAL GRADE' : 'NEXT: LEVEL ' + (curIdx + 2);
    go('result');
    startBed(4, 12);
  }
  function kv(rows) { return rows.map(r => '<span>' + r[0] + '</span><b>' + r[1] + '</b>').join(''); }

  function showFinal() {
    const gr = R.grade(session.results);
    $('finGrade').textContent = gr.grade; $('finQuip').textContent = '"' + gr.quip + '"';
    const tags = [gr.slow ? 'SLOW MODE' + (gr.capped ? ': GRADE CAPPED AT A' : ': GRADE CAPS AT A') : '', gr.noLimit ? 'NO LIMIT' + (gr.nlCapped ? ': GRADE CAPPED AT B' : ': GRADE CAPS AT B') : ''].filter(Boolean);
    $('finSlow').textContent = tags.join(' | ');
    $('crSlow').style.display = tags.length ? '' : 'none';
    $('crSlow').innerHTML = tags.length ? '<small>MODE</small>' + (gr.slow ? 'SLOW MODE ' + gr.speeds.map(s => Math.round(s * 100) + '%').join(' / ') + '<br>' : '') + (gr.noLimit ? 'NO TIME LIMIT<br>' : '') + 'GRADE ' + gr.grade + (gr.capped || gr.nlCapped ? ' (CAPPED)' : '') : '';
    $('finKv').innerHTML = kv((gr.slow ? [['GAME SPEED', gr.speeds.map(s => Math.round(s * 100) + '%').join(' / ') + ' SLOW']] : []).concat([['TOTAL SCORE', gr.score], ['ACCURACY', Math.round(gr.acc * 100) + '%'], ['ZERO SETS', gr.zeroSets + ' / 3'], ['GRID FROZEN', gr.frozen + 'x']]).concat(gr.laserBonus ? [['DYSTOPIAN BONUS', '+' + gr.laserBonus]] : []));
    go('final');
  }
  function startBed(a, b) {
    if (!A.ctx || !A.buffer) return;
    applySettings();                                             // a slow level left the song silenced; beds play at full speed
    A.stop(0); A.play(a * R.BAR, { loopStart: a * R.BAR, loopEnd: b * R.BAR, fadeIn: 0.5 });
  }
  function startCredits() {
    $('creditsList').style.setProperty('--vh', Math.round(window.innerHeight * 0.55) + 'px');
    const list = $('creditsList'); list.style.animation = 'none'; void list.offsetHeight; list.style.animation = '';
    go('credits'); startBed(52, 56);
  }
  function intro(idx) {
    const L = R.LEVELS[idx];
    $('introNum').textContent = 'LEVEL ' + L.id; $('introName').textContent = L.name; $('introText').textContent = L.surprise;
    curIdx = idx; go('intro');
  }
  // START goes straight into level 1 (the coach lines teach the rules in-game). HOW TO PLAY is a separate menu item.
  // (Earlier bug: this function routed to the how-to card, so START always opened HOW TO PLAY.)
  let startToken = 0;
  function newGame(mode) {
    session = { seed: session.seed, results: [], mode: mode === 'nolimit' ? 'nolimit' : settings.mode };
    const tok = ++startToken;
    if (A.loadState === 'loading' && audioPromise) {                 // music still decoding: wait for it instead of starting silent
      $('mStart').textContent = 'LOADING...';
      audioPromise.then(() => { $('mStart').textContent = 'START'; if (tok === startToken && state !== 'play') beginLevel(0); });
      return;
    }
    beginLevel(0);
  }

  // ------------------------------------------------------------------ title video
  let videoDone = false;
  function playTitle() {
    const v = $('titleVideo'); go('video'); videoDone = false;
    v.currentTime = 0; v.muted = settings.muted; v.volume = settings.volume;
    let guard = setTimeout(() => { if (!videoDone && (v.currentTime < 0.05 || v.paused)) endTitle('stalled'); }, 4500);
    const p = v.play();
    if (p && p.catch) p.catch(() => endTitle('blocked'));
    v.onended = () => { clearTimeout(guard); endTitle('ended'); };
    v.onerror = () => { clearTimeout(guard); endTitle('error'); };
    window.__titleGuard = guard;
  }
  function endTitle(why) {
    if (videoDone) return; videoDone = true; window.__titleEnd = why;
    const v = $('titleVideo'); try { v.pause(); } catch (e) {}
    go('menu'); startBed(4, 12);
  }

  // ------------------------------------------------------------------ boot
  let booted = false, audioPromise = null;
  function firstTap() {
    if (booted) return; booted = true;
    A.init(); applySettings();
    if (!params.has('novideo')) playTitle(); else go('menu');
    audioPromise = A.load(TRACK_URL); audioPromise.then(mode => { window.__audioMode = mode; if (state === 'menu') startBed(4, 12); });
  }
  $('bootTap').addEventListener('click', firstTap);
  $('screen-boot').addEventListener('click', firstTap);
  $('skipBtn').addEventListener('click', () => endTitle('skipped'));

  // ------------------------------------------------------------------ buttons
  function bind(id, fn) { $(id).addEventListener('click', e => { e.preventDefault(); if (performance.now() - lastGo < 320) return; fn(); }); }
  bind('mStart', () => newGame());
  bind('mPractice', () => newGame('nolimit'));
  bind('mHow', () => go('howto'));
  bind('mSettings', () => { prevState = 'menu'; go('settings'); });
  bind('howGo', () => { session = { seed: session.seed, results: [], mode: settings.mode }; startToken++; beginLevel(0); });
  bind('howBack', () => go('menu'));
  bind('introGo', () => beginLevel(curIdx));
  bind('resNext', () => { if (curIdx >= R.LEVELS.length - 1) showFinal(); else intro(curIdx + 1); });
  bind('resRetry', () => beginLevel(curIdx));
  bind('finCredits', startCredits);
  bind('finAgain', () => newGame());
  bind('crMenu', () => { go('menu'); startBed(4, 12); });
  bind('crAgain', () => newGame());
  // pause
  // NO TIME LIMIT: the zero meter filled -> pause the world and offer CONTINUE (finish the level) or STAY (keep practicing)
  function showOffer() {
    if (paused) return; ptr.clear(); twistLast = null; clearHeld(); escShow(false); $('lockBtn').classList.remove('on'); arrowEls.forEach(e => e.classList.remove('on'));
    paused = true; A.pause();
    const sm = R.summary(g);
    $('zsKv').innerHTML = kv([['SCORE', sm.score], ['MAX COMBO', sm.maxCombo], ['TIME PLAYED', Math.max(0, Math.round(g.lastT)) + ' s (' + g.passes + ' pass' + (g.passes > 1 ? 'es' : '') + ')'], ['HITS P/G/M', sm.perfect + ' / ' + sm.good + ' / ' + sm.miss]]);
    $('zsTag').textContent = 'NO TIME LIMIT' + (g.speed < 1 ? ' · SLOW ' + Math.round(g.speed * 100) + '%' : '');
    $('zsContinue').textContent = curIdx >= R.LEVELS.length - 1 ? 'CONTINUE: FINISH' : 'CONTINUE: NEXT LEVEL';
    go('zeroset');
  }
  function pauseGame() { if (state !== 'play' || paused || !g || g.done) return; ptr.clear(); twistLast = null; clearHeld(); paused = true; A.pause(); go('pause'); }
  function resumeGame() { paused = false; A.resume(); go('play'); lastFrame = now(); }
  bind('btnPause', pauseGame);
  bind('pResume', resumeGame);
  bind('pRestart', () => { paused = false; beginLevel(curIdx); });
  bind('pSettings', () => { prevState = 'pause'; go('settings'); });
  const quitToMenu = () => { paused = false; running = false; A.stop(0.2); go('menu'); startBed(4, 12); };
  bind('pQuit', quitToMenu); bind('pExit', quitToMenu);          // EXIT PRACTICE (NO TIME LIMIT) leaves without a result
  bind('zsContinue', () => { if (!g || !g.offer) return; R.continueLevel(g, g.lastT); R.drain(g); paused = false; A.resume(); lastFrame = now(); go('play'); });
  bind('zsStay', () => { if (!g || !g.offer) return; R.stay(g); R.drain(g); paused = false; A.resume(); lastFrame = now(); go('play'); banner('KEEP PRACTICING', '#9afcff', 1.6, 24); });
  bind('btnMusic', toggleMusic);
  bind('btnMute', () => { settings.muted = !settings.muted; saveSettings(); applySettings(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  // settings
  $('rngVol').addEventListener('input', e => { settings.volume = e.target.value / 100; saveSettings(); applySettings(); });
  function toggleMusic() { settings.music = !settings.music; saveSettings(); applySettings(); }
  bind('setMusic', toggleMusic); bind('pMusic', toggleMusic);
  bind('setSfx', () => { settings.sfx = !settings.sfx; saveSettings(); applySettings(); });
  bind('setTick', () => { settings.tick = !settings.tick; saveSettings(); applySettings(); });
  bind('setMute', () => { settings.muted = !settings.muted; saveSettings(); applySettings(); });
  bind('setRM', () => { settings.reduceMotion = !settings.reduceMotion; saveSettings(); applySettings(); });
  function cycleSpeed() { const i = R.SPEEDS.indexOf(settings.speed); settings.speed = R.SPEEDS[(i + 1) % R.SPEEDS.length]; saveSettings(); applySettings(); }
  bind('setOrbs', () => { settings.orbs = !settings.orbs; saveSettings(); applySettings(); });
  bind('setMode', () => { settings.mode = settings.mode === 'nolimit' ? 'standard' : 'nolimit'; saveSettings(); applySettings(); });
  bind('setSpeed', cycleSpeed); bind('pSpeed', cycleSpeed);
  bind('setArrows', () => { settings.arrows = !settings.arrows; saveSettings(); applySettings(); });
  bind('setHap', () => { settings.haptics = !settings.haptics; saveSettings(); applySettings(); if (settings.haptics) vib(20); });
  bind('latMinus', () => { settings.latencyMs = Math.max(-300, settings.latencyMs - 10); saveSettings(); applySettings(); });
  bind('latPlus', () => { settings.latencyMs = Math.min(300, settings.latencyMs + 10); saveSettings(); applySettings(); });
  bind('setBack', () => { go(prevState === 'pause' ? 'pause' : 'menu'); });
  // calibrator
  const cal = { clicks: [], taps: [], active: false, result: null };
  function calibStart() {
    if (!A.ctx) { $('calibText').textContent = 'Audio is not available on this device.'; return; }
    A.stop(0); A.ctx.resume();
    cal.clicks = []; cal.taps = []; cal.active = true; cal.result = null;
    const t0 = A.ctxNow() + 1.2;
    for (let i = 0; i < 10; i++) { const w = t0 + i * R.BEAT; cal.clicks.push(w); A.click(w, i % 4 === 0); }
    $('calibPad').disabled = false; $('calibApply').disabled = true; $('calibOff').textContent = '...'; $('calibN').textContent = '0';
    $('calibText').textContent = 'Tap the pad on every click.';
    setTimeout(calibDone, (1.2 + 10 * R.BEAT + 0.8) * 1000);
  }
  function calibTap(ts) {
    if (!cal.active) return;
    const ago = Math.max(0, Math.min(0.25, (performance.now() - (ts || performance.now())) / 1000));
    const heard = A.ctxNow() - A.outLatency() - ago;
    let best = null; for (const c of cal.clicks) if (best == null || Math.abs(heard - c) < Math.abs(heard - best)) best = c;
    if (best != null && Math.abs(heard - best) < 0.3) cal.taps.push(heard - best);
    $('calibN').textContent = String(cal.taps.length);
  }
  function calibDone() {
    if (!cal.active) return; cal.active = false; $('calibPad').disabled = true;
    const arr = cal.taps.slice(2).sort((a, b) => a - b);
    if (arr.length < 3) { $('calibText').textContent = 'Not enough taps. Try again.'; $('calibOff').textContent = '-'; return; }
    const med = arr[Math.floor(arr.length / 2)];
    cal.result = Math.round(med * 1000); window.__calibResult = cal.result;
    $('calibOff').textContent = (cal.result > 0 ? '+' : '') + cal.result + ' ms'; $('calibApply').disabled = false;
    $('calibText').textContent = cal.result > 0 ? 'You tap late. Apply to compensate.' : 'You tap early. Apply to compensate.';
  }
  bind('latCal', () => { go('calib'); $('calibText').textContent = 'Tap the pad on every click. Ten clicks.'; $('calibOff').textContent = '-'; $('calibN').textContent = '0'; $('calibApply').disabled = true; $('calibPad').disabled = true; });
  bind('calibStart', calibStart);
  bind('calibCancel', () => { cal.active = false; go('settings'); });
  bind('calibApply', () => { settings.latencyMs = Math.max(-300, Math.min(300, cal.result || 0)); saveSettings(); applySettings(); go('settings'); });
  $('calibPad').addEventListener('pointerdown', e => { e.preventDefault(); calibTap(e.timeStamp); $('calibPad').classList.add('pressed'); });
  $('calibPad').addEventListener('pointerup', () => $('calibPad').classList.remove('pressed'));

  // ------------------------------------------------------------------ input (play)
  const ptr = new Map();            // pointerId -> {id,x,y,t0,mode,startX,startP,moved}; mode: tap | slider | twist | none
  let twistLast = null;
  function inSliderZone(y) { return y >= rend.L.sliderTop; }
  function sliderHalf() { return (rend.L.trackX1 - rend.L.trackX0) / 2 - 40; }
  function twistPair() { return [...ptr.values()].filter(q => q.mode === 'twist'); }
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'play' || !g || paused) return;
    e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    const vals = [...ptr.values()], hasSlider = vals.some(q => q.mode === 'slider');
    const mode = inSliderZone(e.clientY) ? (hasSlider ? 'none' : 'slider') : 'tap';
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: e.timeStamp, mode, startX: e.clientX, startP: g.p, moved: 0 };
    ptr.set(e.pointerId, p);
    if (mode === 'tap') {
      const pt = playPoint(e);
      const tapTime = tapT(e.timeStamp);
      const orbId = rend.orbAt(g, tapTime, pt.x * rend.V.W, pt.y * rend.V.H);
      if (orbId != null) {
        R.clickOrb(g, tapTime, orbId);          // a touch on the orb is never also a letter tap
        p.mode = 'none';
        handleEvents(R.drain(g));
      } else {
        const uppers = vals.filter(q => q.mode === 'tap' || q.mode === 'twist');
        if (uppers.length === 1 && !hasSlider) {        // two fingers in the play area = twist
          uppers[0].mode = 'twist'; p.mode = 'twist';
          twistLast = Math.atan2(p.y - uppers[0].y, p.x - uppers[0].x);
        } else doTap(e.timeStamp, pt);       // a tap, even while the other thumb is on the slider
      }
    }
  });
  canvas.addEventListener('pointermove', e => {
    const p = ptr.get(e.pointerId); if (!p || !g) return; e.preventDefault();
    p.moved = Math.max(p.moved, Math.abs(e.clientX - p.startX));
    p.x = e.clientX; p.y = e.clientY;
    if (p.mode === 'twist') {
      const tp = twistPair(); if (tp.length < 2) return;
      const ang = Math.atan2(tp[1].y - tp[0].y, tp[1].x - tp[0].x); let d = ang - twistLast;
      if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      twistLast = ang; R.twistBy(g, d * 180 / Math.PI, g.lastT);
    } else if (p.mode === 'slider') {
      R.slideTo(g, p.startP + (e.clientX - p.startX) / sliderHalf(), g.lastT);
    }
  });
  function up(e) {
    const p = ptr.get(e.pointerId); if (!p) return;
    // (v12: a quick tap in the slider zone is no longer a beat tap - you score by touching the ringed letter)
    ptr.delete(e.pointerId);
    const tp = twistPair(); if (tp.length < 2) { tp.forEach(q => { q.mode = 'none'; }); twistLast = null; }
  }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  // desktop keyboard
  addEventListener('keydown', e => {
    if (e.repeat) return;
    if (state === 'play') {
      if (e.code === 'Space' || e.code === 'Enter' || e.key === 'j') { e.preventDefault(); doTap(e.timeStamp); }
      else if (e.key === 'ArrowLeft' || e.key === 'a') keys.l = true;
      else if (e.key === 'ArrowRight' || e.key === 'd') keys.r = true;
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (!keys.u) keys.u = now(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (!keys.d) keys.d = now(); }
      else if (e.key === 'Escape') { if (g && R.isFrozen(g, g.lastT)) doEscape(); else pauseGame(); }   // Esc = ESC button while frozen, else pause
      else if (e.key === 'p') pauseGame();
      else if (e.key === 'l' || e.key === 'L') doLock();
      else if (e.key === 'f' || e.key === 'F') doFire();
      else if (e.key === 'z' || e.key === 'Z') doZap();
    } else if (state === 'pause' && (e.key === 'Escape' || e.key === 'p')) resumeGame();
    else if (state === 'boot' && (e.code === 'Space' || e.code === 'Enter')) firstTap();
  });
  addEventListener('keyup', e => { if (e.key === 'ArrowLeft' || e.key === 'a') keys.l = false; if (e.key === 'ArrowRight' || e.key === 'd') keys.r = false; if (e.key === 'ArrowUp') keys.u = 0; if (e.key === 'ArrowDown') keys.d = 0; });
  // block gestures / bounce
  document.addEventListener('touchmove', e => { if (state === 'play') e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  addEventListener('resize', () => { rend.resize(); layoutArrows(); }); addEventListener('orientationchange', () => setTimeout(() => { rend.resize(); layoutArrows(); }, 120));

  // ------------------------------------------------------------------ boot sequence
  function start() {
    applySettings(); rend.resize(); layoutArrows();
    const fontsReady = (document.fonts && document.fonts.load) ? Promise.race([
      Promise.all([document.fonts.load('900 40px "MIS Display Black"'), document.fonts.load('700 14px "MIS Mono"'), document.fonts.load('700 14px "MIS Display Bold"')]),
      new Promise(r => setTimeout(r, 2500))]) : Promise.resolve();
    fontsReady.then(() => { rend.resize(); layoutArrows(); go('boot'); requestAnimationFrame(frame); });
  }
  start();

  // test / debug hooks (read-only views + a couple of helpers)
  window.__mis = {
    R, A, get g() { return g; }, get state() { return state; }, get settings() { return settings; }, get session() { return session; },
    levelT, doTap, markScreen(i) { return g ? rend.markScreen(g, levelT(), i) : null; }, get fx() { return fx; }, rend,
    nextTargetIn() { if (!g) return null; const t = levelT(); for (const tg of g.targets) if (tg.state === 'pending' && tg.T - t > -0.12) return { dt: tg.T - t, i: tg.i, T: tg.T }; return null; },
    doEscape, doLock, doFire, heldArrows, arrowEls, firstTap, endTitle, pauseGame, resumeGame, intro, beginLevel, finishLevel, showFinal, startCredits
  };
})();
