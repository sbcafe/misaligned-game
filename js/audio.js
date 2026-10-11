/* MISALIGNED - audio layer: WebAudio buffer clock (preferred) with an <audio> element fallback.
 * The beat clock is songTime(): seconds of the track that are being HEARD right now
 * (AudioContext.currentTime interpolated with performance.now, minus output latency).
 */
(function (root) {
  'use strict';
  const A = {
    ctx: null, buffer: null, gain: null, src: null, mode: 'none', url: null,
    startCtx: 0, startOff: 0, playing: false, paused: false, loop: null,
    html: null, htmlReady: false, volume: 0.8, muted: false, loadState: 'idle', loadError: null,
    anchor: { c: 0, p: 0 }, latencyComp: 0,
    musicOn: true, sfxOn: true, musicGain: null, sfxGain: null,   // MUSIC / SFX toggles: separate gain nodes under the master gain
    rate: 1                       // playbackRate of the current play() (GAME SPEED). songTime() is in TRACK seconds, which advance `rate` per wall second
  };

  A.init = function () {                     // must be called from a user gesture
    if (A.ctx) { if (A.ctx.state === 'suspended' && !A.paused) A.ctx.resume(); return A.ctx; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (AC) {
      try {
        A.ctx = new AC({ latencyHint: 'interactive' });
        A.gain = A.ctx.createGain(); A.gain.connect(A.ctx.destination);
        A.musicGain = A.ctx.createGain(); A.musicGain.connect(A.gain);       // the song (buffer source) -> musicGain -> master
        A.sfxGain = A.ctx.createGain(); A.sfxGain.connect(A.gain);           // blips, zaps -> sfxGain -> master
        A.applyVolume();
        A.mode = 'webaudio';
        const r = A.ctx.resume(); if (r && r.catch) r.catch(() => {});
        // iOS: a silent buffer inside the gesture fully unlocks output
        const b = A.ctx.createBuffer(1, 1, 22050), s = A.ctx.createBufferSource(); s.buffer = b; s.connect(A.ctx.destination); s.start(0);
      } catch (e) { A.ctx = null; A.mode = 'none'; }
    }
    return A.ctx;
  };

  A.load = function (url) {
    A.url = url; A.loadState = 'loading';
    const viaHtml = () => {                  // graceful fallback: plain <audio>
      A.html = new Audio(); A.html.src = url; A.html.preload = 'auto'; A.html.playsInline = true;
      A.mode = 'html'; A.htmlReady = true; A.loadState = 'ready-html'; return 'html';
    };
    if (!A.ctx) return Promise.resolve(viaHtml());
    return fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(ab => new Promise((res, rej) => A.ctx.decodeAudioData(ab, res, rej)))
      .then(buf => { A.buffer = buf; A.mode = 'webaudio'; A.loadState = 'ready'; return 'webaudio'; })
      .catch(err => { A.loadError = String(err); return viaHtml(); });
  };

  A.applyVolume = function () {
    const v = A.muted ? 0 : A.volume;
    if (A.gain) A.gain.gain.setTargetAtTime(v, A.ctx.currentTime, 0.02);
    if (A.html) { A.html.volume = v; A.html.muted = !A.musicOn; }
    A.applyMix();
  };
  /** MUSIC off = the song keeps playing (so the beat clock keeps running, also at slow-mode rates) through a gain of 0. */
  A.applyMix = function () {
    // set directly (not a ramp): works while the context is suspended (pause screen) too; the click is inaudible on a note button press
    if (A.musicGain) { A.musicGain.gain.cancelScheduledValues(0); A.musicGain.gain.value = A.musicOn ? 1 : 0; }
    if (A.sfxGain) { A.sfxGain.gain.cancelScheduledValues(0); A.sfxGain.gain.value = A.sfxOn ? 1 : 0; }
    if (A.html) A.html.muted = !A.musicOn;
  };
  A.setVolume = function (v) { A.volume = Math.max(0, Math.min(1, v)); A.applyVolume(); };
  A.setMuted = function (m) { A.muted = !!m; A.applyVolume(); };

  A.outLatency = function () {               // seconds; feature-detected, capped
    if (!A.ctx) return 0;
    const l = (typeof A.ctx.outputLatency === 'number' ? A.ctx.outputLatency : 0) + (typeof A.ctx.baseLatency === 'number' ? A.ctx.baseLatency : 0);
    return Math.max(0, Math.min(0.5, l));
  };

  A.stop = function (fade) {
    const ch = A.chain; A.chain = null;
    if (ch) {                                                    // seamless-loop chain (NO TIME LIMIT): stop every scheduled segment
      clearInterval(ch.timer);
      let at = 0;
      try {
        if (fade && A.ctx) { const g = A.ctx.createGain(); g.gain.value = 1; ch.bus.disconnect(); ch.bus.connect(g); g.connect(A.musicGain || A.gain); g.gain.setTargetAtTime(0, A.ctx.currentTime, fade / 4); at = A.ctx.currentTime + fade; }
        else ch.bus.disconnect();
      } catch (e) {}
      for (const sg of ch.segs) { try { sg.stop(at); } catch (e) {} }
    }
    if (A.src) {
      try {
        if (fade && A.ctx) {
          const g = A.ctx.createGain(); g.gain.value = 1;
          A.src.disconnect(); A.src.connect(g); g.connect(A.musicGain || A.gain);
          g.gain.setTargetAtTime(0, A.ctx.currentTime, fade / 4);
          const s = A.src; setTimeout(() => { try { s.stop(); } catch (e) {} }, fade * 1000);
        } else A.src.stop();
      } catch (e) {}
      A.src = null;
    }
    if (A.html) { try { A.html.pause(); } catch (e) {} }
    A.playing = false; A.loop = null; A.chainHtml = null;
  };

  /** play the track from `offset` track-seconds. opts: {loopStart, loopEnd, fadeIn, startDelay (wall s), rate}
   *  rate < 1 = slowed down like a tape: pitch drops with tempo (no time-stretching, by design). */
  A.play = function (offset, opts) {
    opts = opts || {};
    A.stop(0);
    A.paused = false; A.rate = opts.rate || 1; A.htmlWraps = 0;
    if (A.mode === 'webaudio' && A.buffer && A.ctx && opts.loopStart != null && opts.xfade) {
      // SEAMLESS LOOP (NO TIME LIMIT): consecutive buffer sources, each scheduled sample-accurately at the previous one's end. Each segment plays
      // `xfade` seconds past the loop end while the next one fades in from the loop start over the same `xfade` window (equal-power crossfade), so the
      // jump from the end of the section to its start is smoothed over ~6 ms: no click. The beat clock is derived from the audio clock
      // (see songTime), so it wraps at exactly the same moment.
      if (A.ctx.state === 'suspended') A.ctx.resume();
      const ls = opts.loopStart, le = opts.loopEnd, X = opts.xfade, rate = A.rate;
      const bus = A.ctx.createGain(); bus.connect(A.musicGain || A.gain);
      const t0 = A.ctx.currentTime + (opts.startDelay || 0.05);
      const ch = A.chain = { ls, le, X, rate, bus, segs: [], nextWhen: t0, nextOff: offset, first: true, timer: 0, fadeIn: opts.fadeIn || 0 };
      const schedule = function (c) {
        const when = c.nextWhen, off = c.nextOff, dur = (le - off) / rate, src = A.ctx.createBufferSource(), env = A.ctx.createGain();
        src.buffer = A.buffer; src.playbackRate.value = rate; src.connect(env); env.connect(bus);
        const fin = c.first ? c.fadeIn : X;                                  // fade-in: first segment optional, the others crossfade
        if (fin) { env.gain.setValueAtTime(0, when); env.gain.linearRampToValueAtTime(1, when + fin); } else env.gain.setValueAtTime(1, when);
        env.gain.setValueAtTime(1, when + dur); env.gain.linearRampToValueAtTime(0, when + dur + X);   // tail fades out while the next segment fades in
        src.start(when, off); src.stop(when + dur + X + 0.02);
        c.segs.push(src); if (c.segs.length > 12) c.segs.shift();
        c.nextWhen = when + dur; c.nextOff = ls; c.first = false;
      };
      for (let i = 0; i < 4; i++) schedule(ch);
      ch.timer = setInterval(() => { if (A.chain !== ch || !A.ctx) return; while (ch.nextWhen < A.ctx.currentTime + 3 * (le - ls) / rate) schedule(ch); }, 1000);
      A.loop = [ls, le]; A.startCtx = t0; A.startOff = offset; A.playing = true; A.src = null;
      A.anchor = { c: A.ctx.currentTime, p: performance.now() };
      return true;
    }
    if (A.mode === 'webaudio' && A.buffer && A.ctx) {
      if (A.ctx.state === 'suspended') A.ctx.resume();
      const src = A.ctx.createBufferSource(); src.buffer = A.buffer; src.playbackRate.value = A.rate;
      const env = A.ctx.createGain(); src.connect(env); env.connect(A.musicGain || A.gain);
      const now = A.ctx.currentTime, when = now + (opts.startDelay || 0.05);
      if (opts.loopStart != null) { src.loop = true; src.loopStart = opts.loopStart; src.loopEnd = opts.loopEnd; A.loop = [opts.loopStart, opts.loopEnd]; }
      if (opts.fadeIn) { env.gain.setValueAtTime(0, when); env.gain.linearRampToValueAtTime(1, when + opts.fadeIn); }
      src.start(when, offset);
      A.src = src; A.startCtx = when; A.startOff = offset; A.playing = true;
      A.anchor = { c: A.ctx.currentTime, p: performance.now() };
      return true;
    }
    if (A.mode === 'html' && A.html) {
      A.html.currentTime = offset; A.html.loop = false;
      A.html.preservesPitch = false; A.html.mozPreservesPitch = false; A.html.webkitPreservesPitch = false; A.html.playbackRate = A.rate;
      const p = A.html.play(); if (p && p.catch) p.catch(() => {});
      A.playing = true; A.startOff = offset; A.loop = opts.loopStart != null ? [opts.loopStart, opts.loopEnd] : null; A.chainHtml = opts.xfade && opts.loopStart != null ? [opts.loopStart, opts.loopEnd] : null;
      return true;
    }
    return false;
  };

  A.pause = function () {
    if (!A.playing || A.paused) return;
    A.paused = true;
    if (A.mode === 'webaudio' && A.ctx) A.ctx.suspend();
    else if (A.html) A.html.pause();
  };
  A.resume = function () {
    if (!A.paused) return;
    A.paused = false;
    if (A.mode === 'webaudio' && A.ctx) { A.ctx.resume(); A.anchor = { c: A.ctx.currentTime, p: performance.now() }; }
    else if (A.html) { const p = A.html.play(); if (p && p.catch) p.catch(() => {}); }
  };

  /** raw ctx time with sub-quantum interpolation */
  A.ctxNow = function () {
    const c = A.ctx.currentTime, p = performance.now();
    if (c !== A.anchor.c) { A.anchor = { c: c, p: p }; return c; }
    if (A.ctx.state !== 'running' || A.paused) return c;
    return c + Math.min(0.03, (p - A.anchor.p) / 1000);
  };

  /** seconds of the track currently being heard (for the beat clock) */
  A.songTime = function (unwrapped) {
    if (!A.playing) return null;
    if (A.mode === 'webaudio' && A.ctx) {
      let t = (A.ctxNow() - A.startCtx - A.outLatency()) * A.rate;      // wall seconds since start -> track seconds
      if (A.loop && !unwrapped) { const len = A.loop[1] - A.loop[0]; let x = A.startOff + t; if (x >= A.loop[1]) x = A.loop[0] + ((x - A.loop[0]) % len); return x; }
      return A.startOff + t;                                            // unwrapped: monotonic, keeps counting past the loop point (the rules clock)
    }
    if (A.mode === 'html' && A.html) {
      let c = A.html.currentTime;
      if (A.chainHtml && !A.paused && c >= A.chainHtml[1]) { A.html.currentTime = c = A.chainHtml[0] + (c - A.chainHtml[1]); A.htmlWraps++; }   // fallback loop: a seek (may click)
      return unwrapped && A.chainHtml ? c + A.htmlWraps * (A.chainHtml[1] - A.chainHtml[0]) : c;
    }
    return null;
  };

  /** convert an input event's timeStamp to heard track time: heardNow minus how long ago the event happened */
  A.songTimeAtEvent = function (evTimeStamp, unwrapped) {
    const st = A.songTime(unwrapped);
    if (st == null) return null;
    const ago = Math.max(0, Math.min(0.25, (performance.now() - (evTimeStamp || performance.now())) / 1000));
    return st - ago * A.rate;
  };

  /** metronome click at ctx time `when` (used by the latency calibrator) */
  A.click = function (when, accent) {
    if (!A.ctx) return;
    const o = A.ctx.createOscillator(), g = A.ctx.createGain();
    o.type = 'square'; o.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(0.5, when + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    o.connect(g); g.connect(A.gain); o.start(when); o.stop(when + 0.06);
  };
  /** hit/miss blips so the player hears the judgment (kept tiny and quiet) */
  A.blip = function (kind) {
    if (!A.ctx || A.muted || !A.sfxOn) return;
    const when = A.ctx.currentTime + 0.001, o = A.ctx.createOscillator(), g = A.ctx.createGain();
    const f = { PERFECT: 1568, GOOD: 988, MISS: 130, FROZEN: 80, ZERO: 880 }[kind] || 440;
    o.type = kind === 'MISS' || kind === 'FROZEN' ? 'sawtooth' : 'triangle';
    o.frequency.setValueAtTime(f, when);
    if (kind === 'MISS' || kind === 'FROZEN') o.frequency.exponentialRampToValueAtTime(f * 0.5, when + 0.12);
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(kind === 'PERFECT' ? 0.12 : 0.09, when + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, when + (kind === 'ZERO' ? 0.35 : 0.1));
    o.connect(g); g.connect(A.sfxGain || A.gain); o.start(when); o.stop(when + 0.4);
  };
  /** energy-orb chime: a quick rising three-note arpeggio (synth, through the SFX gain) */
  A.chime = function () {
    if (!A.ctx || A.muted || !A.sfxOn || A.ctx.state !== 'running') return;
    const t0 = A.ctx.currentTime + 0.001;
    [880, 1318.5, 1760].forEach((f, i) => {
      const o = A.ctx.createOscillator(), g = A.ctx.createGain(), when = t0 + i * 0.07; o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(0.14, when + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.32);
      o.connect(g); g.connect(A.sfxGain || A.gain); o.start(when); o.stop(when + 0.36);
    });
  };
  /** the playbackRate AudioParam of the (first) music source: single source or the first segment of a loop chain */
  A.rateNode = function () { return A.src ? A.src.playbackRate : (A.chain && A.chain.segs[0] ? A.chain.segs[0].playbackRate : null); };
  /** laser SFX: short WebAudio synth zaps (no samples). Routed through the master gain, so mute/volume apply. */
  A.zap = function (kind) {
    if (!A.ctx || A.muted || !A.sfxOn || A.ctx.state !== 'running') return;
    const when = A.ctx.currentTime + 0.001, o = A.ctx.createOscillator(), g = A.ctx.createGain();
    const P = { fire: ['sawtooth', 1900, 240, 0.15, 0.10], hit: ['square', 500, 2600, 0.16, 0.11], near: ['triangle', 900, 1500, 0.10, 0.08], miss: ['sawtooth', 220, 70, 0.09, 0.04] }[kind] || ['sine', 440, 440, 0.1, 0.05];
    o.type = P[0]; o.frequency.setValueAtTime(P[1], when); o.frequency.exponentialRampToValueAtTime(P[2], when + P[3]);
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(P[4], when + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, when + P[3] + 0.04);
    o.connect(g); g.connect(A.sfxGain || A.gain); o.start(when); o.stop(when + P[3] + 0.08);
  };
  /** BEAT TICK: a quiet metronome click at TRACK time `tb` (seconds), scheduled on the audio clock so it is exact at any playbackRate.
   *  Plays through the master gain only (independent of the MUSIC/SFX toggles). */
  A.tick = function (tb, accent) {
    if (!A.ctx || A.muted || A.mode !== 'webaudio' || !A.playing || (A.loop && !A.chain) || A.ctx.state !== 'running') return false;
    const when = A.startCtx + (tb - A.startOff) / A.rate;                    // heard time = ctx time + output latency, like the song itself
    if (when < A.ctx.currentTime) return false;
    const o = A.ctx.createOscillator(), g = A.ctx.createGain(); o.type = 'square'; o.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(accent ? 0.16 : 0.1, when + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    o.connect(g); g.connect(A.gain); o.start(when); o.stop(when + 0.06); return true;
  };
  A.ctxTime = function () { return A.ctx ? A.ctxNow() : 0; };
  A.duration = function () { return A.buffer ? A.buffer.duration : (A.html && A.html.duration) || 0; };

  root.GameAudio = A;
})(window);
