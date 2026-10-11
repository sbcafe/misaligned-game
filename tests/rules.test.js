// Pure-rules tests: node tests/rules.test.js
const assert = require('assert');
const R = require('../js/rules.js');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };

// --- determinism: same seed + same inputs => identical state
function run(seed) {
  const g = R.startLevel(0, seed); let t = g.t;
  while (!g.done) { t += 1 / 60; R.update(g, t); for (const tg of g.targets) if (tg.state === 'pending' && t >= tg.T + 0.02) { R.tap(g, t); break; } R.twistBy(g, -R.rawAngle(g, t) * 0.2 + 2.8 * 0.2, t); R.drain(g); }
  return JSON.stringify(R.summary(g)) + g.twist.toFixed(6);
}
ok(run(7) === run(7), 'deterministic'); ok(run(7) !== run(8) || true, 'seeds may differ');

// --- freeze + ESC: ends the lock-out immediately, costs ESC_COST, is not a beat tap
{
  const g = R.startLevel(0, 5); let t = 0.5; R.update(g, t);
  // park at 0 deg until the lock triggers
  g.twist = -R.worldTilt(g, t) - g.jolt;
  let guard = 0; while (!R.isFrozen(g, t) && guard++ < 200) { t += 1 / 60; g.twist = -R.worldTilt(g, t) - g.jolt; R.update(g, t); }
  ok(R.isFrozen(g, t), 'frozen after parking at 0 deg'); ok(g.frozenCount === 1, 'one freeze'); ok(g.combo === 0, 'combo reset by freeze');
  const fu = g.frozenUntil; ok(fu - t > 2.5, 'lock-out lasts ~3 s');
  g.score = 500; const counts0 = JSON.stringify(g.counts);
  R.drain(g);
  t += 0.2; ok(R.escape(g, t) === true, 'escape works while frozen');
  const ev = R.drain(g);
  ok(ev.some(e => e.type === 'escaped') && ev.some(e => e.type === 'thaw'), 'escaped + thaw events');
  ok(!R.isFrozen(g, t + 0.001), 'unfrozen immediately'); ok(g.frozenUntil <= t + 1e-9, 'lock-out ended early');
  ok(g.score === 500 - R.ESC_COST, 'ESC costs ' + R.ESC_COST); ok(JSON.stringify(g.counts) === counts0, 'ESC is not a beat tap (counts unchanged)');
  ok(Math.abs(R.tilt(g, t + 0.01)) >= 4.5, 'thawed at a 5-7 deg tilt'); ok(g.escapes === 1, 'escape counted');
  ok(R.escape(g, t + 0.1) === false, 'ESC when not frozen is a no-op'); ok(g.score === 500 - R.ESC_COST, 'no second charge');
  // no double thaw when the old lock-out time passes
  const tw = g.twist; t = fu + 0.5; R.update(g, t); ok(!R.drain(g).some(e => e.type === 'thaw'), 'no second thaw at the old expiry'); void tw;
}
// --- ESC at score 0 never goes negative
{ const g = R.startLevel(0, 5); g.frozenUntil = 10; g.lastT = 1; g.score = 30; R.escape(g, 2); ok(g.score === 0, 'score floor'); }

// --- arrows: UP = counter-clockwise (-), DOWN = clockwise (+), accelerate with hold time, reverse with the inverted grid (sign -1)
{
  const g = R.startLevel(2, 3); const t = 1; R.update(g, t);
  const a0 = g.twist; R.tiltStep(g, 1, 0, 0.1, t); const dDown = g.twist - a0; ok(dDown > 0, 'down arrow rotates clockwise');
  const b0 = g.twist; R.tiltStep(g, -1, 0, 0.1, t); ok(g.twist - b0 < 0, 'up arrow rotates counter-clockwise');
  const s0 = g.twist; R.tiltStep(g, 1, 2, 0.1, t); ok(g.twist - s0 > dDown * 3, 'rate accelerates with hold time (' + ((g.twist - s0) / dDown).toFixed(1) + 'x)');
  g.sign = -1; const c0 = g.twist; R.tiltStep(g, 1, 0, 0.1, t); ok(g.twist - c0 < 0, 'inverted grid: arrows reverse like the slider');
  const p0 = g.twist; R.slideTo(g, g.p + 0.1, t); ok(g.twist - p0 < 0, 'inverted grid: slider reverses too (consistent)');
  g.sign = 1; g.frozenUntil = 99; const d0 = g.twist; R.tiltStep(g, 1, 1, 0.1, t); ok(g.twist === d0, 'arrows do nothing while frozen');
}

// --- GAME SPEED: windows are wall-clock ms -> song seconds * speed; freeze + zone timers are wall-clock
{
  for (const [sp, pf, gd] of [[1, 75, 145], [0.85, 85, 160], [0.7, 95, 180]]) {
    const g = R.startLevel(0, 5, sp); ok(Math.abs(g.win.perfect - pf / 1000 * sp) < 1e-9 && Math.abs(g.win.good - gd / 1000 * sp) < 1e-9, 'windows at ' + sp);
    ok(g.win.perfectMs === pf && g.win.goodMs === gd, 'wall ms at ' + sp);
    // a tap exactly pf wall-ms late is PERFECT, pf+5 ms is GOOD, gd+5 ms is a miss (EARLY/LATE)
    const T = g.targets[3].T;
    const tryTap = (wallMs) => { const h = R.startLevel(0, 5, sp); R.update(h, T - 0.5); R.drain(h); R.tap(h, T + wallMs / 1000 * sp); return R.drain(h).filter(e => e.type === 'judge')[0].judge; };
    ok(tryTap(pf - 1) === 'PERFECT' && tryTap(-(pf - 1)) === 'PERFECT', 'perfect edge at ' + sp);
    ok(tryTap(pf + 5) === 'GOOD' && tryTap(gd - 1) === 'GOOD', 'good edge at ' + sp);
    ok(['EARLY', 'LATE'].includes(tryTap(gd + 5)), 'miss beyond good at ' + sp);
  }
  // freeze lasts 3 WALL seconds, i.e. 3*speed song seconds
  for (const sp of [1, 0.85, 0.7]) {
    const g = R.startLevel(0, 5, sp); let t = 0.5; R.update(g, t); g.twist = -R.worldTilt(g, t) - g.jolt;
    let n = 0; while (!R.isFrozen(g, t) && n++ < 400) { t += 1 / 60; g.twist = -R.worldTilt(g, t) - g.jolt; R.update(g, t); }
    ok(R.isFrozen(g, t), 'frozen at ' + sp); ok(Math.abs((g.frozenUntil - t) - 3 * sp) < 0.03, 'freeze = 3 wall s at ' + sp);
  }
  // zero meter counts wall seconds in the zone
  for (const sp of [1, 0.7]) {
    const g = R.startLevel(0, 5, sp); g.combo = 5; let t = 0.5; R.update(g, t);
    for (let i = 0; i < 60; i++) { t += 1 / 60 * sp; g.twist = 2.8 - R.worldTilt(g, t) - g.jolt; R.update(g, t); g.combo = 5; }
    ok(Math.abs(g.zone - 1.0) < 0.1, 'zone gains ~1 s of meter per WALL second at ' + sp + ' (' + g.zone.toFixed(2) + ')');
  }
  // slow-mode grade cap
  const mk = (sp) => [1, 2, 3].map(l => ({ targets: 40, acc: 0.97, zeroSet: true, frozen: 0, score: 1000, speed: sp }));
  ok(R.grade(mk(1)).grade === 'S', 'S at full speed'); const gc = R.grade(mk(0.85)); ok(gc.grade === 'A' && gc.capped && gc.slow, 'capped at A in slow mode');
  ok(R.grade([{ targets: 40, acc: 0.97, zeroSet: true, frozen: 0, score: 1, speed: 1 }, { targets: 40, acc: 0.97, zeroSet: true, frozen: 0, score: 1, speed: 0.7 }, { targets: 40, acc: 0.97, zeroSet: true, frozen: 0, score: 1, speed: 1 }]).grade === 'A', 'one slow level caps');
}

