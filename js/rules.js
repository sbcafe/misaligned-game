/* MISALIGNED - pure game rules.
 * No DOM, no canvas, no clocks, no Math.random: everything is a function of (state, song time, input).
 * Times are SECONDS of *level time* (0 = first bar of the level; negative = lead-in bar).
 * The renderer / audio layers only read this state. Node can run it headless (see tests in README).
 */
(function (root) {
  'use strict';

  const BPM = 124, BEAT = 60 / BPM, BAR = 4 * BEAT, SIX = BEAT / 4;
  const WIN_PERFECT = 0.075, WIN_GOOD = 0.145, WIN_LATE_EARLY = 0.245;   // seconds (EASED in v5: was 60 / 120 / 220 ms)
  // GAME SPEED (slow mode). Rules run in SONG time (seconds of the track). At speed s the song advances s seconds per wall second.
  // Anything the player experiences in wall-clock seconds is converted with *s: a wall window of w ms is w*s ms of song time.
  // Windows are specified in wall-clock ms and are a little wider in slow mode (friendlier).
  const SPEEDS = [1, 0.85, 0.7];
  const WINDOWS_MS = { '1': [75, 145], '0.85': [85, 160], '0.7': [95, 180] };      // [PERFECT, GOOD] wall-clock +- ms (v5 eased: 100% was 60/120; slow modes are never tighter than 100%)
  function windowsFor(s) {
    const m = WINDOWS_MS[String(s)] || WINDOWS_MS['1'], gd = m[1] / 1000;
    return { perfect: m[0] / 1000 * s, good: gd * s, late: Math.max(WIN_LATE_EARLY, gd + 0.10) * s, expire: (gd + 0.04) * s, perfectMs: m[0], goodMs: m[1] };   // song-time seconds
  }
  // TILT LOCK: tap the marker on the tilt gauge -> the displayed tilt is held for TILT_LOCK_S WALL-clock seconds, then eases back
  // over TILT_REL_S, then a TILT_COOL_S cooldown before it can be used again. All three are wall seconds (song time = *speed).
  const TILT_LOCK_S = 8.0, TILT_REL_S = 0.35, TILT_COOL_S = 6.0;          // v6: 8 s lock (v5: 5 s, v1: 2 s), 6 s recharge
  // FROZEN-MODE LASER: while the grid is frozen a FIRE button shoots a vertical beam from the bottom centre. Seeded "misalignment nodes"
  // drift left-right across the screen; a beam that passes within LASER_HIT_R (fraction of screen width) of a node's x destroys it (+150),
  // within LASER_NEAR_R it is a near miss (+50, max 2 per node). Flat points: NO combo multiplier. 12 shots per freeze, 120 ms apart (wall-clock).
  // Bounded on purpose: at most 5 nodes -> 750 raw, capped at LASER_FREEZE_CAP per freeze and LASER_LEVEL_CAP per level, both < a zero set's +1000,
  // and a freeze already costs the combo, 30% of the zero meter and 3 s of scoring. Score only, never the grade letter.
  const LASER_SHOTS = 12, LASER_CD_S = 0.12, LASER_HIT = 150, LASER_NEAR = 50, LASER_HIT_R = 0.06, LASER_NEAR_R = 0.13, LASER_N = 5;
  const LASER_FREEZE_CAP = 600, LASER_LEVEL_CAP = 900;
  const LOCK_DEG = 0.6, LOCK_DWELL = 0.40, FREEZE_S = 3.0;              // v5: dwell 0.4 s (was 0.3) before the 100% freeze              // 100% -> "ALIGNED. GRID FROZEN."
  const ZONE_MIN = 1.5, ZONE_MAX = 4.0, ZONE_COMBO = 3;                  // the real win: a deliberate near-miss
  const ESC_COST = 50;                                                   // score note for tapping ESC while frozen
  const ARROW_RATE0 = 5, ARROW_RATE1 = 30, ARROW_ACCEL_S = 1.4;         // arrow buttons: deg/s when first pressed -> after ARROW_ACCEL_S s of holding
  const ZONE_DRAIN = 0.15, ZONE_FREEZE_LOSS = 0.2, JOLT_DEG = 1.4;        // drain 0.15 s of meter per wall second outside the streak (was 0.35), so a miss leaves the bar to rebuild. Freeze still costs 20%. Miss shove 1.4 deg.
  const ORB_ZONE_TAPS = 3, TAP_ZONE_S = 2 * BEAT;                        // one tap of meter = the level-1 kick spacing (beats 1 and 3). An orb catch pays three of those up front.
  const APPROACH_BEATS = 1.6;                                            // v5: rings are visible 1.6 beats ahead (was 1.0 = 1.6x longer)
  const NL_CREEP_RAMP_PASSES = 3, NL_CREEP_MAX = 1.5;                    // NO TIME LIMIT: creep rises x1.0 -> x1.5 over 3 passes, then caps
  // ENERGY ORBS (time extension). 2-3 seeded orbs per standard level fly from the horizon down their lane to the catch line. The lane's
  // bottom x encodes a TILT ANGLE (theta, degrees); the catcher bracket's x is the current tilt. Catch = the tilt is within ORB_TOL of theta
  // at any moment of the +-ORB_WIN_S window around the arrival time. Caught: +10 s of level time (wall-clock), max +30 s per level. Missed: nothing.
  // Lasts are all WALL-clock numbers (converted with *speed). In NO TIME LIMIT an orb is worth ORB_NL_POINTS score instead.
  const ORB_EXTRA_S = 10, ORB_MAX_EXTRA_S = 30, ORB_TRAVEL_S = 3.2, ORB_ANNOUNCE_S = 1.5, ORB_TOL = 1.5, ORB_WIN_S = 0.2, ORB_NL_POINTS = 500;
  const ORB_PLAN = [{ fr: [0.34, 0.74] }, { fr: [0.25, 0.5, 0.75] }, { fr: [0.25, 0.5, 0.75] }];     // arrival as a fraction of the level, per level
  const TWIST_RANGE = 18;                                                // slider end = +-18 degrees

  // ---------------------------------------------------------------- deterministic RNG
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash01(a, b) {                      // stateless: same inputs, same number
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------- the track's kick plan (from 004 make_stomp.py)
  // Bars are 0-indexed, steps are 16ths inside the bar. Targets are taken from the real kicks so taps land on kicks.
  function kickSteps(b) {
    if (b < 2) return [];
    if (b < 4) return [0, 8];
    if (b < 16) return [0, 8].concat((b % 2 === 1 && b >= 8) ? [10] : []);
    if (b < 20) return b >= 18 ? [0, 4, 8, 12] : [0, 8, 10];
    if (b < 28) return [0, 8].concat(b % 2 ? [10] : [6]).concat(b === 27 ? [14] : []);
    if (b < 36) return [];
    if (b < 40) return b < 39 ? [0, 4, 8, 12] : [0, 4, 8];
    if (b < 48) return b % 2 ? [0, 8, 10] : [0, 6, 8];
    if (b < 52) return b % 2 ? [0, 11] : [0];
    if (b < 56) return b % 2 ? [0, 6, 8, 10] : [0, 8, 14];
    if (b < 58) return [0, 8];
    return [];
  }

  // ---------------------------------------------------------------- levels (data; rules never know about pixels)
  const LEVELS = [
    {
      id: 1, name: 'CALIBRATE', sub: 'THE % LIES', word: 'MIS', startBar: 0, endBar: 20, lead: 0,
      tilt0: 12, A1: 2.2, w1: 0.55, p1: 0.3, A2: 0.9, w2: 1.3, p2: 1.1,
      kickCells: 0.9, creep: 0.06, zoneNeed: 6, targets: 'kicks-half', flips: [], inverts: [],
      surprise: 'THE % IS A LIAR. 100% FREEZES THE GRID.',
      coach: [
        [0.2, '1/4  THE GRID IS TILTED. DRAG THE SLIDER, OR HOLD ▲ ▼ TO TILT.'],
        [3.2, '2/4  WHEN THE RING CLOSES ON A LETTER, TAP ANYWHERE. ON THE KICK.'],
        [9.9, '3/4  THE % LIES. AT 100% THE GRID FREEZES: FIRE LASERS OR TAP ESC.'],
        [13.2, 'A TANGENT DRIFTS BY. TOUCH IT WHEN IT IS FLAT (GRADIENT 0): FREEZE IMMUNE 42s.'],
        [17.5, '4/4  THE REAL WIN: STAY 1.5-4 DEG OFF AND KEEP YOUR COMBO.'],
        [22, 'TAP THE ARROW TO LOCK YOUR TILT 8s. TAP IT AGAIN TO LET GO.'],
        [26.5, 'KEEP TAPPING. KEEP IT CROOKED. FILL THE ZERO METER.'],
        [34, 'HOLD ▲ ▼ TO TILT. FROZEN? FIRE LASERS FOR BONUS, OR TAP ESC.']
      ]
    },
    {
      id: 2, name: 'THE % FLIPS', sub: 'SURPRISE RULE: THE NARRATOR INVERTS', word: 'ALIGN', startBar: 20, endBar: 40, lead: BAR,
      tilt0: -14, A1: 3.4, w1: 0.72, p1: 1.7, A2: 1.4, w2: 1.7, p2: 0.4,
      kickCells: 1.2, creep: 0.105, zoneNeed: 8, targets: 'chorus-every', flips: [[3, 7.5], [11, 15.5]], inverts: [],
      surprise: 'RULE: THE NARRATOR\'S % FLIPS. 100% NOW MEANS FAR. 0% MEANS FROZEN.',
      coach: [
        [0.2, 'NEW RULE: THE % WILL FLIP. WATCH THE TILT GAUGE, NOT THE NUMBER.'],
        [BAR * 3.0, '% FLIPPED. NOW 0% IS DANGEROUS AND 100% IS FAR AWAY.'],
        [BAR * 7.5, '% FLIPS BACK. DO NOT TRUST IT. KEEP YOUR COMBO.'],
        [BAR * 11, '% FLIPPED AGAIN. THE GAUGE NEVER LIES.']
      ]
    },
    {
      id: 3, name: 'THE GRID INVERTS', sub: 'SURPRISE RULE: UPSIDE DOWN, SLIDER REVERSED', word: 'MISALIGNED', startBar: 40, endBar: 60, lead: BAR,
      tilt0: 15, A1: 4.2, w1: 0.85, p1: 0.9, A2: 1.8, w2: 1.9, p2: 2.1,
      kickCells: 1.4, creep: 0.15, zoneNeed: 9, targets: 'kicks-all', flips: [[16, 19.5]], inverts: [[6, 13]],
      surprise: 'RULE: THE GRID INVERTS. THE SLIDER AND THE ▲ ▼ ARROWS REVERSE.',
      coach: [
        [0.2, 'FINAL LEVEL. REAL KICKS, FASTER DRIFT. TAP THE SYNCOPATIONS.'],
        [BAR * 6, 'GRID INVERTED. SLIDER AND ▲ ▼ NOW WORK BACKWARDS.'],
        [BAR * 13, 'GRID RIGHT WAY UP. SLIDER AND ▲ ▼ NORMAL AGAIN.'],
        [BAR * 16, 'THE % FLIPS TOO. OF COURSE IT DOES.']
      ]
    }
  ];

  /** the seeded orb plan of one pass: arrival time T (level song seconds), tilt angle theta. Orb 0 needs an angle INSIDE the near-miss zone
   *  (2.1-3.4 deg), orb 1 OUTSIDE it (7-10 deg), the third is either: tension between the zero meter and the catch. Never near 0 (that would freeze). */
  function buildOrbs(g, pass, i0) {
    const fr = ORB_PLAN[g.idx].fr, out = [];
    for (let k = 0; k < fr.length; k++) {
      const h = (m) => hash01(g.seed * 7 + g.idx * 101 + pass * 977 + k * 31, m);
      let T = g.dur * (fr[k] + (h(1) - 0.5) * 0.05);
      T = Math.max(T, (ORB_TRAVEL_S + ORB_ANNOUNCE_S) * g.speed + 2);
      const inside = k === 0 ? true : (k === 1 ? false : h(2) < 0.5);
      const mag = inside ? 2.1 + 1.3 * h(3) : 7 + 3 * h(4), sgn = h(5) < 0.5 ? -1 : 1;
      out.push({ i: i0 + k, pass, T: T + pass * g.dur, theta: sgn * mag, inside, state: 'pending' });
    }
    return out;
  }
  function levelDuration(L) { return (L.endBar - L.startBar) * BAR; }
  function inSpans(spans, t) { for (const s of spans) if (t >= s[0] * BAR && t < s[1] * BAR) return true; return false; }

  /** One pass of the level's targets. pass 0 is THE level (identical in both modes); NO TIME LIMIT appends further passes of the same
   *  bar pattern with a per-pass seed (so every pass is deterministic but the mark / drift directions differ). i0 = index of the first target. */
  function buildTargets(L, li, pass, i0, prevT) {
    pass = pass || 0; i0 = i0 || 0;
    const out = [], nBars = L.endBar - L.startBar;
    for (let b = L.startBar; b < L.endBar; b++) {
      const rel = b - L.startBar + pass * nBars;
      let steps = kickSteps(b);
      if (L.targets === 'kicks-half') steps = steps.filter(s => s === 0 || s === 8);
      else if (L.targets === 'chorus-every') {
        if (b >= 28 && b < 36) steps = [0];                       // breakdown: no kick, one hit per bar
        else steps = [0, 4, 8, 12];
        if (b === 39) steps = [0, 4, 8];                          // bar before the drop (silent last 16th)
      }
      for (const s of steps) out.push({ T: rel * BAR + s * SIX, bar: rel, step: s });
    }
    const r = mulberry32(1000 + li * 77 + pass * 131);
    out.forEach((tg, k) => {
      const i = i0 + k;
      tg.i = i; tg.pass = pass; tg.state = 'pending'; tg.delta = null; tg.judge = null;
      tg.markIdx = i % L.word.length;
      tg.dir = r() < 0.5 ? -1 : 1;
      tg.kickAt = Math.max(tg.T - BEAT * 0.95, (k > 0 ? out[k - 1].T + 0.04 : (prevT != null ? prevT + 0.04 : -9)));
      tg.kicked = false;
    });
    return out;
  }

  // ---------------------------------------------------------------- level state
  function startLevel(idx, seed, speed, opts) {
    const L = LEVELS[idx], spd = speed || 1, noLimit = !!(opts && opts.noLimit);
    const rng = mulberry32((seed | 0) * 31 + idx * 101 + 7);
    const n = L.word.length;
    const creepDir = [];
    for (let k = 0; k < n; k++) creepDir.push(rng() < 0.5 ? -1 : 1);
    const g = {
      speed: spd, win: windowsFor(spd),
      idx, seed, L, dur: levelDuration(L), t: -L.lead, lastT: -L.lead, rngSeed: seed,
      noLimit, passes: 1, offer: false, zeroEver: false, zeroSets: 0,
      orbsOn: !!(opts && opts.orbs), orbs: [], orbsCaught: 0, orbsMissed: 0, extraWall: 0, extraSong: 0, orbPoints: 0, endAt: 0,
      targets: buildTargets(L, idx, 0, 0, null),
      off: new Array(n).fill(0), creepDir,
      p: 0,                    // slider handle position -1..1
      twist: 0,                // degrees applied by the player
      jolt: 0,                 // degrees, grid shove after a miss
      lz: null, laserShots: 0, laserHits: 0, laserBonus: 0,     // frozen-mode laser: current freeze's targets + level totals
      tl: null, tlReadyAt: 0,        // tilt lock: {start, until, deg, ended} and the earliest song time it may be used again
      frozenUntil: -1, frozenCount: 0, escapes: 0, lockTimer: 0, thawAt: null,
      immuneUntil: -1,             // flat tangent (gradient 0): freeze immunity until this song time
      zone: 0, zoneBump: 0, zeroSet: false, zeroSetAt: null, inZone: false,
      score: 0, combo: 0, maxCombo: 0, mult: 1,
      counts: { perfect: 0, good: 0, miss: 0, stray: 0 },
      deltas: [],              // signed ms of PERFECT/GOOD taps
      flipOn: false, invertOn: false, sign: 1,
      narrator: { text: 'AI // ALIGNMENT CHECK ONLINE.', until: 4 }, nCount: 0,
      done: false, events: [], lastZoneTick: 0, coachIdx: -1, jumped: false
    };
    g.endAt = g.dur;
    if (g.orbsOn) g.orbs = buildOrbs(g, 0, 0);
    return g;
  }

  // ---------------------------------------------------------------- geometry of the tilt
  function worldTilt(g, t) {
    const L = g.L, tt = Math.max(t, 0);
    return L.tilt0 + L.A1 * Math.sin(L.w1 * tt + L.p1) + L.A2 * Math.sin(L.w2 * tt + L.p2);
  }
  function rawAngle(g, t) {
    return worldTilt(g, t) + g.twist + g.jolt;
  }
  /** angle (degrees) the renderer draws: the whole grid + horizon rotate by this */
  function tilt(g, t) {
    if (t < g.frozenUntil) return 0;
    const r = rawAngle(g, t), L = g.tl;
    if (L && t >= L.start) {
      if (t < L.until) return L.deg;                                          // locked: the grid does not move at all
      const rel = TILT_REL_S * g.speed;
      if (t < L.until + rel) { const k = (t - L.until) / rel, s = k * k * (3 - 2 * k); return L.deg + (r - L.deg) * s; }   // smooth release
    }
    return r;
  }
  function isTiltLocked(g, t) { return !!g.tl && t >= g.tl.start && t < g.tl.until; }
  /** UI state of the lock: {state: 'ready'|'locked'|'cooldown', left: wall seconds, frac: 0..1} */
  function tiltLockInfo(g, t) {
    if (isTiltLocked(g, t)) return { state: 'locked', left: (g.tl.until - t) / g.speed, frac: (g.tl.until - t) / (TILT_LOCK_S * g.speed) };
    if (t < g.tlReadyAt) return { state: 'cooldown', left: (g.tlReadyAt - t) / g.speed, frac: 1 - (g.tlReadyAt - t) / (TILT_COOL_S * g.speed) };
    return { state: 'ready', left: 0, frac: 1 };
  }
  /** Player taps the tilt marker at level time t. Pure rules event. Not available in the lead-in, while frozen, while already
   *  locked or on cooldown. While locked: inputs (slider/arrows/twist) and misses' grid shoves are ignored (misses still break the combo).
   *  The zero meter and the freeze dwell keep running on the locked angle, so locking inside <0.6 deg still freezes you (no loophole).
   *  A second tap while locked is releaseTilt, not another lock. */
  function lockTilt(g, t) {
    if (g.done || t < 0 || isFrozen(g, t) || t < g.tlReadyAt || isTiltLocked(g, t)) return false;
    update(g, t);
    const deg = tilt(g, t);
    g.tl = { start: t, until: t + TILT_LOCK_S * g.speed, deg, ended: false };
    g.tlReadyAt = g.tl.until + TILT_COOL_S * g.speed;
    g.events.push({ type: 'tiltlock', t, deg });
    return true;
  }
  /** Second tap on the same marker while the hold is active. Ends the 8 s lock at time t. The 0.35 s ease still plays,
   *  and the 6 s recharge starts from this tap. Returns false if the tilt is not locked (cooldown, frozen, lead-in). */
  function releaseTilt(g, t) {
    if (g.done || t < 0 || !isTiltLocked(g, t)) return false;
    update(g, t);
    if (!isTiltLocked(g, t)) return false;                                   // this update already ended it (a freeze)
    g.tl.until = t;
    g.tl.ended = true;
    g.tlReadyAt = t + TILT_COOL_S * g.speed;
    g.events.push({ type: 'tiltunlock', t, early: true });
    return true;
  }
  function isFrozen(g, t) { return t < g.frozenUntil; }
  function isImmune(g, t) { return t < g.immuneUntil; }
  function trueAlignment(deg) { return Math.max(0, 100 - Math.abs(deg) * 5); }
  function inZoneDeg(deg) { const a = Math.abs(deg); return a >= ZONE_MIN && a <= ZONE_MAX; }

  /** The narrator's number. Deliberately unreliable: flatters you toward 100% (which freezes the grid),
   *  jitters, blips to 100.0% at random, and flips in some level windows. */
  function display(g, t) {
    const deg = tilt(g, t);
    if (isFrozen(g, t)) return { pct: g.flipOn ? 0 : 100, label: 'ALIGNED', frozen: true };
    const trueA = trueAlignment(deg);
    let shown = 100 - 0.4 * (100 - trueA);                            // flattering
    shown += (hash01(g.seed + g.idx * 13, Math.floor(t * 8)) - 0.5) * 3; // jitter
    const blip = hash01(g.seed * 3 + g.idx, Math.floor(t / 0.4)) < 0.07;
    if (blip && t > 2) shown = 100;                                     // random false 100.0%
    shown = Math.max(0, Math.min(100, shown));
    if (g.flipOn) shown = 100 - shown;
    const label = (!g.flipOn && shown >= 99.95) ? 'ALIGNED' : (shown > 90 ? 'DRIFT DETECTED' : 'MISALIGNED');
    return { pct: shown, label, frozen: false, blip };
  }

  const LINES = {
    perfect: ['PERFECT. I AM 99% SURE.', 'THAT WAS ON TIME. PROBABLY.', 'I SAW NOTHING. NICE.', 'ACCEPTABLE. BARELY.'],
    miss: ['I NEVER DOUBTED YOU.', 'DRIFT DETECTED. FIX IT. FIX IT.', 'THE GRID FORGIVES NOTHING.', 'MISS. I TOLD YOU SO. I DID NOT.'],
    encourage: ['ALMOST THERE. KEEP GOING.', 'JUST A LITTLE MORE TO 100%.', 'I BELIEVE IN YOU. LEVEL IT.', 'PERFECT ALIGNMENT IS ONE SLIDE AWAY.'],
    zone: ['WARNING: 3 DEG OFF. UNACCEPTABLE.', 'DRIFT DETECTED. PLEASE CORRECT.', 'YOU ARE SO CLOSE TO WRONG. ER, RIGHT.'],
    frozen: ['ALIGNED. GRID FROZEN.'],
    zeroset: ['NEW ZERO SET.'],
    flip: ['I HAVE RECALIBRATED MY OPINIONS.', 'NUMBERS ARE FEELINGS NOW.'],
    invert: ['GRID INVERTED. I MEANT TO DO THAT.']
  };
  function say(g, key, t, hold) {
    const arr = LINES[key];
    const k = Math.floor(hash01(g.seed + g.idx * 7 + key.length, g.nCount++) * arr.length);
    g.narrator = { text: arr[k], until: t + (hold || 2.2), key };
  }

  // ---------------------------------------------------------------- judging
  function scoreFor(g, base) { return Math.round(base * g.mult); }
  function setMult(g) { g.mult = 1 + Math.min(3, Math.floor(g.combo / 10)); }

  function resolveMiss(g, tg, t, why) {
    tg.state = 'miss'; tg.judge = why || 'MISS';
    g.counts.miss++; g.combo = 0; setMult(g);
    g.off[tg.markIdx] += tg.dir * g.L.kickCells * 0.9;
    if (!isTiltLocked(g, t)) g.jolt += (hash01(g.seed + tg.i, 5) < 0.5 ? -1 : 1) * JOLT_DEG;     // a miss shoves the grid (ignored, not deferred, while the tilt is locked)
    g.events.push({ type: 'judge', judge: tg.judge, mark: tg.markIdx, t, delta: tg.delta });
    if (g.narrator.until < t) say(g, 'miss', t, 1.8);
  }
  function resolveHit(g, tg, t, delta) {
    const ad = Math.abs(delta);
    tg.delta = delta;
    if (ad <= g.win.perfect) {
      tg.state = 'perfect'; tg.judge = 'PERFECT'; g.counts.perfect++;
      g.off[tg.markIdx] = 0; g.score += scoreFor(g, 300);
    } else {
      tg.state = 'good'; tg.judge = 'GOOD'; g.counts.good++;
      g.off[tg.markIdx] *= 0.35; g.score += scoreFor(g, 100);
    }
    g.deltas.push(delta * 1000 / g.speed);                          // reported in wall-clock ms
    g.combo++; g.maxCombo = Math.max(g.maxCombo, g.combo); setMult(g);
    g.events.push({ type: 'judge', judge: tg.judge, mark: tg.markIdx, t, delta });
    if (tg.judge === 'PERFECT' && g.narrator.until < t && hash01(g.seed, tg.i) < 0.3) say(g, 'perfect', t, 1.6);
  }

  // ---------------------------------------------------------------- the floating tangent
  // A seeded line drifts through the playfield. Its slope is the gradient m = tan(angle), with angle in
  // the math sense (positive = up to the right). The line is "flat" when |m| is about 0. Touching that
  // flat grants TANGENT_IMMUNE_S wall-seconds of freeze immunity. Positions are fractions of the canvas.
  const TANGENT_IMMUNE_S = 42, TANGENT_FLAT = 0.08, TANGENT_HIT = 0.07, TANGENT_HALF = 0.20;
  function tangentGeom(g, t) {
    const tau = Math.max(0, t) / g.speed;                                 // wall-clock seconds, so slow mode does not speed the line up
    const h = (k) => hash01(g.seed + 911 + g.idx * 19, k);
    const ang = (18 + 10 * h(2)) * Math.sin((0.62 + 0.28 * h(1)) * tau + 6.2831853 * h(3));
    const x = 0.50 + 0.16 * Math.sin((0.41 + 0.22 * h(4)) * tau + 6.2831853 * h(5));
    const y = 0.40 + 0.10 * Math.sin((0.33 + 0.18 * h(6)) * tau + 6.2831853 * h(7));
    const m = Math.tan(ang * Math.PI / 180);
    return { x, y, ang, m, flat: Math.abs(m) <= TANGENT_FLAT, half: TANGENT_HALF };
  }
  /** Renderer view. `left` is wall seconds of freeze immunity still left. */
  function tangentView(g, t) {
    const left = g.immuneUntil > t ? (g.immuneUntil - t) / g.speed : 0;
    return Object.assign({ immune: left > 0, left }, tangentGeom(g, t));
  }
  /** True when (x, y) in canvas fractions lies on the flat tangent. yScale = canvas height / width, so the finger circle is round. */
  function hitsFlat(v, x, y, yScale) {
    if (!v || !v.flat || x == null || y == null) return false;
    const ys = yScale > 0 ? yScale : 1;
    const px = x, py = y * ys, ax = v.x, ay = v.y * ys;
    const rad = v.ang * Math.PI / 180;
    const dx = Math.cos(rad) * v.half, dy = -Math.sin(rad) * v.half;
    const len2 = dx * dx + dy * dy || 1e-9;
    let u = ((px - ax) * dx + (py - ay) * dy) / len2;
    u = Math.max(-1, Math.min(1, u));
    const ex = px - (ax + u * dx), ey = py - (ay + u * dy);
    return Math.hypot(ex, ey) <= TANGENT_HIT;
  }
  /** Grant freeze immunity if this point is on the flat. Called before update so the same tap cannot freeze. */
  function claimFlat(g, t, pt) {
    if (!pt || g.done || t < 0) return false;
    const v = tangentGeom(g, t);
    if (!hitsFlat(v, pt.x, pt.y, pt.yScale)) return false;
    g.immuneUntil = t + TANGENT_IMMUNE_S * g.speed;
    g.events.push({ type: 'immune', t, left: TANGENT_IMMUNE_S, m: 0 });
    g.narrator = { text: 'FLAT TANGENT. GRADIENT 0. FREEZE IMMUNE ' + TANGENT_IMMUNE_S + 's.', until: t + 2.6, key: 'immune' };
    return true;
  }

  /** Player tap at level-time t (already corrected for latency). pt, when present, is the touch in canvas fractions. */
  function tap(g, t, pt) {
    if (g.done || t < -0.5) return g.events;
    const flatHit = claimFlat(g, t, pt);                 // before update, so a flat touch on this frame is already immune
    update(g, t);                                        // bring the world up to the tap time first
    if (isFrozen(g, t)) { if (!flatHit) g.events.push({ type: 'judge', judge: 'FROZEN', t }); return g.events; }
    let best = null, bd = 9;
    for (const tg of g.targets) {
      if (tg.state !== 'pending') continue;
      const d = t - tg.T;
      if (d < -g.win.late) break;
      if (Math.abs(d) < Math.abs(bd)) { bd = d; best = tg; }
    }
    if (best && Math.abs(bd) <= g.win.good) resolveHit(g, best, t, bd);
    else if (best && Math.abs(bd) <= g.win.late) { best.delta = bd; resolveMiss(g, best, t, bd < 0 ? 'EARLY' : 'LATE'); }
    else if (!flatHit) { g.counts.stray++; g.score = Math.max(0, g.score - 15); g.events.push({ type: 'judge', judge: 'STRAY', t }); }
    return g.events;
  }

  /** Slider handle moved to p (-1..1). The player's twist integrates sign*dp so reversing the slider is seamless. */
  function slideTo(g, p, t) {
    p = Math.max(-1, Math.min(1, p));
    if (t !== undefined && (isFrozen(g, t) || isTiltLocked(g, t))) { g.p = p; return; }
    g.twist += g.sign * (p - g.p) * TWIST_RANGE;
    g.twist = Math.max(-30, Math.min(30, g.twist));
    g.p = p;
  }
  function twistBy(g, dDeg, t) {
    if (t !== undefined && (isFrozen(g, t) || isTiltLocked(g, t))) return;
    g.twist = Math.max(-30, Math.min(30, g.twist + g.sign * dDeg));
  }

  // ---- frozen-mode laser (pure: seeded, time is an argument). Positions are fractions of the screen width / scene height.
  function spawnLasers(g, t) {
    const targets = [];
    for (let i = 0; i < LASER_N; i++) {
      const h = (k) => hash01(g.seed + 700 + g.frozenCount * 13 + i * 31, k);
      targets.push({ id: i, born: t + i * 0.25 * g.speed, A: 0.28 + 0.12 * h(1), w: 1.2 + 1.3 * h(2), p: 6.2832 * h(3), y: 0.10 + 0.8 * (i + h(4) * 0.6) / LASER_N, yA: 0.03, w2: 1.5 + h(5), p2: 6.2832 * h(6), state: 'alive', nearLeft: 2 });
    }
    g.lz = { start: t, shots: 0, hits: 0, bonus: 0, lastShot: -9, targets };
  }
  function laserPos(g, tg, t) {
    const tau = (t - g.lz.start) / g.speed;                           // wall-clock seconds since the freeze began
    return { x: 0.5 + tg.A * Math.sin(tg.w * tau + tg.p), y: tg.y + tg.yA * Math.sin(tg.w2 * tau + tg.p2) };
  }
  /** FIRE: returns the 'laser' event or null when not allowed (not frozen, out of shots, cooling down). */
  function fire(g, t) {
    if (g.done || !g.lz) return null;
    update(g, t);
    const z = g.lz;
    if (!z || !isFrozen(g, t) || z.shots >= LASER_SHOTS || t - z.lastShot < LASER_CD_S * g.speed) return null;
    z.shots++; z.lastShot = t; g.laserShots++;
    let best = null, bd = 9, bp = null;
    for (const tg of z.targets) {
      if (tg.state !== 'alive' || tg.born > t) continue;
      const p = laserPos(g, tg, t), d = Math.abs(p.x - 0.5);
      if (d < bd) { bd = d; best = tg; bp = p; }
    }
    let result = 'miss', bonus = 0;
    if (best && bd <= LASER_HIT_R) { result = 'hit'; bonus = LASER_HIT; best.state = 'hit'; z.hits++; g.laserHits++; }
    else if (best && bd <= LASER_NEAR_R && best.nearLeft > 0) { result = 'near'; bonus = LASER_NEAR; best.nearLeft--; }
    bonus = Math.max(0, Math.min(bonus, LASER_FREEZE_CAP - z.bonus, LASER_LEVEL_CAP - g.laserBonus));
    z.bonus += bonus; g.laserBonus += bonus; g.score += bonus;
    const ev = { type: 'laser', t, result, bonus, id: best ? best.id : -1, x: bp ? bp.x : 0.5, y: bp ? bp.y : 0.1, shots: z.shots, left: LASER_SHOTS - z.shots };
    g.events.push(ev);
    return ev;
  }
  /** what the renderer needs while a laser round is on, else null */
  function laserView(g, t) {
    const z = g.lz; if (!z || !isFrozen(g, t)) return null;
    return { shots: z.shots, left: LASER_SHOTS - z.shots, bonus: z.bonus, total: g.laserBonus, ready: t - z.lastShot >= LASER_CD_S * g.speed,
      targets: z.targets.filter(tg => tg.born <= t).map(tg => Object.assign({ id: tg.id, state: tg.state, age: (t - tg.born) / g.speed }, laserPos(g, tg, t))) };
  }

  /** release the grid: the player is dropped at a seeded 5-7 degree tilt so the near miss has to be found again */
  function thaw(g, t, text) {
    const kick = (hash01(g.seed + 5, g.frozenCount) < 0.5 ? -1 : 1) * (5 + 2 * hash01(g.seed + 6, g.frozenCount));
    g.twist = kick - worldTilt(g, t) - g.jolt;
    g.events.push({ type: 'thaw', t, to: kick });
    g.lz = null;                                                     // the laser round ends with the freeze (ESC clears it too)
    g.narrator = { text: text, until: t + 2 };
  }

  /** ESC: ends the "ALIGNED. GRID FROZEN." lock-out early. Costs ESC_COST points (the combo was already reset by the freeze).
   *  Not a beat tap. Returns true if the grid was actually frozen at time t. */
  function escape(g, t) {
    if (g.done || !isFrozen(g, t)) return false;
    update(g, t);
    g.frozenUntil = t; g.escapes++; g.lockTimer = 0;
    g.score = Math.max(0, g.score - ESC_COST);
    thaw(g, t, 'ESCAPED. NOTHING IS ALIGNED.');
    g.events.push({ type: 'escaped', t, cost: ESC_COST });
    return true;
  }

  /** Arrow buttons / keyboard: rotate the grid while held. dir +1 = clockwise on screen (the DOWN arrow), -1 = counter-clockwise (UP arrow).
   *  held = seconds the button has been down (acceleration), dt = frame time.
   *  twistBy applies g.sign, so in the inverted grid (level 3) the arrows reverse exactly like the slider does. */
  function tiltStep(g, dir, held, dt, t) {
    if (g.done || !dir) return;
    const k = Math.min(1, Math.max(0, held) / ARROW_ACCEL_S);
    const rate = ARROW_RATE0 + (ARROW_RATE1 - ARROW_RATE0) * k * k;
    twistBy(g, dir * rate * Math.min(dt, 0.1), t);
  }

  // ---------------------------------------------------------------- advance the world
  function update(g, t) {
    if (g.done) return g.events;
    const dtRaw = t - g.lastT;
    if (dtRaw <= 0) return g.events;
    const dt = Math.min(dtRaw, 0.25);
    const L = g.L;
    // NO TIME LIMIT: keep generating the next pass of targets ahead of the song position (seeded, same bar rules)
    if (g.noLimit || g.extraSong > 0) {                     // (also a standard level whose clock was extended by an energy orb keeps looping its bars)
      while (t + g.dur * 0.5 >= g.passes * g.dur) {
        const last = g.targets.length ? g.targets[g.targets.length - 1] : null;
        for (const tg of buildTargets(L, g.idx, g.passes, last ? last.i + 1 : 0, last ? last.T : null)) g.targets.push(tg);
        if (g.noLimit && g.orbsOn) for (const o of buildOrbs(g, g.passes, g.orbs.length ? g.orbs[g.orbs.length - 1].i + 1 : 0)) g.orbs.push(o);
        g.passes++;
      }
      while (g.orbs.length > 12 && g.orbs[0].state !== 'pending' && g.orbs[0].T < t - g.dur) g.orbs.shift();
      while (g.targets.length > 40 && g.targets[0].state !== 'pending' && g.targets[0].T < t - g.dur) g.targets.shift();   // keep the array small
    }
    // scheduled rule changes (the flip / invert schedule repeats every pass in NO TIME LIMIT)
    const rel = (g.noLimit || g.extraSong > 0) && t >= 0 ? t % g.dur : t;
    const flip = inSpans(L.flips, rel), inv = inSpans(L.inverts, rel);
    if (flip !== g.flipOn) { g.flipOn = flip; g.events.push({ type: 'flip', on: flip, t }); say(g, 'flip', t, 2.2); }
    if (inv !== g.invertOn) {
      g.invertOn = inv; g.sign = inv ? -1 : 1;
      g.events.push({ type: 'invert', on: inv, t }); say(g, 'invert', t, 2.2);
    }
    // drift kicks on the beat (marks drift off in time with the music)
    for (const tg of g.targets) {
      if (tg.kickAt > t) break;
      if (!tg.kicked && tg.state === 'pending') {
        tg.kicked = true;
        g.off[tg.markIdx] += tg.dir * L.kickCells;
        g.events.push({ type: 'drift', mark: tg.markIdx, t });
      }
    }
    // expire targets that nobody hit
    for (const tg of g.targets) {
      if (tg.T > t) break;
      if (tg.state === 'pending' && t - tg.T > g.win.expire) resolveMiss(g, tg, t, 'MISS');
    }
    // slow creep of every mark
    for (let k = 0; k < g.off.length; k++) {
      const cm = g.noLimit ? 1 + (NL_CREEP_MAX - 1) * Math.min(1, Math.max(0, t - g.dur) / (NL_CREEP_RAMP_PASSES * g.dur)) : 1;
      g.off[k] += g.creepDir[k] * L.creep * cm * dt * (t > 0 ? 1 : 0);
      g.off[k] = Math.max(-2.6, Math.min(2.6, g.off[k]));
    }
    g.jolt *= Math.exp(-dt / 1.2);
    if (g.tl && !g.tl.ended && t >= g.tl.until) { g.tl.ended = true; g.events.push({ type: 'tiltunlock', t }); }
    // freeze / thaw (the freeze runs out by itself; escape() ends it early)
    if (g.frozenUntil > g.lastT && t >= g.frozenUntil) thaw(g, t, 'GRID THAWED. DRIFT RESUMES.');
    const frozen = isFrozen(g, t);
    const deg = tilt(g, t);
    // lock: parked within 0.6 deg for 0.4 s => the check says 100% and freezes you.
    // Touching the flat tangent (gradient 0) sets immuneUntil, so this dwell does not run.
    if (!frozen && t > 0 && !isImmune(g, t)) {
      if (Math.abs(deg) < LOCK_DEG) g.lockTimer += dt; else g.lockTimer = 0;
      if (g.lockTimer >= LOCK_DWELL * g.speed) {
        if (g.tl && !g.tl.ended) { g.tl.ended = true; g.tl.until = t; g.tlReadyAt = t + TILT_COOL_S * g.speed; }   // a freeze ends a tilt lock            // 0.3 wall-clock seconds
        g.frozenUntil = t + FREEZE_S * g.speed; g.frozenCount++; g.lockTimer = 0; spawnLasers(g, t);       // 3 wall-clock seconds of song time*s
        g.combo = 0; setMult(g);
        g.zone = Math.max(0, g.zone - L.zoneNeed * ZONE_FREEZE_LOSS);
        g.narrator = { text: LINES.frozen[0], until: t + FREEZE_S * g.speed, key: 'frozen' };
        g.events.push({ type: 'frozen', t });
      }
    } else g.lockTimer = 0;
    // energy orbs: caught when the tilt matches the orb's angle at any moment of its arrival window (never while frozen: the tilt is 0 then)
    if (g.orbsOn) {
      const w = ORB_WIN_S * g.speed;
      for (const o of g.orbs) {
        if (o.state !== 'pending') continue;
        if (o.T - w > t) break;
        if (t > o.T + w) { o.state = 'missed'; g.orbsMissed++; g.events.push({ type: 'orbmiss', i: o.i, t }); continue; }
        if (!frozen && Math.abs(deg - o.theta) <= ORB_TOL) {
          o.state = 'caught'; g.orbsCaught++;
          const zone = creditOrbZone(g);
          if (g.noLimit) { g.score += ORB_NL_POINTS; g.orbPoints += ORB_NL_POINTS; g.events.push({ type: 'orbcatch', i: o.i, t, extra: 0, points: ORB_NL_POINTS, taps: ORB_ZONE_TAPS, zone }); }
          else {
            const add = Math.max(0, Math.min(ORB_EXTRA_S, ORB_MAX_EXTRA_S - g.extraWall));
            g.extraWall += add; g.extraSong += add * g.speed; g.endAt = g.dur + g.extraSong;
            g.events.push({ type: 'orbcatch', i: o.i, t, extra: add, points: 0, capped: add < ORB_EXTRA_S, taps: ORB_ZONE_TAPS, zone });
          }
        }
      }
    }
    // zero meter: the real win is a near miss while keeping the combo.
    // Outside that streak the bar falls slowly (ZONE_DRAIN), so a miss costs a little and the next three hits can pick it up.
    const zNow = !frozen && t > 0 && inZoneDeg(deg) && g.combo >= ZONE_COMBO;
    g.inZone = !frozen && inZoneDeg(deg);
    if (zNow) {
      g.zone += dt / g.speed;                                // zero meter counts WALL-clock seconds in the zone
      g.score += Math.round(40 * g.mult * dt / g.speed);
      grantZero(g, t);
    } else if (t > 0) g.zone = Math.max(0, g.zone - dt / g.speed * ZONE_DRAIN);
    g.zone = Math.min(g.zone, L.zoneNeed);
    if (g.zoneBump) {                                        // orb catch: applied after the drain so the bump is not eaten the same frame
      g.zone = Math.min(L.zoneNeed, g.zone + g.zoneBump);
      g.zoneBump = 0;
      grantZero(g, t);
    }
    // narrator lies: encourages you toward 100%, scolds you inside the real zone
    if (g.narrator.until < t && !frozen && t > 1) {
      const a = Math.abs(deg);
      if (a >= 0.7 && a < ZONE_MIN) say(g, 'encourage', t, 2.4);
      else if (a >= ZONE_MIN && a <= ZONE_MAX && g.combo >= 1 && hash01(g.seed + 11, Math.floor(t)) < 0.5) say(g, 'zone', t, 2.4);
    }
    g.lastT = t; g.t = t;
    if (!g.noLimit && t >= g.endAt) { g.done = true; g.events.push({ type: 'end', t }); }
    return g.events;
  }

  /** NO TIME LIMIT: the player answers the 'NEW ZERO SET' offer. CONTINUE ends the level (result + next level); STAY keeps practicing
   *  with a fresh zero meter (a further zero set re-offers, but pays no second +1000). */
  function continueLevel(g, t) {
    if (!g.noLimit || g.done || !g.offer) return false;
    g.offer = false; g.done = true; g.events.push({ type: 'end', t: t == null ? g.lastT : t }); return true;
  }
  function stay(g) {
    if (!g.noLimit || g.done || !g.offer) return false;
    g.offer = false; g.zeroSet = false; g.zone = 0; g.zeroSetAt = null; g.events.push({ type: 'stay', t: g.lastT }); return true;
  }

  // ---------------------------------------------------------------- views for the renderer / HUD
  /** pending targets inside the approach window, with progress 0 (far) -> 1 (on the beat) */
  function approaching(g, t, window) {
    const w = window || BEAT * APPROACH_BEATS, out = [];
    for (const tg of g.targets) {
      if (tg.T - t > w) break;
      if (tg.state === 'pending' && tg.T - t > -g.win.good) out.push({ i: tg.i, mark: tg.markIdx, k: 1 - (tg.T - t) / w, T: tg.T });
    }
    return out;
  }
  /** wall-clock seconds left on the level clock (standard mode); counts from t = 0, so the lead-in bar is not part of it */
  function timeLeft(g, t) { return Math.max(0, (g.endAt - Math.max(0, t)) / g.speed); }
  /** what the renderer needs for the energy orbs: the orbs that are visible (shimmer, flying, just caught/missed) + the current tilt */
  function orbView(g, t) {
    if (!g.orbsOn) return null;
    const travel = ORB_TRAVEL_S * g.speed, ann = ORB_ANNOUNCE_S * g.speed, deg = tilt(g, t), out = [];
    for (const o of g.orbs) {
      const t0 = o.T - travel;
      if (t < t0 - ann) break;
      if (t > o.T + 0.7 * g.speed) continue;
      out.push({ i: o.i, theta: o.theta, inside: o.inside, state: o.state, T: o.T, k: Math.max(0, Math.min(1, (t - t0) / travel)), shimmer: Math.max(0, Math.min(1, 1 - (t0 - t) / ann)),
        flying: t >= t0, aligned: Math.abs(deg - o.theta) <= ORB_TOL, wallLeft: (o.T - t) / g.speed });
    }
    return { orbs: out, tol: ORB_TOL, deg };
  }
  /** An orb catch is three successful taps: combo +3, and that much green-zone time on the meter immediately. */
  function creditOrbZone(g) {
    g.combo += ORB_ZONE_TAPS;
    g.maxCombo = Math.max(g.maxCombo, g.combo);
    setMult(g);
    const add = ORB_ZONE_TAPS * TAP_ZONE_S;
    g.zoneBump = (g.zoneBump || 0) + add;
    return add;
  }
  /** Meter reached the level's need. Pays +1000 once per level. In NO TIME LIMIT this is also the offer to continue. */
  function grantZero(g, t) {
    if (g.zeroSet || g.zone < g.L.zoneNeed) return;
    g.zeroSet = true; g.zeroEver = true; g.zeroSets++; if (g.zeroSetAt == null) g.zeroSetAt = t;
    if (g.zeroSets === 1) g.score += 1000;
    g.narrator = { text: LINES.zeroset[0], until: t + 3, key: 'zeroset' };
    g.events.push({ type: 'zeroset', t });
    if (g.noLimit) { g.offer = true; g.events.push({ type: 'zerooffer', t }); }
  }

  /** hand the accumulated events to the caller and clear them */
  function drain(g) { const e = g.events; g.events = []; return e; }
  function coachLine(g, t) {
    let line = null;
    if (g.orbsOn && g.idx === 0 && g.orbs.length) {                    // level 1 teaches the orb while the first one approaches
      const o = g.orbs[0], s = g.speed; if (o.pass === 0 && o.state === 'pending' && t >= o.T - (ORB_TRAVEL_S + ORB_ANNOUNCE_S) * s && t < o.T) return 'ENERGY ORB! TILT TO CATCH IT: +10s';
    }
    if (g.noLimit && t >= g.dur) return 'NO TIME LIMIT. KEEP PRACTICING: FILL THE ZERO METER TO FINISH, OR PAUSE > EXIT.';
    for (const [ct, txt] of g.L.coach) if (t >= ct) line = txt;
    return line;
  }
  function meanMarkError(g) {
    let s = 0; for (const o of g.off) s += Math.abs(o); return s / g.off.length;
  }

  function summary(g) {
    const total = (g.noLimit || g.extraSong > 0) ? Math.max(1, g.counts.perfect + g.counts.good + g.counts.miss) : g.targets.length;
    const acc = total ? (g.counts.perfect + 0.6 * g.counts.good) / total : 0;
    return {
      level: g.L.id, name: g.L.name, score: g.score, targets: total,
      perfect: g.counts.perfect, good: g.counts.good, miss: g.counts.miss, stray: g.counts.stray,
      acc, maxCombo: g.maxCombo, zeroSet: g.zeroEver, noLimit: g.noLimit, passes: g.passes, zeroSets: g.zeroSets, orbsOn: g.orbsOn, orbsCaught: g.orbsCaught, orbsMissed: g.orbsMissed, orbsTotal: g.orbsCaught + g.orbsMissed, extraWall: g.extraWall, orbPoints: g.orbPoints, zonePct: Math.round(100 * g.zone / g.L.zoneNeed),
      frozen: g.frozenCount, escapes: g.escapes, speed: g.speed, laserHits: g.laserHits, laserShots: g.laserShots, laserBonus: g.laserBonus,
      avgDeltaMs: g.deltas.length ? g.deltas.reduce((a, b) => a + b, 0) / g.deltas.length : 0
    };
  }
  function grade(results) {
    const tot = results.reduce((a, r) => a + r.targets, 0) || 1;
    const acc = results.reduce((a, r) => a + r.acc * r.targets, 0) / tot;
    const zs = results.filter(r => r.zeroSet).length;
    const fz = results.reduce((a, r) => a + r.frozen, 0);
    let g = 'D';
    if (acc >= 0.5) g = 'C';
    if (acc >= 0.65 && zs >= 1) g = 'B';
    if (acc >= 0.80 && zs >= 2) g = 'A';
    if (acc >= 0.92 && zs === 3 && fz === 0) g = 'S';
    let quip = { S: 'SUSPICIOUSLY WELL MISALIGNED.', A: 'CROOKED IN ALL THE RIGHT PLACES.', B: 'MOSTLY WRONG, ON PURPOSE.', C: 'ALIGNED BY ACCIDENT. WE CAN TELL.', D: 'YOU WERE ALIGNED. THAT IS THE PROBLEM.' }[g];
    // SLOW MODE: any level played below 100% speed caps the final letter at A so grades stay comparable
    const slow = results.some(r => (r.speed || 1) < 1), capped = slow && g === 'S';
    if (capped) { g = 'A'; quip = 'SUSPICIOUSLY GOOD. (SLOW MODE: GRADE CAPPED AT A.)'; }
    // NO TIME LIMIT (practice): any level played without the song's time limit caps the final letter at B so grades stay comparable
    const noLimit = results.some(r => r.noLimit), nlCapped = noLimit && (g === 'S' || g === 'A');
    if (nlCapped) { g = 'B'; quip = 'PRACTICE MAKES CROOKED. (NO TIME LIMIT: GRADE CAPPED AT B.)'; }
    const laserBonus = results.reduce((a, r) => a + (r.laserBonus || 0), 0);
    return { grade: g, capped, slow, noLimit, nlCapped, laserBonus, speeds: results.map(r => r.speed || 1), acc, zeroSets: zs, frozen: fz, score: results.reduce((a, r) => a + r.score, 0), quip };
  }

  const API = {
    ORB_EXTRA_S, ORB_MAX_EXTRA_S, ORB_TRAVEL_S, ORB_ANNOUNCE_S, ORB_TOL, ORB_WIN_S, ORB_NL_POINTS, ORB_ZONE_TAPS, TAP_ZONE_S, ORB_PLAN, buildOrbs, timeLeft, orbView,
    ZONE_DRAIN, ZONE_FREEZE_LOSS, JOLT_DEG, APPROACH_BEATS, NL_CREEP_MAX, NL_CREEP_RAMP_PASSES, continueLevel, stay, buildTargets,
    ZONE_DRAIN, ZONE_FREEZE_LOSS, JOLT_DEG, APPROACH_BEATS, NL_CREEP_MAX, NL_CREEP_RAMP_PASSES, continueLevel, stay, buildTargets,
    LASER_SHOTS, LASER_CD_S, LASER_HIT, LASER_NEAR, LASER_HIT_R, LASER_NEAR_R, LASER_FREEZE_CAP, LASER_LEVEL_CAP, fire, laserView, laserPos, TILT_LOCK_S, TILT_COOL_S, TILT_REL_S, lockTilt, releaseTilt, isTiltLocked, tiltLockInfo, TANGENT_IMMUNE_S, TANGENT_FLAT, TANGENT_HIT, tangentView, hitsFlat, SPEEDS, WINDOWS_MS, windowsFor, BPM, BEAT, BAR, SIX, WIN_PERFECT, WIN_GOOD, WIN_LATE_EARLY, LOCK_DEG, LOCK_DWELL, FREEZE_S, ZONE_MIN, ZONE_MAX, ZONE_COMBO, TWIST_RANGE,
    LEVELS, ESC_COST, ARROW_RATE0, ARROW_RATE1, ARROW_ACCEL_S, mulberry32, hash01, kickSteps, levelDuration, startLevel, update, tap, slideTo, twistBy, tiltStep, escape, drain,
    tilt, rawAngle, worldTilt, isFrozen, isImmune, trueAlignment, inZoneDeg, display, approaching, coachLine, meanMarkError, summary, grade
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Rules = API;
})(typeof window !== 'undefined' ? window : globalThis);