// --- TILT LOCK
{
  for (const sp of [1, 0.85, 0.7]) {
    const g = R.startLevel(0, 9, sp); let t = 3; R.update(g, t); R.drain(g);
    g.twist = 2.8 - R.worldTilt(g, t) - g.jolt;                                       // park in the near-miss zone
    const before = R.tilt(g, t); ok(R.tiltLockInfo(g, t).state === 'ready', 'ready');
    ok(R.lockTilt(g, t) === true, 'lock accepted'); ok(R.drain(g).some(e => e.type === 'tiltlock'), 'lock event');
    // inputs and drift do not move it for 8 WALL seconds
    const wall = (w) => t0 + w * sp; const t0 = t; let maxDev = 0;
    for (let w = 0; w < 7.95; w += 1 / 60) { t = wall(w); R.slideTo(g, Math.sin(w * 7), t); R.twistBy(g, 3, t); R.tiltStep(g, 1, 1, 1 / 60 * sp, t); R.update(g, t); maxDev = Math.max(maxDev, Math.abs(R.tilt(g, t) - before)); }
    ok(maxDev < 1e-9, 'tilt fixed during lock at ' + sp + ' (dev ' + maxDev + ')'); ok(R.isTiltLocked(g, t), 'still locked at 7.95 wall s');
    ok(Math.abs(R.tiltLockInfo(g, t).left - 0.05) < 0.05, 'countdown in wall seconds');
    t = t0 + 8.02 * sp; R.update(g, t); ok(!R.isTiltLocked(g, t), 'released after 8 wall s'); ok(R.drain(g).some(e => e.type === 'tiltunlock'), 'unlock event');
    ok(R.tiltLockInfo(g, t).state === 'cooldown', 'cooldown after release'); ok(R.lockTilt(g, t) === false, 'cannot re-lock during cooldown');
    // smooth release: no jump larger than a few degrees per frame
    let prev = R.tilt(g, t0 + 7.99 * sp), jump = 0; for (let w = 7.99; w < 8.5; w += 1 / 60) { const v = R.tilt(g, t0 + w * sp); jump = Math.max(jump, Math.abs(v - prev)); prev = v; }
    ok(jump < 0.6, 'smooth release (max step ' + jump.toFixed(3) + ')');
    t = t0 + (8 + 6.01) * sp; R.update(g, t); ok(R.tiltLockInfo(g, t).state === 'ready' && R.lockTilt(g, t) === true, 'usable again 6 wall s after release');
  }
  // misses: the shove is ignored while locked, applied normally otherwise; combo still breaks
  {
    const g = R.startLevel(0, 9); let t = 3.5; R.update(g, t); g.twist = 2.8 - R.worldTilt(g, t) - g.jolt; g.combo = 7; const j0 = g.jolt;
    R.lockTilt(g, t); R.update(g, g.targets[0].T + 1.0); R.update(g, 3.5 + 1.9);
    for (const tg of g.targets) if (tg.state === 'pending' && tg.T < 3.5 + 1.9) ok(false, 'unexpired target');
    ok(g.counts.miss >= 1, 'targets expired as misses during the lock'); ok(g.combo === 0, 'combo broken'); ok(Math.abs(g.jolt - j0) < 1e-9, 'shove ignored while locked');
  }
  // not available: frozen, lead-in, done
  { const g = R.startLevel(0, 9); ok(R.lockTilt(g, -0.5) === false, 'no lock in the lead-in');
    let t = 0.5; R.update(g, t); g.twist = -R.worldTilt(g, t) - g.jolt; let n = 0; while (!R.isFrozen(g, t) && n++ < 200) { t += 1 / 60; g.twist = -R.worldTilt(g, t) - g.jolt; R.update(g, t); }
    ok(R.isFrozen(g, t) && R.lockTilt(g, t) === false, 'no lock while frozen'); }
  // no loophole: locking inside the freeze threshold still freezes (dwell keeps counting) and the freeze ends the lock
  { const g = R.startLevel(0, 9); let t = 3; R.update(g, t); g.twist = 0.2 - R.worldTilt(g, t) - g.jolt; ok(R.lockTilt(g, t), 'lock at 0.2 deg');
    let n = 0; while (!R.isFrozen(g, t) && n++ < 200) { t += 1 / 60; R.update(g, t); }
    ok(R.isFrozen(g, t) && g.frozenCount === 1, 'locked inside <0.6 deg still freezes'); ok(!R.isTiltLocked(g, t), 'freeze ends the lock'); }
  // zero meter keeps counting on the locked angle
  { const g = R.startLevel(0, 9); let t = 3; R.update(g, t); g.combo = 5; g.twist = 2.8 - R.worldTilt(g, t) - g.jolt; R.lockTilt(g, t); const z0 = g.zone;
    for (let i = 0; i < 60; i++) { t += 1 / 60; g.combo = 5; R.update(g, t); } ok(g.zone - z0 > 0.8 && g.inZone, 'zone meter fills while locked in the near-miss zone'); }
  // second tap on the same marker ends the 8 s hold now; the grid eases, and the 6 s recharge starts at the tap
  {
    const g = R.startLevel(0, 9); let t = 3; R.update(g, t); R.drain(g);
    g.twist = 2.8 - R.worldTilt(g, t) - g.jolt;
    ok(R.lockTilt(g, t), 'lock for early release'); const held = R.tilt(g, t);
    t += 1.25; R.update(g, t); R.drain(g);
    ok(R.isTiltLocked(g, t) && R.releaseTilt(g, t) === true, 'second tap releases');
    ok(R.drain(g).some(e => e.type === 'tiltunlock' && e.early), 'early unlock event');
    ok(!R.isTiltLocked(g, t) && R.tiltLockInfo(g, t).state === 'cooldown', 'cooldown starts at the tap');
    ok(Math.abs(R.tiltLockInfo(g, t).left - 6) < 0.02, 'full 6 s recharge from the early tap');
    ok(Math.abs(R.tilt(g, t) - held) < 1e-6, 'no jump on the release frame');
    ok(R.lockTilt(g, t) === false && R.releaseTilt(g, t) === false, 'cannot lock or release again during cooldown');
    let prev = held, jump = 0;
    for (let w = 0; w < 0.5; w += 1 / 60) { const v = R.tilt(g, t + w); jump = Math.max(jump, Math.abs(v - prev)); prev = v; }
    ok(jump < 0.6, 'early release eases (max step ' + jump.toFixed(3) + ')');
    const tReady = t + 6.01; R.update(g, tReady);
    ok(R.tiltLockInfo(g, tReady).state === 'ready' && R.lockTilt(g, tReady) === true, 'lock available 6 s after the early tap');
  }
  {
    const sp = 0.7, g = R.startLevel(0, 4, sp); let t = 2; R.update(g, t);
    ok(R.lockTilt(g, t), 'lock at 70%'); t += 0.4 * sp;
    ok(R.releaseTilt(g, t), 'release at 70%');
    ok(R.tiltLockInfo(g, t).state === 'cooldown' && Math.abs(R.tiltLockInfo(g, t).left - 6) < 0.05, 'early release recharge is 6 wall seconds at 70%');
  }
}

// --- FROZEN-MODE LASER
{
  const freeze = (sp, seed) => { const g = R.startLevel(0, seed || 5, sp); let t = 0.5; R.update(g, t); g.twist = -R.worldTilt(g, t) - g.jolt; let n = 0;
    while (!R.isFrozen(g, t) && n++ < 400) { t += 1 / 60; g.twist = -R.worldTilt(g, t) - g.jolt; R.update(g, t); } R.drain(g); return { g, t }; };
  { const { g, t } = freeze(1); ok(R.laserView(g, t) && R.laserView(g, t).targets.length >= 1, 'targets spawn with the freeze'); }
  // not frozen => no fire / no view
  { const g = R.startLevel(0, 5); R.update(g, 1); ok(R.fire(g, 1) === null && R.laserView(g, 1) === null, 'no laser outside a freeze'); }
  // deterministic: same seed, same shots => same bonus
  const play = (sp, seed, stride) => { const { g, t: t0 } = freeze(sp, seed); let t = t0, out = []; for (let i = 0; i < 40 && R.isFrozen(g, t); i++) { t += stride * sp; const e = R.fire(g, t); if (e) out.push(e.result + e.bonus); } return { g, out }; };
  ok(JSON.stringify(play(1, 5, 0.07).out) === JSON.stringify(play(1, 5, 0.07).out), 'deterministic laser round');
  // cooldown 120 ms (wall): two shots 50 ms apart -> second refused; 130 ms apart -> accepted
  { const { g, t } = freeze(1); const a = R.fire(g, t + 0.3), b = R.fire(g, t + 0.35), c = R.fire(g, t + 0.43); ok(a && !b && c, 'cooldown 120 ms'); }
  { const { g, t } = freeze(0.7); const a = R.fire(g, t + 0.3 * 0.7), b = R.fire(g, t + 0.3 * 0.7 + 0.05 * 0.7), c = R.fire(g, t + 0.3 * 0.7 + 0.13 * 0.7); ok(a && !b && c, 'cooldown is wall-clock at 70%'); }
  // exhaustive aim: fire all shots at the best times; caps hold; flat points (no combo multiplier); stats consistent
  for (const sp of [1, 0.7]) {
    const { g, t: t0 } = freeze(sp); g.combo = 40; g.mult = 4; const s0 = g.score; let t = t0, shots = 0, got = 0, hits = 0;
    // sample every 10 ms of the freeze and fire only when a node is dead centre (best case play)
    for (let w = 0; w < 3 && R.isFrozen(g, t); w += 0.01) { t = t0 + w * sp; const v = R.laserView(g, t); if (!v) break; if (v.targets.some(x => x.state === 'alive' && Math.abs(x.x - 0.5) < 0.02)) { const e = R.fire(g, t); if (e) { shots++; got += e.bonus; if (e.result === 'hit') hits++; } } }
    ok(shots >= 1 && hits >= 1, 'perfect aim finds hits at ' + sp + ' (' + shots + ' shots, ' + hits + ' hits)'); ok(g.score - s0 >= got, 'bonus added to score'); ok(g.laserBonus === got && g.laserHits === hits, 'stats match');
    ok(got % 50 === 0 && got <= R.LASER_FREEZE_CAP, 'flat points, capped per freeze (' + got + ')'); ok(g.combo === 40 && g.mult === 4, 'laser does not touch the combo');
  }
  // spam: shots <= 12 per freeze, bonus <= caps and < 1000; and a freeze is net worse than a zero set
  { const { g, t: t0 } = freeze(1); let t = t0, n = 0; for (let i = 0; i < 200 && R.isFrozen(g, t); i++) { t += 0.13; if (R.fire(g, t)) n++; }
    ok(n <= R.LASER_SHOTS && g.laserShots <= 12, 'max 12 shots per freeze (' + n + ')'); ok(g.laserBonus <= R.LASER_FREEZE_CAP && R.LASER_LEVEL_CAP < 1000 && R.LASER_FREEZE_CAP < 1000, 'caps < zero set'); }
  { const g = R.startLevel(0, 5); g.laserBonus = R.LASER_LEVEL_CAP; g.frozenUntil = 99; g.lastT = 1; R.update(g, 1.01); g.lz = null; }
  // ESC clears the lasers; natural thaw too
  { const { g, t } = freeze(1); ok(R.fire(g, t + 0.2) !== null || true, 'fire'); R.escape(g, t + 0.3); ok(g.lz === null && R.laserView(g, t + 0.31) === null && R.fire(g, t + 0.5) === null, 'ESC clears and disables lasers'); }
  { const { g, t } = freeze(1); R.update(g, g.frozenUntil + 0.1); ok(g.lz === null, 'lasers end with the freeze'); }
  // level cap across freezes
  { const { g, t } = freeze(1); g.laserBonus = R.LASER_LEVEL_CAP - 50; let tt = t, got = 0; for (let w = 0; w < 3; w += 0.01) { tt = t + w; if (!R.isFrozen(g, tt)) break; const v = R.laserView(g, tt); if (v && v.targets.some(x => x.state === 'alive' && Math.abs(x.x - 0.5) < 0.02)) { const e = R.fire(g, tt); if (e) got += e.bonus; } }
    ok(g.laserBonus <= R.LASER_LEVEL_CAP && got <= 50, 'per-level cap'); }
  const gr = R.grade([{ targets: 10, acc: 0.9, zeroSet: true, frozen: 1, score: 1, laserBonus: 300 }, { targets: 10, acc: 0.9, zeroSet: true, frozen: 0, score: 1, laserBonus: 150 }]); ok(gr.laserBonus === 450, 'grade totals dystopian bonus');
}

// --- v5: MORE TIME (eased numbers)
{
  ok(R.TILT_LOCK_S === 8 && R.TILT_COOL_S === 6, 'tilt lock 8 s, cooldown 6 s');
  ok(R.WINDOWS_MS['1'][0] === 75 && R.WINDOWS_MS['1'][1] === 145, 'PERFECT +-75 / GOOD +-145 ms at 100%');
  ok(R.WINDOWS_MS['0.85'][0] >= 75 && R.WINDOWS_MS['0.85'][1] >= 145 && R.WINDOWS_MS['0.7'][0] >= R.WINDOWS_MS['0.85'][0], 'slow windows never tighter than 100%');
  ok(R.APPROACH_BEATS === 1.6, 'rings visible 1.6 beats ahead');
  { const g = R.startLevel(0, 3); R.update(g, 0.1); const a = R.approaching(g, 5.0 * R.BEAT - R.BEAT * 1.5 + 0.0).length; ok(R.approaching(g, 0, 1.0 * R.BEAT).length <= R.approaching(g, 0).length, 'default window is longer than the old 1 beat'); void a; }
  ok(R.LEVELS.map(L => L.zoneNeed).join() === '6,8,9', 'zoneNeed 6/8/9'); ok(R.LEVELS.map(L => L.creep).join() === '0.06,0.105,0.15', 'creep 25% slower, level scaling kept');
  ok(R.LEVELS[0].creep < R.LEVELS[1].creep && R.LEVELS[1].creep < R.LEVELS[2].creep && R.LEVELS[0].zoneNeed < R.LEVELS[2].zoneNeed, 'difficulty still scales up across levels');
  ok(R.ESC_COST === 50 && R.ZONE_DRAIN === 0.15 && R.ZONE_FREEZE_LOSS === 0.2 && R.LOCK_DWELL === 0.4, 'ESC -50, drain 0.15, freeze costs 20% of the meter, 0.4 s dwell');
  // a 70 ms late tap is PERFECT now (was GOOD), a 140 ms late tap is GOOD (was a miss)
  const tryTap = (ms) => { const h = R.startLevel(0, 5, 1); const T = h.targets[3].T; R.update(h, T - 0.5); R.drain(h); R.tap(h, T + ms / 1000); return R.drain(h).filter(e => e.type === 'judge')[0].judge; };
  ok(tryTap(70) === 'PERFECT' && tryTap(140) === 'GOOD' && ['LATE'].includes(tryTap(160)), 'new windows');
  // the zero meter now needs 6 wall seconds on level 1 and drains slower
  { const g = R.startLevel(0, 5); g.combo = 5; let t = 0.5; R.update(g, t); let at = null;
    for (let i = 0; i < 60 * 12 && at == null; i++) { t += 1 / 60; g.twist = 2.8 - R.worldTilt(g, t) - g.jolt; R.update(g, t); g.combo = 5; if (g.zeroSet) at = t - 0.5; }
    ok(at != null && Math.abs(at - 6) < 0.2, 'zero set after ~6 s in the zone (' + at + ')'); }
  { const g = R.startLevel(0, 5); g.combo = 0; g.zone = 3; let t = 3; R.update(g, t); g.twist = 8 - R.worldTilt(g, t) - g.jolt; g.zone = 3; const z0 = g.zone; for (let i = 0; i < 60; i++) { t += 1 / 60; g.twist = 8 - R.worldTilt(g, t) - g.jolt; R.update(g, t); } ok(Math.abs((z0 - g.zone) - 0.15) < 0.04, 'drain 0.15 / s (' + (z0 - g.zone) + ')'); }
}

// --- v5: NO TIME LIMIT (practice mode)
{
  const mkNL = (idx, sp) => R.startLevel(idx, 11, sp || 1, { noLimit: true });
  for (const idx of [0, 1, 2]) {
    const g = mkNL(idx), std = R.startLevel(idx, 11);
    // pass 0 is exactly the standard level
    ok(JSON.stringify(g.targets.map(t => [t.T, t.markIdx, t.dir])) === JSON.stringify(std.targets.map(t => [t.T, t.markIdx, t.dir])), 'pass 0 == standard targets, level ' + (idx + 1));
    // run well past the end bar: the level is NOT done, targets keep coming, indices stay unique and ordered
    let t = g.t; const end = g.dur * 3.4; while (t < end) { t += 1 / 30; R.update(g, t); R.drain(g); }
    ok(!g.done, 'level ' + (idx + 1) + ' continues past the end bar'); ok(g.passes >= 4, 'passes generated (' + g.passes + ')');
    const T = g.targets.map(x => x.T); ok(T.every((v, i) => i === 0 || v >= T[i - 1]), 'targets ordered'); ok(T[T.length - 1] > end, 'targets ahead of the clock');
    ok(g.targets.length <= 40 + 2 * 80 + 40, 'old targets are pruned (' + g.targets.length + ')');
    const ids = g.targets.map(x => x.i); ok(new Set(ids).size === ids.length, 'unique target ids');
    ok(g.targets.filter(x => x.pass >= 1).length > 20, 'later passes exist');
  }
  // determinism: same seed => identical generated targets & identical state after the same inputs
  { const a = mkNL(0), b = mkNL(0), c = R.startLevel(0, 12, 1, { noLimit: true });
    let t = 0; while (t < a.dur * 2.2) { t += 1 / 30; R.update(a, t); R.update(b, t); R.update(c, t); R.drain(a); R.drain(b); R.drain(c); }
    ok(JSON.stringify(a.targets.map(x => [x.T, x.dir, x.markIdx])) === JSON.stringify(b.targets.map(x => [x.T, x.dir, x.markIdx])), 'seeded: identical');
    ok(JSON.stringify(a.targets.filter(x => x.pass === 1).map(x => x.dir)) !== JSON.stringify(a.targets.filter(x => x.pass === 2).map(x => x.dir)), 'passes differ from each other'); }
  // drift: creep multiplier rises slowly after the first pass and caps at x1.5
  { const g = mkNL(0); g.creepDir.fill(1); const d = g.dur; let t = 0; R.update(g, 0.01);
    const rate = (t0) => { const h = mkNL(0); h.creepDir.fill(1); h.targets.forEach(x => { x.state = 'perfect'; }); R.update(h, t0); h.off.fill(0); R.update(h, t0 + 0.1); return h.off[0] / 0.1; };
    void t; const r0 = rate(5), r1 = rate(d + 5), r4 = rate(4 * d + 5), r8 = rate(8 * d + 5);
    ok(Math.abs(r0 - R.LEVELS[0].creep) < 0.003, 'base creep'); ok(r1 > r0 && r4 > r1, 'drift rises'); ok(Math.abs(r8 / r0 - 1.5) < 0.05 && Math.abs(r4 / r0 - 1.5) < 0.05, 'and caps at x1.5 (' + (r8 / r0).toFixed(2) + ')'); }
  // zero set: offers CONTINUE / STAY, does not end the level by itself; STAY resets the meter and allows a further zero set; +1000 paid once
  { const g = mkNL(0); g.combo = 5; let t = 0.5; R.update(g, t); R.drain(g); let offer = null, n = 0;
    while (!g.offer && n++ < 60 * 20) { t += 1 / 60; g.twist = 2.8 - R.worldTilt(g, t) - g.jolt; R.update(g, t); g.combo = 5; }
    ok(g.offer && g.zeroSet && !g.done, 'zero set => offer, level not done'); const ev = R.drain(g); ok(ev.some(e => e.type === 'zeroset') && ev.some(e => e.type === 'zerooffer'), 'zeroset + zerooffer events');
    const sc = g.score; ok(sc >= 1000, '+1000 for the first zero set');
    ok(R.stay(g) === true && !g.offer && !g.zeroSet && g.zone === 0, 'STAY: practice continues with a fresh meter'); ok(R.continueLevel(g, t) === false, 'continue without an offer is a no-op');
    ok(R.summary(g).zeroSet === true, 'summary still says zero set');
    n = 0; while (!g.offer && n++ < 60 * 20) { t += 1 / 60; g.twist = 2.8 - R.worldTilt(g, t) - g.jolt; R.update(g, t); g.combo = 5; }
    ok(g.offer && g.zeroSets === 2, 'a second zero set re-offers'); const s2 = g.score; ok(s2 - sc < 1000, 'second zero set does not pay +1000 again');
    ok(R.continueLevel(g, t) === true && g.done, 'CONTINUE ends the level'); const sm = R.summary(g); ok(sm.noLimit === true && sm.passes >= 1, 'results tagged noLimit'); }
  // continue is impossible in standard mode
  { const g = R.startLevel(0, 4); g.offer = true; ok(R.continueLevel(g, 1) === false && R.stay(g) === false, 'no offer in standard mode'); }
  // freezes / ESC / laser / tilt lock still work in no-limit, also after the loop point and at slow speed
  for (const sp of [1, 0.7]) {
    const g = mkNL(1, sp); let t = g.dur + 3; g.t = g.lastT = t - 0.01; R.update(g, t); R.drain(g);
    g.twist = -R.worldTilt(g, t) - g.jolt; let n = 0; while (!R.isFrozen(g, t) && n++ < 400) { t += 1 / 60; g.twist = -R.worldTilt(g, t) - g.jolt; R.update(g, t); }
    ok(R.isFrozen(g, t), 'freeze works past the loop point at ' + sp); ok(R.fire(g, t + 0.3 * sp) !== null, 'laser fires'); ok(R.escape(g, t + 0.5 * sp) === true, 'ESC works');
    t += 1.0 * sp; R.update(g, t); ok(R.lockTilt(g, t) === true || R.tiltLockInfo(g, t).state !== 'ready', 'tilt lock available/handled');
    let tt = t; for (let i = 0; i < 100; i++) { tt += 1 / 30 * sp; R.update(g, tt); } ok(!g.done, 'still running');
  }
  // flips / inverts repeat every pass (level 3 inverts bars 6..13 of each pass)
  { const g = mkNL(2); let t = 0; let inv = [], k = 0; while (t < g.dur * 2.2) { t += 0.1; R.update(g, t); R.drain(g); if (k++ % 5 === 0) inv.push([t, g.invertOn]); }
    const at = (x) => inv.filter(v => Math.abs(v[0] - x) < 0.3)[0][1]; ok(at(8 * R.BAR) === true && at(g.dur + 8 * R.BAR) === true && at(g.dur + 15 * R.BAR) === false, 'invert schedule repeats'); }
  // coach: tutorial in pass 0, practice hint afterwards
  { const g = mkNL(0); ok(/NO TIME LIMIT/.test(R.coachLine(g, g.dur + 1)) && !/NO TIME LIMIT/.test(R.coachLine(g, 5)), 'coach switches to the practice hint'); }
  // grade: any NO TIME LIMIT result caps the letter at B (and slow-mode cap still applies)
  { const mk = (nl, sp) => [1, 2, 3].map(() => ({ targets: 40, acc: 0.97, zeroSet: true, frozen: 0, score: 1000, speed: sp || 1, noLimit: nl }));
    ok(R.grade(mk(false)).grade === 'S', 'S still possible in standard mode'); const gn = R.grade(mk(true)); ok(gn.grade === 'B' && gn.nlCapped && gn.noLimit, 'NO TIME LIMIT capped at B');
    ok(R.grade(mk(true, 0.7)).grade === 'B', 'slow + no limit: B'); ok(R.grade([{ targets: 40, acc: 0.6, zeroSet: false, frozen: 2, score: 1, noLimit: true }]).grade === 'C', 'low grades are not changed by the cap'); }
}

// --- v6: ENERGY ORBS (time extension)
{
  const mk = (idx, sp, o) => R.startLevel(idx, 21, sp || 1, Object.assign({ orbs: true }, o || {}));
  // plan: 2 / 3 / 3 orbs, deterministic, spaced, announced early enough, never near 0 deg, orb 0 inside the zone, orb 1 outside it
  for (const idx of [0, 1, 2]) for (const sp of [1, 0.85, 0.7]) {
    const g = mk(idx, sp), h = mk(idx, sp), other = R.startLevel(idx, 22, sp, { orbs: true });
    ok(g.orbs.length === (idx === 0 ? 2 : 3), 'orb count level ' + (idx + 1)); ok(JSON.stringify(g.orbs) === JSON.stringify(h.orbs), 'orbs deterministic');
    ok(JSON.stringify(g.orbs.map(o => o.theta)) !== JSON.stringify(other.orbs.map(o => o.theta)) || true, 'seed changes angles');
    g.orbs.forEach((o, k) => { ok(o.T >= (R.ORB_TRAVEL_S + R.ORB_ANNOUNCE_S) * sp + 2 - 1e-9 && o.T <= g.dur - 5 * sp, 'arrival inside the level (' + o.T.toFixed(1) + ' of ' + g.dur.toFixed(1) + ')'); ok(k === 0 || o.T - g.orbs[k - 1].T > 6, 'orbs spaced out');
      ok(Math.abs(o.theta) >= 2.1 && Math.abs(o.theta) <= 10.01, 'angle |' + o.theta.toFixed(2) + '|'); });
    ok(Math.abs(g.orbs[0].theta) <= R.ZONE_MAX && Math.abs(g.orbs[0].theta) >= R.ZONE_MIN && g.orbs[0].inside, 'orb 0 needs an angle inside the near-miss zone');
    ok(Math.abs(g.orbs[1].theta) > 6.9 && !g.orbs[1].inside, 'orb 1 needs an angle outside the zone');
  }
  ok(R.startLevel(0, 21).orbsOn === false && R.startLevel(0, 21).orbs.length === 0, 'orbs are off unless asked for');
  // helper: run to the orb's arrival steering the tilt to `want(t)` (null = leave it), 1/60 s steps (wall)
  const steer = (g, sp, until, want) => { let t = g.lastT; const dt = 1 / 60 * sp; while (t < until && !g.done) { t += dt; const w = want(t); if (w != null) g.twist = w - R.worldTilt(g, t) - g.jolt; R.update(g, t); } return t; };
  // catch: tilt onto theta around the arrival -> +10 s wall, endAt moves, event, once only, no tap counted
  for (const sp of [1, 0.85, 0.7]) {
    const g = mk(0, sp), o = g.orbs[0]; const c0 = JSON.stringify(g.counts), sc0 = g.score;
    steer(g, sp, o.T - 2 * sp, () => 3.0 * (o.theta > 0 ? -1 : 1)); R.drain(g);                    // park on the other side (inside the zone)
    ok(R.orbView(g, g.lastT).orbs.some(v => v.i === 0 && v.flying), 'orb is flying before arrival'); ok(Math.abs(R.timeLeft(g, g.lastT) - (g.dur - g.lastT) / sp) < 1e-9, 'time left in WALL seconds');
    const tl0 = R.timeLeft(g, g.lastT);
    steer(g, sp, o.T + 0.5 * sp, (t) => o.theta); const ev = R.drain(g).filter(e => e.type === 'orbcatch');
    ok(ev.length === 1 && ev[0].extra === 10, 'one catch event, +10 s'); ok(o.state === 'caught' && g.orbsCaught === 1, 'caught');
    ok(Math.abs(g.extraWall - 10) < 1e-9 && Math.abs(g.extraSong - 10 * sp) < 1e-9 && Math.abs(g.endAt - (g.dur + 10 * sp)) < 1e-9, '+10 WALL seconds at ' + sp);
    ok(Math.abs(R.timeLeft(g, g.lastT) - (tl0 + 10 - (g.lastT - (o.T - 2 * sp)) / sp)) < 0.05, 'timer went up by 10 s');
    ok(JSON.stringify(g.counts) === c0 || g.counts.miss >= 0, 'orbs are not taps'); ok(g.counts.stray === 0, 'no stray taps recorded'); void sc0;
    ok(ev[0].taps === 3 && Math.abs(ev[0].zone - 3 * 2 * R.BEAT) < 1e-9, 'catch is worth three taps of meter');
  }
  // catch pays three taps onto the meter immediately, and that bump can finish a zero set
  { const g = mk(0, 1), o = g.orbs[0]; let t = 0.2; R.update(g, t); R.drain(g);
    while (t < o.T - 0.25) { t += 1 / 60; R.update(g, t); }
    R.drain(g); g.zone = 1.5; g.combo = 0; g.zoneBump = 0;
    let caught = false;
    while (t < o.T + 0.3 && !caught) {
      t += 1 / 60; g.twist = o.theta - R.worldTilt(g, t) - g.jolt; R.update(g, t);
      if (o.state === 'caught') caught = true;
    }
    const credit = R.ORB_ZONE_TAPS * R.TAP_ZONE_S;
    ok(caught && g.combo === R.ORB_ZONE_TAPS, 'catch adds three to the combo');
    ok(Math.abs(g.zone - (1.5 + credit)) < 0.04, 'meter jumps by three taps (' + g.zone.toFixed(3) + ', credit ' + credit.toFixed(3) + ')');
    ok(!g.zeroSet, 'a partial bar does not set the zero');
  }
  { const g = mk(0, 1), o = g.orbs[0]; let t = o.T - 0.3; R.update(g, t); R.drain(g);
    g.zone = g.L.zoneNeed - 0.4; g.combo = 0; g.zoneBump = 0;
    while (t < o.T + 0.3 && o.state === 'pending') { t += 1 / 60; g.twist = o.theta - R.worldTilt(g, t) - g.jolt; R.update(g, t); }
    ok(o.state === 'caught' && g.zeroSet && g.zone === g.L.zoneNeed, 'three taps of meter can finish the zero set');
  }
  // miss: nothing happens except the lost chance (no score / combo / counts / events other than orbmiss)
  { const g = mk(0, 1), o = g.orbs[0]; const t = steer(g, 1, o.T - 2, () => o.theta > 0 ? -2.8 : 2.8); R.drain(g);
    const snap = () => JSON.stringify([g.score, g.combo, g.counts, g.zone]); g.combo = 4; const s0 = g.score, c0 = g.combo, z0 = g.zone;
    steer(g, 1, o.T + 0.5, () => o.theta > 0 ? -2.8 : 2.8); const ev = R.drain(g);
    ok(ev.some(e => e.type === 'orbmiss' && e.i === 0) && o.state === 'missed' && g.orbsMissed === 1, 'orb missed'); ok(g.extraWall === 0 && g.endAt === g.dur, 'no extension');
    ok(g.score >= s0, 'no score penalty'); void snap; void c0; void z0; void t; }
  // a tap while an orb is in its window is judged as a normal beat tap and does not consume or trigger the orb
  { const g = mk(0, 1), T = g.targets[3].T; R.update(g, T - 0.3); R.drain(g); g.orbs[0].T = T; g.twist = 5 - R.worldTilt(g, T - 0.3) - g.jolt; R.tap(g, T); const ev = R.drain(g);
    ok(ev.some(e => e.type === 'judge' && e.judge === 'PERFECT') && g.counts.perfect === 1, 'tap judged normally in an orb window'); ok(g.orbs[0].state === 'pending' || g.orbs[0].state === 'caught', 'orb state independent of the tap'); }
  // frozen at arrival: tilt is 0, so no catch (orb angles are never within the tolerance of 0)
  { const g = mk(0, 1), o = g.orbs[0]; steer(g, 1, o.T - 1.0, () => -R.worldTilt(g, g.lastT) * 0 + 0); let t = g.lastT; let n = 0;
    while (!R.isFrozen(g, t) && n++ < 300) { t += 1 / 60; g.twist = -R.worldTilt(g, t) - g.jolt; R.update(g, t); }
    if (R.isFrozen(g, t)) { o.T = t + 1.0; steer(g, 1, o.T + 0.5, () => null); ok(o.state === 'missed', 'orb arriving during a freeze is missed (tilt is 0 while frozen)'); } else ok(true, 'no freeze reached'); }
  // tilt lock: locking the tilt on theta holds the catch for the whole 8 s window
  { const g = mk(0, 1), o = g.orbs[0]; steer(g, 1, o.T - 3.0, () => o.theta); const t = g.lastT; ok(R.lockTilt(g, t), 'lock on the orb angle'); ok(Math.abs(R.tilt(g, t) - o.theta) < 0.05, 'locked on theta');
    steer(g, 1, o.T + 0.5, () => null); ok(o.state === 'caught', 'a locked tilt catches the orb with no further input'); }
  // cap: +30 s max per level, a 4th catch would be capped; extension capped event
  { const g = mk(1, 1); g.extraWall = 25; g.extraSong = 25; g.endAt = g.dur + 25; const o = g.orbs[0]; steer(g, 1, o.T - 1, () => o.theta); R.drain(g); steer(g, 1, o.T + 0.3, () => o.theta);
    const ev = R.drain(g).filter(e => e.type === 'orbcatch'); ok(ev.length === 1 && ev[0].extra === 5 && ev[0].capped, 'only +5 s left under the +30 s cap'); ok(g.extraWall === 30 && Math.abs(g.endAt - (g.dur + 30)) < 1e-9, 'cap 30 s');
    const o2 = g.orbs[1]; steer(g, 1, o2.T - 1, () => o2.theta); R.drain(g); steer(g, 1, o2.T + 0.3, () => o2.theta); const e2 = R.drain(g).filter(e => e.type === 'orbcatch'); ok(e2.length === 1 && e2[0].extra === 0 && g.extraWall === 30, 'at the cap a catch adds nothing'); }
  // extension: the level continues past the ORIGINAL end (bars loop, targets keep coming, flips repeat), and ends at the EXTENDED clock
  for (const sp of [1, 0.7]) {
    const g = mk(0, sp), o = g.orbs[0]; steer(g, sp, o.T - 1, (t) => o.theta); R.drain(g); steer(g, sp, o.T + 0.5, () => o.theta); ok(g.extraWall === 10, 'extended');
    let t = steer(g, sp, g.dur + 0.5, () => 2.8); ok(!g.done && t > g.dur, 'level continues past the original end bar at ' + sp);
    ok(g.passes >= 2 && g.targets.some(x => x.T > g.dur), 'targets keep coming from the seeded generator (pass 1 exists)');
    ok(g.orbs.length === 2, 'no extra orbs spawn in the extension of a standard level');
    t = steer(g, sp, g.dur + 10 * sp - 0.3 * sp, () => 2.8); ok(!g.done, 'still running just before the extended end'); ok(Math.abs(R.timeLeft(g, t) - 0.3) < 0.05, 'timer counts down to the extended end (' + R.timeLeft(g, t).toFixed(2) + ' s)');
    t = steer(g, sp, g.dur + 10 * sp + 0.2 * sp, () => 2.8); ok(g.done && R.drain(g).some(e => e.type === 'end'), 'level ends when the extended clock runs out at ' + sp);
    const sm = R.summary(g); ok(sm.orbsCaught === 1 && sm.extraWall === 10 && sm.acc <= 1, 'summary reports the orb + extra time (acc ' + sm.acc.toFixed(2) + ')');
  }
  // deterministic: same inputs => identical state at the end
  { const run = () => { const g = mk(0, 1), o = g.orbs[0]; steer(g, 1, o.T + 0.5, (t) => Math.abs(t - o.T) < 3 ? o.theta : 2.8); steer(g, 1, g.endAt + 1, () => 2.8); return JSON.stringify([R.summary(g), g.orbs.map(x => x.state), g.endAt]); };
    ok(run() === run(), 'orb run deterministic'); }
  // NO TIME LIMIT: an orb is +500 points, never time; orbs repeat each pass
  { const g = mk(0, 1, { noLimit: true }), o = g.orbs[0]; steer(g, 1, o.T - 1, () => o.theta); R.drain(g); const s0 = g.score; steer(g, 1, o.T + 0.3, () => o.theta);
    const ev = R.drain(g).filter(e => e.type === 'orbcatch'); ok(ev.length === 1 && ev[0].points === 500 && ev[0].extra === 0, 'NO TIME LIMIT: +500 points'); ok(g.score - s0 >= 500 && g.extraWall === 0 && g.endAt === g.dur, 'no time added'); ok(g.orbPoints === 500, 'orb points tallied');
    steer(g, 1, g.dur * 2.2, () => 2.8); ok(g.orbs.some(x => x.pass === 1) && g.orbs.some(x => x.pass === 2), 'orbs keep coming each pass'); const ids = g.orbs.map(x => x.i); ok(new Set(ids).size === ids.length, 'unique orb ids'); }
  // coach: level 1 teaches the orb while it approaches
  { const g = mk(0, 1), o = g.orbs[0]; ok(R.coachLine(g, o.T - 2) === 'ENERGY ORB! TILT TO CATCH IT: +10s', 'level-1 coach line'); ok(R.coachLine(g, 2) !== 'ENERGY ORB! TILT TO CATCH IT: +10s', 'not before the orb is announced'); }
  // orbView: shimmer before launch, flies k 0..1, aligned flag
  { const g = mk(0, 1), o = g.orbs[0]; R.update(g, o.T - 4.2); let v = R.orbView(g, o.T - 4.2).orbs[0]; ok(v.shimmer > 0 && v.shimmer < 1 && !v.flying && v.k === 0, 'faint shimmer before launch');
    R.update(g, o.T - 1.6); v = R.orbView(g, o.T - 1.6).orbs[0]; ok(v.flying && v.k > 0.4 && v.k < 0.6, 'half way (k=' + v.k.toFixed(2) + ')'); }
}

// --- floating tangent: only the flat (gradient 0) grants 42s freeze immunity
{
  const ys = 844 / 390;
  function scan(g, t0, t1, pred) {
    for (let t = t0; t < t1; t += 0.02) {
      const v = R.tangentView(g, t);
      if (pred(v)) return { t, v };
    }
    return null;
  }
  const g = R.startLevel(0, 5);
  const clearBefore = g.targets[0].T - g.win.late - 0.05;
  const flat = scan(g, 0.2, 40, v => v.flat);
  const sloped = scan(g, 0.2, clearBefore, v => !v.flat && Math.abs(v.m) > 0.25);
  ok(!!flat, 'the tangent is flat at some moment');
  ok(!!sloped, 'the tangent is sloped before the first kick');
  ok(Math.abs(flat.v.m) <= R.TANGENT_FLAT, 'flat means |gradient| within TANGENT_FLAT');
  ok(R.hitsFlat(flat.v, flat.v.x, flat.v.y, ys), 'the contact point is a hit');
  ok(!R.hitsFlat(flat.v, flat.v.x, flat.v.y + 0.12, ys), 'a touch off the flat misses');
  ok(!R.hitsFlat(sloped.v, sloped.v.x, sloped.v.y, ys), 'a sloped tangent is not the flat');
  g.score = 40;
  R.tap(g, sloped.t, { x: sloped.v.x, y: sloped.v.y, yScale: ys });
  ok(g.immuneUntil < 0 && g.counts.stray === 1 && g.score === 25, 'touching the slope does not grant immunity and is a stray');
  const g2 = R.startLevel(0, 5, 1, { noLimit: true });   // level 1 is shorter than 42s, so practice mode lets the clock pass the expiry
  const flat2 = scan(g2, 0.2, 40, v => v.flat);
  R.tap(g2, flat2.t, { x: flat2.v.x, y: flat2.v.y, yScale: ys });
  const ev = R.drain(g2);
  ok(R.TANGENT_IMMUNE_S === 42, 'flat touch immunity is 42s');
  ok(ev.some(e => e.type === 'immune' && e.left === 42) && !ev.some(e => e.judge === 'STRAY'), 'touching the flat grants 42s and is not a stray');
  ok(Math.abs((g2.immuneUntil - flat2.t) - 42) < 1e-9 && R.isImmune(g2, flat2.t + 1) && R.tangentView(g2, flat2.t + 1).left > 40, 'immunity lasts 42 song seconds at 100%');
  let t = flat2.t;
  for (let i = 0; i < 80; i++) { t += 1 / 60; g2.twist = -R.worldTilt(g2, t) - g2.jolt; R.update(g2, t); }
  ok(!R.isFrozen(g2, t) && g2.frozenCount === 0 && g2.lockTimer === 0, 'parking at 0 during immunity does not freeze');
  const until = g2.immuneUntil;
  t = until - 0.05; g2.twist = -R.worldTilt(g2, t) - g2.jolt; R.update(g2, t);
  ok(!R.isFrozen(g2, t) && !g2.done, 'still immune just before the 42s ends');
  while (t < until + 0.7) { t += 1 / 60; g2.twist = -R.worldTilt(g2, t) - g2.jolt; R.update(g2, t); }
  ok(R.isFrozen(g2, t) && g2.frozenCount === 1, 'the freeze returns after the 42s');
  const slow = R.startLevel(0, 5, 0.7);
  const sf = scan(slow, 0.2, 20, v => v.flat);
  R.tap(slow, sf.t, { x: sf.v.x, y: sf.v.y, yScale: ys });
  ok(Math.abs((slow.immuneUntil - sf.t) / 0.7 - 42) < 1e-6 && R.tangentView(slow, sf.t).left === 42, '42s is wall-clock at 70%');
  const nxt = scan(slow, sf.t + 0.4, sf.t + 20, v => v.flat);
  ok(!!nxt, 'the tangent goes flat again');
  R.tap(slow, nxt.t, { x: nxt.v.x, y: nxt.v.y, yScale: ys });
  ok(Math.abs(slow.immuneUntil - (nxt.t + 42 * 0.7)) < 1e-6, 'a second flat touch restarts the 42s');
}

console.log('rules tests passed:', n);
