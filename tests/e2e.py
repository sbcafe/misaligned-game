#!/usr/bin/env python3
"""End-to-end test: drives MISALIGNED in headless Chromium with mobile emulation and takes the screenshots.
Run: <venv with playwright>/bin/python tests/e2e.py  (static server must be running on PORT)."""
import asyncio, json, sys, os, time
from playwright.async_api import async_playwright
PORT = int(os.environ.get('PORT', '8765'))
URL = f'http://127.0.0.1:{PORT}/index.html'
SHOTS = os.path.join(os.path.dirname(__file__), '..', 'screenshots')
os.makedirs(SHOTS, exist_ok=True)
REPORT = {}
LOGS = []

AUTOPLAY_JS = """
(opts) => {
  const m = window.__mis, R = m.R; const canvas = document.getElementById('stage');
  const ap = window.__ap = Object.assign({on:true, jitter:0, skipEvery:0, zone:2.8, ctrl:true, ctrlAngle:null, taps:0, sliderId:5, down:false, p:0, startX:0, startP:0, tapped:new Set(), log:[]}, opts||{});
  const ev = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, {pointerId:id, pointerType:'touch', isPrimary:id===ap.sliderId, clientX:x, clientY:y, bubbles:true, cancelable:true}));
  function loop() {
    if (!ap.on) return;
    const g = m.g;
    if (m.state === 'play' && g && !g.done) {
      const t = m.levelT(); const L = m.rend.L;
      // taps
      for (const tg of g.targets) {
        if (tg.state !== 'pending' || ap.tapped.has(tg.i)) continue;
        if (tg.T - t > 0.05) break;
        const j = ap.jitter ? (((tg.i * 37) % 11) - 5) / 5 * ap.jitter : 0;
        const skip = ap.skipEvery && tg.i % ap.skipEvery === (ap.skipEvery - 1);
        if (skip) { ap.tapped.add(tg.i); continue; }
        if (t >= tg.T + j) { ap.tapped.add(tg.i); ap.taps++; const r = canvas.getBoundingClientRect(), q = m.markScreen(tg.markIdx), qx = r.left + q.x, qy = r.top + q.y; ev('pointerdown', 9, qx, qy); ev('pointerup', 9, qx, qy); /* v12: touch the ringed letter */ break; }
      }
      // slider via real pointer events
      if (ap.ctrl && t > 0.3) {
        const half = (L.trackX1 - L.trackX0) / 2 - 40, cx = (L.trackX0 + L.trackX1) / 2, y = L.trackY;
        if (!ap.down) { ap.down = true; ap.startP = g.p; ap.startX = cx + g.p * half; ev('pointerdown', ap.sliderId, ap.startX, y); ap.p = g.p; }
        const a = R.rawAngle(g, t); let want;
        if (ap.ctrlAngle !== null) want = ap.ctrlAngle; else want = (a >= 0 ? 1 : -1) * ap.zone;
        if (R.isFrozen(g, t)) want = a;
        const err = a - want;                       // degrees to remove
        ap.p += (-err * 0.4) / (R.TWIST_RANGE * g.sign);
        ap.p = Math.max(-1, Math.min(1, ap.p));
        ev('pointermove', ap.sliderId, ap.startX + (ap.p - ap.startP) * half, y);
      }
    } else if (ap.down && (!g || g.done || m.state !== 'play')) { ap.down = false; ap.tapped = new Set(); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  return true;
}
"""

KICK_PROBE_JS = """() => {
  const buf = GameAudio.buffer, sr = buf.sampleRate, d = buf.getChannelData(0), R = __mis.R;
  const lp = (x) => { const a = Math.exp(-2 * Math.PI * 300 / sr), y = new Float32Array(x.length); let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { s1 = a * s1 + (1 - a) * x[i]; s2 = a * s2 + (1 - a) * s1; y[i] = s2; } return y; };
  const nT = Math.floor(0.15 * sr), tm = new Float32Array(nT);
  for (let i = 0, ph = 0; i < nT; i++) { const t = i / sr, f = 47 + 95 * Math.exp(-t / 0.05) + 220 * Math.exp(-t / 0.005); ph += 2 * Math.PI * f / sr;
    tm[i] = Math.sin(ph) * Math.exp(-t / 0.26) * Math.min(1, t / 0.0006); }
  const tl = lp(tm); let tn = 0; for (let i = 0; i < nT; i++) tn += tl[i] * tl[i]; tn = Math.sqrt(tn);
  const sig = lp(d.subarray(0, Math.floor(sr * 40)));
  const out = [];
  for (let bar = 4; bar < 20; bar++) {
    if (R.kickSteps(bar).indexOf(8) < 0) continue;
    const T = bar * R.BAR + 8 * R.SIX, c = Math.round(T * sr), lags = Math.round(0.045 * sr); let best = -2, bl = 0, vals = [];
    for (let L = -lags; L <= lags; L++) { let num = 0, en = 0; const o = c + L;
      for (let i = 0; i < nT; i += 2) { const v = sig[o + i]; num += v * tl[i]; en += v * v; }
      const nc = num / (Math.sqrt(en * 2) * tn / Math.sqrt(2) + 1e-12); vals.push(nc); if (nc > best) { best = nc; bl = L; } }
    out.push(bl / sr * 1000);
  }
  out.sort((x, y) => x - y);
  return { sampleRate: sr, frames: buf.length, duration: buf.duration, median_ms: out[Math.floor(out.length / 2)], min_ms: out[0], max_ms: out[out.length - 1], n: out.length };
}"""

async def js(page, code, arg=None):
    return await page.evaluate(code, arg) if arg is not None else await page.evaluate(code)

async def wait_state(page, name, timeout=60000):
    await page.wait_for_function(f"window.__mis && window.__mis.state === '{name}'", timeout=timeout)

async def shot(page, name):
    path = os.path.join(SHOTS, name)
    await page.screenshot(path=path)
    print('shot', name)

async def tap_btn(page, sel):
    el = page.locator(sel)
    await el.wait_for(state='visible')
    await el.scroll_into_view_if_needed()
    await page.wait_for_timeout(400)          # the game ignores clicks for 320 ms after a screen change (ghost-click guard)
    box = await el.bounding_box()
    await page.touchscreen.tap(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)

async def start_direct(page, label):
    """REGRESSION (Start bug): a real touch tap on START must land in level-1 gameplay, never in the how-to screen,
    and must still be there after the ghost-click window."""
    await tap_btn(page, '#mStart')
    await page.wait_for_function("window.__mis.state !== 'menu'", timeout=8000)
    await page.wait_for_timeout(900)
    r = await js(page, "({state: __mis.state, level: __mis.g && __mis.g.L.id, howto_visible: document.getElementById('screen-howto').classList.contains('on'), menu_visible: document.getElementById('screen-menu').classList.contains('on')})")
    assert r['state'] == 'play' and r['level'] == 1 and not r['howto_visible'] and not r['menu_visible'], f'START did not start level 1: {r}'
    REPORT.setdefault('start_regression', {})[label] = r
    return r

def rects_overlap(a, b):
    return not (a['x'] + a['width'] <= b['x'] or b['x'] + b['width'] <= a['x'] or a['y'] + a['height'] <= b['y'] or b['y'] + b['height'] <= a['y'])

async def rect(page, sel):
    return await js(page, "(s => { const r = document.querySelector(s).getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, on: getComputedStyle(document.querySelector(s)).display !== 'none'}; })('" + sel + "')") if False else await page.evaluate("(s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, on: getComputedStyle(e).display !== 'none'}; }", sel)

async def touch(cdp, kind, pts):
    await cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': pts})

def center(r): return r['x'] + r['width'] / 2, r['y'] + r['height'] / 2

async def arrow_tests(page, cdp, label):
    """Hold the arrows with real multi-touch (CDP): rotate + accelerate + stop on release; not beat taps; second thumb can tap."""
    out = {}
    sels = ['#aLU', '#aLD', '#aRU', '#aRD']
    rs = {sl: await rect(page, sl) for sl in sels}
    out['visible'] = all(r['on'] for r in rs.values()); out['sizes'] = {sl: [round(r['width']), round(r['height'])] for sl, r in rs.items()}
    out['all_>=56px'] = all(r['width'] >= 56 and r['height'] >= 56 for r in rs.values())
    hud = [await rect(page, '#btnPause'), await rect(page, '#btnMute')]
    vw, vh = await js(page, "[innerWidth, innerHeight]")
    out['no_overlap_with_hud_buttons'] = not any(rects_overlap(a, h) for a in rs.values() for h in hud)
    out['inside_viewport'] = all(r['x'] >= 0 and r['y'] >= 0 and r['x'] + r['width'] <= vw and r['y'] + r['height'] <= vh for r in rs.values())
    out['arrows_distinct_from_each_other'] = not any(rects_overlap(rs[a], rs[b]) for i, a in enumerate(sels) for b in sels[i + 1:])
    assert out['visible'] and out['all_>=56px'] and out['no_overlap_with_hud_buttons'] and out['inside_viewport'], out
    counts0 = await js(page, "JSON.stringify(__mis.g.counts)"); score0 = await js(page, "__mis.g.score")
    # --- DOWN arrow on the RIGHT edge: clockwise (+), accelerating
    x, y = center(rs['#aRD']); tw0 = await js(page, "__mis.g.twist"); t0 = time.time()
    await touch(cdp, 'touchStart', [{'x': x, 'y': y, 'id': 1}])
    await page.wait_for_timeout(60)
    pressed = await js(page, "document.getElementById('aRD').classList.contains('pressed')")
    await page.wait_for_timeout(300); tw_a = await js(page, "__mis.g.twist"); ta = time.time()
    # second thumb taps the beat area while the arrow is held (multi-touch safe)
    c_before = await js(page, "(() => { const c = __mis.g.counts; return c.perfect + c.good + c.miss + c.stray; })()")
    # (CDP touchEnd releases every finger, so the second thumb is a pointer event on the canvas while finger 1 really holds the arrow)
    await js(page, "(() => { const c = document.getElementById('stage'); const o = {pointerId: 9, pointerType: 'touch', clientX: 200, clientY: 250, bubbles: true, cancelable: true}; c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new PointerEvent('pointerup', o)); })()")
    c_after = await js(page, "(() => { const c = __mis.g.counts; return c.perfect + c.good + c.miss + c.stray; })()")
    await page.wait_for_timeout(500); tw_b = await js(page, "__mis.g.twist"); tb = time.time()
    still = await js(page, "document.getElementById('aRD').classList.contains('pressed')")
    await page.wait_for_timeout(500); tw_c = await js(page, "__mis.g.twist"); tc = time.time()
    await touch(cdp, 'touchEnd', [])
    await page.wait_for_timeout(150); tw_d = await js(page, "__mis.g.twist"); await page.wait_for_timeout(400); tw_e = await js(page, "__mis.g.twist")
    rate_early = (tw_a - tw0) / (ta - t0); rate_late = (tw_c - tw_b) / (tc - tb)
    out['down_right'] = dict(pressed_class=pressed, deg_after_0_3s=round(tw_a - tw0, 2), rate_early_deg_s=round(rate_early, 1), rate_late_deg_s=round(rate_late, 1),
                             accelerates=rate_late > rate_early * 1.5, clockwise=tw_a > tw0, stays_pressed_during_second_thumb_tap=still, stopped_after_release=abs(tw_e - tw_d) < 0.3)
    out['second_thumb_tap_counted_as_beat_tap'] = (c_after - c_before) == 1
    # arrow press alone is not a beat tap: judgments changed only by the one explicit canvas tap (plus expiries, none before 3.8 s)
    # --- UP arrow on the LEFT edge: counter-clockwise (-)
    x, y = center(rs['#aLU']); u0 = await js(page, "__mis.g.twist")
    await touch(cdp, 'touchStart', [{'x': x, 'y': y, 'id': 3}]); await page.wait_for_timeout(350); u1 = await js(page, "__mis.g.twist"); await touch(cdp, 'touchEnd', [])
    out['up_left'] = dict(deg_after_0_35s=round(u1 - u0, 2), counter_clockwise=u1 < u0)
    assert out['down_right']['clockwise'] and out['down_right']['accelerates'] and out['down_right']['stopped_after_release'] and out['up_left']['counter_clockwise'], out
    assert out['second_thumb_tap_counted_as_beat_tap'] and out['down_right']['stays_pressed_during_second_thumb_tap'], out
    REPORT.setdefault('arrows', {})[label] = out
    return out

NODE_WAIT_JS = """([thr, tmax]) => new Promise(res => { const g = __mis.g, R = __mis.R, t0 = performance.now();
  const f = () => { const v = R.laserView(g, g.lastT); if (!v || performance.now() - t0 > tmax) { res({ ok: false }); return; }
    if (v.ready) { const n = v.targets.filter(x => x.state === 'alive').sort((a, b) => Math.abs(a.x - .5) - Math.abs(b.x - .5))[0]; if (n && Math.abs(n.x - .5) < thr) { res({ ok: true, x: n.x }); return; } }
    requestAnimationFrame(f); }; f(); })"""

async def laser_test(page, label, shotname=None):
    """FROZEN-MODE LASER on touch emulation: FIRE visible only while frozen (above ESC, >=56px, clear of arrows/HUD), a press fires,
    the score rises by exactly the DYSTOPIAN bonus, it is not a beat tap, cooldown bounds spam, ESC clears and hides everything."""
    fb = page.locator('#fireBtn')
    assert await js(page, "getComputedStyle(document.getElementById('fireBtn')).display") == 'none', 'FIRE visible while not frozen'
    out = dict(hidden_when_not_frozen=True)
    n0 = await js(page, "__mis.g.frozenCount")
    await js(page, "window.__ap.ctrlAngle = 0")
    await page.wait_for_function(f"__mis.g.frozenCount > {n0}", timeout=40000)
    await js(page, "window.__ap.on = false")                      # park the autoplayer: only FIRE changes the numbers
    await page.wait_for_timeout(120)
    fr, er = await rect(page, '#fireBtn'), await rect(page, '#escBtn')
    arrows = [await rect(page, s_) for s_ in ('#aLU', '#aLD', '#aRU', '#aRD')]; hud = [await rect(page, '#btnPause'), await rect(page, '#btnMute')]
    vw, vh = await js(page, "[innerWidth, innerHeight]")
    out.update(shown_when_frozen=fr['on'], size_ok=fr['width'] >= 56 and fr['height'] >= 56, above_esc=fr['y'] + fr['height'] <= er['y'] + 1, no_overlap_esc=not rects_overlap(fr, er),
               clear_of_arrows=not any(rects_overlap(fr, a) for a in arrows), clear_of_hud=not any(rects_overlap(fr, h) for h in hud),
               inside_viewport=fr['x'] >= 0 and fr['y'] >= 0 and fr['x'] + fr['width'] <= vw and fr['y'] + fr['height'] <= vh)
    assert all(out.values()), out
    st = "(() => { const g = __mis.g, c = g.counts; return {perfect: c.perfect, good: c.good, stray: c.stray, score: g.score, shots: g.laserShots, hits: g.laserHits, bonus: g.laserBonus, combo: g.combo}; })()"
    s0 = await js(page, st)
    cx, cy = center(fr)
    got = None
    for attempt in range(8):
        w = await js(page, NODE_WAIT_JS, [0.02 + 0.01 * (attempt // 3), 1100])
        if not w['ok']:
            if not await js(page, "__mis.R.isFrozen(__mis.g, __mis.g.lastT)"): break
            continue
        before = await js(page, st)
        await page.touchscreen.tap(cx, cy)
        await page.wait_for_timeout(70)
        after = await js(page, st)
        if after['shots'] > before['shots'] and after['bonus'] > before['bonus']:
            got = dict(attempt=attempt, bonus=after['bonus'] - before['bonus'], score_delta=after['score'] - before['score'], hit=after['hits'] > before['hits'])
            break
        await page.wait_for_timeout(140)
    assert got is not None, ('no laser hit/near in 8 tries', s0)
    out['first_scoring_shot'] = got
    assert got['score_delta'] == got['bonus'], got                      # flat points, no multiplier
    # cooldown: two presses 0 ms apart count as one shot
    await js(page, "document.getElementById('fireBtn').classList.contains('on')")
    sh0 = (await js(page, st))['shots']; await page.wait_for_timeout(200)
    await js(page, "(() => { const b = document.getElementById('fireBtn'); const o = {pointerId: 12, pointerType: 'touch', bubbles: true, cancelable: true}; b.dispatchEvent(new PointerEvent('pointerdown', o)); b.dispatchEvent(new PointerEvent('pointerdown', o)); })()")
    sh1 = (await js(page, st))['shots']
    out['cooldown_two_instant_presses_count_as'] = sh1 - sh0; assert sh1 - sh0 == 1, out
    s1 = await js(page, st)
    out['not_a_beat_tap'] = (s1['perfect'], s1['good'], s1['stray']) == (s0['perfect'], s0['good'], s0['stray']); assert out['not_a_beat_tap'], (s0, s1)
    out['combo_untouched'] = s1['combo'] == s0['combo']; assert out['combo_untouched']
    out['dystopian_total'] = s1['bonus']; out['shots'] = s1['shots']; out['hits'] = s1['hits']
    assert s1['bonus'] <= 600 and s1['shots'] <= 12, s1
    # one more shot for the screenshot, then hold the canvas frame (beam + spark + floating text) and ESC while it is held
    w = await js(page, NODE_WAIT_JS, [0.03, 700]); await page.wait_for_timeout(130)
    await page.touchscreen.tap(cx, cy); await page.wait_for_timeout(60)
    await js(page, "window.__hold = true")
    # ESC unfreezes and clears the lasers; FIRE disappears
    er = await rect(page, '#escBtn'); ex, ey = center(er)
    await page.touchscreen.tap(ex, ey)
    if shotname: await shot(page, shotname)
    await js(page, "window.__hold = false"); await page.wait_for_timeout(200)
    post = await js(page, "({frozen: __mis.R.isFrozen(__mis.g, __mis.g.lastT), view: __mis.R.laserView(__mis.g, __mis.g.lastT), fx: __mis.fx.lasers.length + __mis.fx.sparks.length, fire: getComputedStyle(document.getElementById('fireBtn')).display, esc: getComputedStyle(document.getElementById('escBtn')).display})")
    out['after_esc'] = post; assert not post['frozen'] and post['view'] is None and post['fx'] == 0 and post['fire'] == 'none' and post['esc'] == 'none', post
    await js(page, "document.getElementById('stage').dispatchEvent(new PointerEvent('pointerup', {pointerId: 5, bubbles: true}))")
    await js(page, "window.__ap.ctrlAngle = null"); await js(page, AUTOPLAY_JS, {'zone': 2.8})
    REPORT.setdefault('laser', {})[label] = out

async def esc_test(page, label, shotname=None):
    n0 = await js(page, "__mis.g.frozenCount")
    await js(page, "window.__ap.ctrlAngle = 0")
    await page.wait_for_function(f"__mis.g.frozenCount > {n0}", timeout=40000)
    await page.wait_for_timeout(250)
    pre = await js(page, "(() => { const g = __mis.g, b = document.getElementById('escBtn'), r = b.getBoundingClientRect(); return {on: b.classList.contains('on'), display: getComputedStyle(b).display, x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, score: g.score, perfect: g.counts.perfect, good: g.counts.good, stray: g.counts.stray, frozen: __mis.R.isFrozen(g, g.lastT), left: g.frozenUntil - g.lastT, escapes: g.escapes}; })()")
    arrows = [await rect(page, s) for s in ('#aLU', '#aLD', '#aRU', '#aRD')]
    hud = [await rect(page, '#btnPause'), await rect(page, '#btnMute')]
    er = {'x': pre['x'], 'y': pre['y'], 'width': pre['w'], 'height': pre['h']}
    chk = dict(shown_while_frozen=pre['on'] and pre['display'] != 'none', size_ok=pre['w'] >= 56 and pre['h'] >= 56, inside=pre['x'] >= 0 and pre['y'] >= 0 and pre['x'] + pre['w'] <= pre['vw'] and pre['y'] + pre['h'] <= pre['vh'],
               clear_of_arrows=not any(rects_overlap(er, a) for a in arrows), clear_of_hud_buttons=not any(rects_overlap(er, h) for h in hud), frozen_remaining_s=round(pre['left'], 2))
    assert all(v for k, v in chk.items() if k != 'frozen_remaining_s') and pre['frozen'], (chk, pre)
    if shotname: await shot(page, shotname)
    pre2 = await js(page, "(() => { const g = __mis.g; return {left: g.frozenUntil - g.lastT, score: g.score}; })()")
    if pre2['left'] < 0.8: chk['note'] = 'freeze nearly over before the ESC tap (slow screenshot); test needs a fresh freeze'
    # real touch tap on the floating button
    cx, cy = pre['x'] + pre['w'] / 2, pre['y'] + pre['h'] / 2
    await js(page, "window.__ap.on = false")           # park the autoplayer so only the ESC tap changes the numbers
    s_before = await js(page, "__mis.g.score")
    await page.touchscreen.tap(cx, cy) if label.startswith(('iphone', 'pixel')) else await page.mouse.click(cx, cy)
    await page.wait_for_timeout(120)
    post = await js(page, "(() => { const g = __mis.g, b = document.getElementById('escBtn'); return {frozen: __mis.R.isFrozen(g, g.lastT), hidden: !b.classList.contains('on'), score: g.score, perfect: g.counts.perfect, good: g.counts.good, stray: g.counts.stray, escapes: g.escapes, tilt: __mis.R.tilt(g, g.lastT), state: __mis.state}; })()")
    chk.update(unfrozen_immediately=not post['frozen'], hidden_after=post['hidden'], escapes=post['escapes'], score_delta=post['score'] - s_before, tilt_after_deg=round(post['tilt'], 2),
               not_a_beat_tap=(post['perfect'], post['good'], post['stray']) == (pre['perfect'], pre['good'], pre['stray']), still_playing=post['state'] == 'play')
    assert chk['unfrozen_immediately'] and chk['hidden_after'] and chk['escapes'] == pre['escapes'] + 1 and chk['not_a_beat_tap'] and chk['still_playing'], (chk, post)
    assert -55 <= chk['score_delta'] <= -45 or s_before < 50, chk
    REPORT.setdefault('esc', {})[label] = chk
    await js(page, "document.getElementById('stage').dispatchEvent(new PointerEvent('pointerup', {pointerId: 5, bubbles: true}))")
    await js(page, AUTOPLAY_JS, {'zone': 2.8})          # resume the autoplayer

def attach(page, tag):
    page.on('console', lambda m: LOGS.append((tag, m.type, m.text)) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: LOGS.append((tag, 'pageerror', str(e))))
    page.on('requestfailed', lambda r: LOGS.append((tag, 'requestfailed', r.url)))

async def new_ctx(p, browser, kind):
    if kind == 'iphone':
        d = dict(p.devices['iPhone 13']); d['viewport'] = {'width': 390, 'height': 844}; d['screen'] = {'width': 390, 'height': 844}
    elif kind == 'pixel':
        d = dict(p.devices['Pixel 7']); d['viewport'] = {'width': 412, 'height': 915}
    elif kind == 'landscape':
        d = dict(p.devices['iPhone 13 landscape']); d['viewport'] = {'width': 844, 'height': 390}
    elif kind == 'desktop':
        d = dict(viewport={'width': 1280, 'height': 720}, device_scale_factor=1)
    elif kind == 'reduced':
        d = dict(p.devices['iPhone 13']); d['viewport'] = {'width': 390, 'height': 844}; d['reduced_motion'] = 'reduce'
    return await browser.new_context(**d)

KICK_PROBE_RATE_JS = """async (s) => {
  const buf = GameAudio.buffer, sr = buf.sampleRate, R = __mis.R;
  const trackSec = 24, n = Math.ceil(sr * trackSec / s);
  const oc = new OfflineAudioContext(1, n, sr), src = oc.createBufferSource(); src.buffer = buf; src.playbackRate.value = s; src.connect(oc.destination); src.start(0, 0);
  const d = (await oc.startRendering()).getChannelData(0);
  const lp = (x) => { const a = Math.exp(-2 * Math.PI * 300 / sr), y = new Float32Array(x.length); let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { s1 = a * s1 + (1 - a) * x[i]; s2 = a * s2 + (1 - a) * s1; y[i] = s2; } return y; };
  const nT = Math.floor(0.15 / s * sr), tm = new Float32Array(nT);               // the kick template, slowed down by s (tape-style)
  for (let i = 0, ph = 0; i < nT; i++) { const t = i / sr * s, f = (47 + 95 * Math.exp(-t / 0.05) + 220 * Math.exp(-t / 0.005)) * s; ph += 2 * Math.PI * f / sr;
    tm[i] = Math.sin(ph) * Math.exp(-t / 0.26) * Math.min(1, t / 0.0006); }
  const tl = lp(tm); let tn = 0; for (let i = 0; i < nT; i++) tn += tl[i] * tl[i]; tn = Math.sqrt(tn);
  const sig = lp(d);
  const errs = [];
  for (let bar = 4; bar < 12; bar++) {
    if (R.kickSteps(bar).indexOf(8) < 0) continue;
    const T = bar * R.BAR + 8 * R.SIX, c = Math.round(T / s * sr), lags = Math.round(0.045 / s * sr); let best = -2, bl = 0;
    for (let L = -lags; L <= lags; L++) { let num = 0, en = 0; const o = c + L;
      for (let i = 0; i < nT; i += 2) { const v = sig[o + i]; num += v * tl[i]; en += v * v; }
      const nc = num / (Math.sqrt(en * 2) * tn / Math.sqrt(2) + 1e-12); if (nc > best) { best = nc; bl = L; } }
    errs.push(bl / sr * s * 1000);                                                 // detected - scheduled, in SONG (track) ms
  }
  errs.sort((x, y) => x - y); const med = errs[Math.floor(errs.length / 2)];
  return { n: errs.length, rendered_sec: n / sr, median_song_ms: med, min_song_ms: errs[0], max_song_ms: errs[errs.length - 1], max_abs_dev_from_median_song_ms: Math.max(...errs.map(e => Math.abs(e - med))), max_abs_wall_ms: Math.max(...errs.map(e => Math.abs(e) / s)) };
}"""

CLOCK_JS = """(ms) => new Promise(res => { const a0 = GameAudio.songTime(), c0 = GameAudio.ctx.currentTime, w0 = performance.now();
  setTimeout(() => { const a1 = GameAudio.songTime(), c1 = GameAudio.ctx.currentTime, w1 = performance.now(); res({ song_per_wall: (a1 - a0) / ((w1 - w0) / 1000), ctx_per_wall: (c1 - c0) / ((w1 - w0) / 1000), wall_s: (w1 - w0) / 1000 }); }, ms); })"""

LOCK_WATCH_JS = """() => new Promise(res => { const g = __mis.g, R = __mis.R, lb = document.getElementById('lockBtn'); let tl0 = null, tw0 = null;
  let maxDev = 0, maxTwistDev = 0, first = null, unlocked = null, ready = null, cdBtnOn = false, readyBtnOn = false;
  const f = () => { const now = performance.now(), t = g.lastT, info = R.tiltLockInfo(g, t), locked = R.isTiltLocked(g, t);
    if (locked) { if (first === null) { first = now; tl0 = R.tilt(g, t); tw0 = g.twist; } maxDev = Math.max(maxDev, Math.abs(R.tilt(g, t) - tl0)); maxTwistDev = Math.max(maxTwistDev, Math.abs(g.twist - tw0)); }
    if (first !== null && !locked && unlocked === null) unlocked = now;
    if (info.state === 'cooldown' && lb.classList.contains('on')) cdBtnOn = true;
    if (unlocked !== null && info.state === 'ready' && ready === null) ready = now;
    if (ready !== null && lb.classList.contains('on')) { readyBtnOn = true; }
    if (ready !== null && now - ready > 120) { res({ lock_wall_s: (unlocked - first) / 1000, cooldown_wall_s: (ready - unlocked) / 1000, max_tilt_dev_deg: maxDev, max_twist_dev_deg: maxTwistDev, button_on_during_cooldown: cdBtnOn, button_on_when_ready: readyBtnOn, tilt_at_lock: tl0 }); return; }
    requestAnimationFrame(f); };
  f(); })"""

async def lock_test(page, cdp, label, shotname=None):
    """TILT LOCK on touch emulation: generous hit zone, not a beat tap, holds the tilt for 8 WALL seconds against real arrow input,
    cooldown (button inactive), usable again. Must run before the first target of the level (no judgments expected)."""
    lb = await rect(page, '#lockBtn')
    out = dict(button_rect=[round(lb['x']), round(lb['y']), round(lb['width']), round(lb['height'])])
    assert lb['on'] and lb['height'] >= 56 and lb['width'] >= 200, out
    vw = await js(page, "innerWidth"); assert lb['x'] >= 0 and lb['x'] + lb['width'] <= vw + 1, out
    hud = [await rect(page, '#btnPause'), await rect(page, '#btnMute')]
    arrows = [await rect(page, s) for s in ('#aLU', '#aLD', '#aRU', '#aRD')]
    out['no_overlap_hud_or_arrows'] = not any(rects_overlap(lb, r) for r in hud + arrows); assert out['no_overlap_hud_or_arrows'], out
    sums = "(() => { const c = __mis.g.counts; return [c.perfect, c.good, c.miss, c.stray, __mis.g.score]; })()"
    c0 = await js(page, sums)
    watch = asyncio.create_task(page.evaluate(LOCK_WATCH_JS))
    await page.wait_for_timeout(30)
    cx, cy = center(lb)
    await page.touchscreen.tap(cx, cy)
    await page.wait_for_timeout(80)
    c1 = await js(page, sums)
    out['locked_after_tap'] = await js(page, "__mis.R.isTiltLocked(__mis.g, __mis.g.lastT)")
    out['tap_is_not_a_beat_tap'] = c0 == c1
    assert out['locked_after_tap'] and out['tap_is_not_a_beat_tap'], (out, c0, c1)
    # real arrow thumb (CDP) held for ~1 s during the lock: must not change the tilt or the twist
    ar = await rect(page, '#aRD'); ax, ay = center(ar)
    await touch(cdp, 'touchStart', [{'x': ax, 'y': ay, 'id': 6}]); await page.wait_for_timeout(1000); await touch(cdp, 'touchEnd', [])
    # (2026-10-16: removed the old 'second tap does nothing' step - since the Oct 10 build a second tap on the marker RELEASES the lock
    #  by design (README: 'Tap the same marker again to let go early'), which made this 8 s check fail. Unrelated to tap-the-letter.)
    res = await watch
    out.update(res)
    out['relock_during_lock_ignored'] = res['lock_wall_s'] < 8.25
    sp = await js(page, "__mis.g.speed")
    assert abs(res['lock_wall_s'] - 8.0) < 0.25, out
    assert abs(res['cooldown_wall_s'] - 6.0) < 0.3, out
    assert res['max_tilt_dev_deg'] < 1e-6 and res['max_twist_dev_deg'] < 1e-6 and not res['button_on_during_cooldown'] and res['button_on_when_ready'], out
    # usable again, and the keyboard shortcut path through doLock
    out['key_L'] = False
    await page.keyboard.press('l'); await page.wait_for_timeout(100)
    out['key_L'] = await js(page, "__mis.R.isTiltLocked(__mis.g, __mis.g.lastT)")
    assert out['key_L'], out
    if shotname:
        await page.wait_for_timeout(150); await shot(page, shotname)       # the keyboard lock is still running: show the locked marker
    REPORT.setdefault('tilt_lock', {})[label] = out
    return out

async def slow_flow(p, browser, s, full=True):
    """GAME SPEED test on iPhone 13 touch emulation: settings cycle + persistence, playbackRate, clock rate, offline kick sync at the
    slowed rate, tilt lock, pause/resume, freeze/ESC wall-clock behaviour, full 3-level run, grade cap, no console errors."""
    tag = f'slow{int(s * 100)}'
    R_ = REPORT.setdefault('speed', {}).setdefault(str(s), {})
    ctx = await new_ctx(p, browser, 'iphone'); page = await ctx.new_page(); attach(page, tag)
    cdp = await ctx.new_cdp_session(page)
    await page.goto(URL + '?novideo=1'); await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
    await page.touchscreen.tap(195, 450); await wait_state(page, 'menu'); await page.wait_for_timeout(700)
    # ---- settings: cycle button + persistence
    await tap_btn(page, '#mSettings'); await page.wait_for_timeout(400)
    labels = [await js(page, "document.getElementById('setSpeed').textContent")]
    for i in range(3):
        if s != 1.0 and abs(await js(page, "__mis.settings.speed") - s) < 1e-9: break
        await tap_btn(page, '#setSpeed'); labels.append(await js(page, "document.getElementById('setSpeed').textContent"))       # for 100%: a full 100 -> 85 -> 70 -> 100 cycle
    R_['speed_button_labels'] = labels
    assert abs(await js(page, "__mis.settings.speed") - s) < 1e-9, labels
    if s < 1: assert 'SLOW' in labels[-1], labels      # 2026-10-16: label is now 'SLOW, MUSIC MUTED' (Oct 10 build), was 'SLOW MODE'
    await page.wait_for_timeout(300)
    if s == 0.85: await shot(page, '28-settings-speed.png')
    stored = await js(page, "JSON.parse(localStorage.getItem('misaligned.settings.v1')).speed")
    R_['persisted_in_localStorage'] = stored; assert abs(stored - s) < 1e-9
    await page.reload(); await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
    R_['speed_after_reload'] = await js(page, "__mis.settings.speed"); assert abs(R_['speed_after_reload'] - s) < 1e-9
    await page.touchscreen.tap(195, 450); await wait_state(page, 'menu'); await page.wait_for_timeout(700)
    await page.wait_for_function("window.GameAudio.buffer !== null", timeout=20000)
    # ---- START -> level 1 at speed s
    await start_direct(page, tag)
    a = await js(page, "({mode: GameAudio.mode, rate: GameAudio.rate, srcRate: GameAudio.rateNode() && GameAudio.rateNode().value, gspeed: __mis.g.speed, win: __mis.g.win})")
    R_['audio'] = a
    assert a['mode'] == 'webaudio' and abs(a['srcRate'] - s) < 1e-6 and abs(a['rate'] - s) < 1e-9 and abs(a['gspeed'] - s) < 1e-9, a
    # ---- tilt lock (before the first target, so no judgments interfere)
    await js(page, "__mis.g.twist = 0")
    await page.wait_for_function("__mis.levelT() > 0.4", timeout=10000)
    await lock_test(page, cdp, tag, {1.0: '30-tilt-lock.png', 0.85: '34-tilt-lock-slow85.png'}.get(s))
    # ---- song clock runs at s song-seconds per wall second
    clk = await js(page, CLOCK_JS, 2000)
    R_['clock'] = clk
    assert abs(clk['song_per_wall'] / s - 1) < 0.03 and abs(clk['ctx_per_wall'] - 1) < 0.03, clk
    # ---- slowed audio vs scheduled kicks (offline render with playbackRate s, matched filter)
    kp = await js(page, KICK_PROBE_RATE_JS, s)
    R_['kick_sync_offline'] = kp
    assert kp['n'] >= 5 and kp['max_abs_dev_from_median_song_ms'] < 6, kp
    # ---- pause / resume at speed
    await js(page, "__mis.pauseGame()"); await page.wait_for_timeout(500)
    p0 = await js(page, "__mis.g.lastT"); await page.wait_for_timeout(900); p1 = await js(page, "__mis.g.lastT")
    lab0 = await js(page, "document.getElementById('pSpeed').textContent")
    nxt = [x for x in (1, 0.85, 0.7) if abs(x - s) > 1e-9][0]
    await tap_btn(page, '#pSpeed'); await page.wait_for_timeout(200)
    mid = await js(page, "({set: __mis.settings.speed, gspeed: __mis.g.speed, arate: GameAudio.rate, lab: document.getElementById('pSpeed').textContent})")
    if s == 0.85: await shot(page, '35-pause-speed.png')
    for _ in range(3):
        if abs(await js(page, "__mis.settings.speed") - s) < 1e-9: break
        await tap_btn(page, '#pSpeed'); await page.wait_for_timeout(150)
    assert abs(mid['gspeed'] - s) < 1e-9 and abs(mid['arate'] - s) < 1e-9, mid           # the running level keeps its speed
    await tap_btn(page, '#pResume'); await wait_state(page, 'play'); await page.wait_for_timeout(300)
    clk2 = await js(page, CLOCK_JS, 1500)
    R_['pause'] = dict(frozen_during_pause=abs(p1 - p0) < 0.01, label=lab0, label_after_change=mid['lab'], level_speed_unchanged_by_pause_button=True, clock_after_resume=clk2)
    assert abs(p1 - p0) < 0.01 and abs(clk2['song_per_wall'] / s - 1) < 0.04, R_['pause']
    # ---- restart cleanly through the pause menu
    await js(page, "__mis.pauseGame()"); await page.wait_for_timeout(400); await tap_btn(page, '#pRestart'); await wait_state(page, 'play'); await page.wait_for_timeout(500)
    assert await js(page, "__mis.g.L.id") == 1 and abs(await js(page, "__mis.g.speed") - s) < 1e-9
    if not full:
        await ctx.close(); return
    await js(page, AUTOPLAY_JS, {'zone': 2.8})
    await page.wait_for_function("__mis.g && __mis.levelT() > 9", timeout=40000)
    await shot(page, '29-slow-play.png' if s == 0.85 else f'29b-slow{int(s*100)}-play.png')
    # ---- freeze lasts 3 WALL seconds when it runs out by itself
    if s <= 0.7: await laser_test(page, f'{tag}-touch')
    n_f = await js(page, "__mis.g.frozenCount")
    await js(page, "window.__ap.ctrlAngle = 0")
    await page.wait_for_function(f"__mis.g.frozenCount > {n_f}", timeout=40000)
    fw = await page.evaluate("() => new Promise(res => { const g = __mis.g; let t0 = null; const f = () => { const fr = __mis.R.isFrozen(g, g.lastT); if (fr && t0 === null) t0 = performance.now(); if (t0 !== null && !fr) { res((performance.now() - t0) / 1000); return; } requestAnimationFrame(f); }; f(); })")
    R_['freeze_wall_s'] = fw; assert abs(fw - 3.0) < 0.3, fw
    await js(page, "window.__ap.ctrlAngle = null")
    await page.wait_for_timeout(600)
    await js(page, "window.__ap.ctrlAngle = null")
    await esc_test(page, f'{tag}-touch')
    # ---- finish level 1, then levels 2 and 3
    await wait_state(page, 'result', timeout=120000); await page.wait_for_timeout(700)
    R_['l1'] = await js(page, "__mis.session.results[0]")
    assert R_['l1']['speed'] == s
    await js(page, "window.__ap.on = false")
    await tap_btn(page, '#resNext'); await wait_state(page, 'intro'); await tap_btn(page, '#introGo'); await wait_state(page, 'play')
    await js(page, AUTOPLAY_JS, {'zone': 2.6, 'jitter': 0.05})
    await wait_state(page, 'result', timeout=150000); await page.wait_for_timeout(600)
    R_['l2'] = await js(page, "__mis.session.results[1]")
    await js(page, "window.__ap.on = false")
    await tap_btn(page, '#resNext'); await wait_state(page, 'intro'); await tap_btn(page, '#introGo'); await wait_state(page, 'play')
    await js(page, AUTOPLAY_JS, {'zone': 2.6, 'jitter': 0.03})
    await wait_state(page, 'result', timeout=150000); await page.wait_for_timeout(600)
    await js(page, "window.__ap.on = false")
    R_['l3'] = await js(page, "__mis.session.results[2]")
    resrows = await js(page, "document.getElementById('resKv').innerText")
    assert 'SLOW MODE' in resrows, resrows
    await tap_btn(page, '#resNext'); await wait_state(page, 'final'); await page.wait_for_timeout(700)
    R_['final'] = await js(page, "__mis.R.grade(__mis.session.results)")
    R_['final_text'] = await js(page, "document.getElementById('finSlow').textContent + ' | ' + document.getElementById('finKv').innerText")
    assert 'SLOW MODE' in R_['final_text'] and R_['final']['grade'] in ('A', 'B', 'C', 'D') and R_['final']['slow'], R_['final']
    if s == 0.85: await shot(page, '33-slow-final.png')
    await tap_btn(page, '#finCredits'); await wait_state(page, 'credits'); await page.wait_for_timeout(1500)
    R_['credits_slow_line'] = await js(page, "document.getElementById('crSlow').innerText")
    assert 'SLOW MODE' in R_['credits_slow_line']
    R_['level_wall_seconds_expected'] = round(38.7 / s, 1)
    await ctx.close()

RMS_JS = """(ms) => new Promise(res => { const A = GameAudio; if (!window.__an) { window.__an = A.ctx.createAnalyser(); window.__an.fftSize = 1024; A.gain.connect(window.__an); }
  const an = window.__an, buf = new Float32Array(an.fftSize), vals = [], t0 = performance.now();
  const f = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; vals.push(Math.sqrt(s / buf.length));
    if (performance.now() - t0 < ms) setTimeout(f, 16); else { vals.sort((a, b) => a - b); res({ n: vals.length, median: vals[Math.floor(vals.length / 2)], p95: vals[Math.floor(vals.length * 0.95)], max: vals[vals.length - 1] }); } };
  f(); })"""

async def music_flow(p, browser, s):
    """MUSIC OFF / SFX ON on iPhone 13 touch: toggles + persistence, music gain 0 while SFX gain 1 and SFX still audible (analyser on the
    master bus), beat clock still advances at s, targets still judged, beat tick schedules on the beat, HUD + pause toggles, title video untouched."""
    tag = f'music{int(s * 100)}'
    R_ = REPORT.setdefault('music_off', {}).setdefault(str(s), {})
    ctx = await new_ctx(p, browser, 'iphone'); page = await ctx.new_page(); attach(page, tag)
    await page.goto(URL + '?novideo=1'); await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
    await page.touchscreen.tap(195, 450); await wait_state(page, 'menu'); await page.wait_for_timeout(700)
    await page.wait_for_function("window.GameAudio.buffer !== null", timeout=20000)
    await tap_btn(page, '#mSettings'); await page.wait_for_timeout(400)
    if s < 1:
        for _ in range(3):
            if abs(await js(page, "__mis.settings.speed") - s) < 1e-9: break
            await tap_btn(page, '#setSpeed')
    await tap_btn(page, '#setMusic'); await page.wait_for_timeout(300)
    lab = await js(page, "[document.getElementById('setMusic').textContent, document.getElementById('setSfx').textContent, document.getElementById('setTick').textContent]")
    R_['labels'] = lab; assert lab[0].startswith('MUSIC: OFF') and lab[1] == 'SFX: ON' and lab[2] == 'BEAT TICK: OFF', lab
    if s == 1.0: await shot(page, '32-music-off-settings.png')
    st = await js(page, "JSON.parse(localStorage.getItem('misaligned.settings.v1'))"); R_['persisted'] = st
    assert st['music'] is False and st['sfx'] is True and st['tick'] is False, st
    await page.reload(); await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
    assert await js(page, "__mis.settings.music") is False, 'music setting must persist across reload'
    await page.touchscreen.tap(195, 450); await wait_state(page, 'menu'); await page.wait_for_timeout(700)
    await page.wait_for_function("window.GameAudio.buffer !== null", timeout=20000)
    vid = await js(page, "(() => { const v = document.getElementById('titleVideo'); return {muted: v.muted, vol: v.volume, master: __mis.settings.muted}; })()")
    R_['title_video_follows_master_only'] = vid; assert vid['muted'] == vid['master'], vid
    await start_direct(page, tag)
    await page.wait_for_timeout(400)
    g = await js(page, "({music: GameAudio.musicGain.gain.value, sfx: GameAudio.sfxGain.gain.value, rate: GameAudio.rateNode().value, playing: GameAudio.playing, speed: __mis.g.speed})")
    R_['gains'] = g; assert g['music'] < 0.01 and g['sfx'] > 0.99 and g['playing'] and abs(g['rate'] - s) < 1e-6, g
    # HUD: note button next to the speaker, >= 48 px, not overlapping the other HUD buttons
    nb, mb, pb = await rect(page, '#btnMusic'), await rect(page, '#btnMute'), await rect(page, '#btnPause')
    R_['hud'] = dict(music_btn=[round(nb['x']), round(nb['y']), round(nb['width']), round(nb['height'])]); assert nb['on'] and nb['width'] >= 48 and nb['height'] >= 48 and not rects_overlap(nb, mb) and not rects_overlap(nb, pb), R_['hud']
    await js(page, "window.__mix = 1"); await shot(page, '36-music-off-hud.png') if s == 1.0 else None
    # clock advances at s with the music silenced
    clk = await js(page, CLOCK_JS, 1500); R_['clock'] = clk; assert abs(clk['song_per_wall'] / s - 1) < 0.03, clk
    # judged with the autoplayer; measure the master bus: silent between blips, blips audible
    await js(page, AUTOPLAY_JS, {'zone': 2.8})
    await page.wait_for_function("__mis.levelT() > 3.5", timeout=30000)
    rms_off = await js(page, RMS_JS, 4000); R_['rms_music_off'] = rms_off
    c = await js(page, "__mis.g.counts"); R_['counts'] = c
    assert c['perfect'] >= 3, c
    assert rms_off['median'] < 0.004 and rms_off['max'] > 0.004, rms_off                  # silent bed, blips audible
    # beat tick: scheduled on the beat at any speed
    await js(page, "(() => { const A = GameAudio, o = A.tick; window.__ticks = []; A.tick = (tb, acc) => { const r = o(tb, acc); if (r) window.__ticks.push(tb); return r; }; __mis.settings.tick = true; })()")
    await page.wait_for_timeout(4000)
    ticks = await js(page, "window.__ticks"); await js(page, "__mis.settings.tick = false")
    exp = 4 * s * 124 / 60
    gaps = [round(b - a, 4) for a, b in zip(ticks, ticks[1:])]
    R_['tick'] = dict(count=len(ticks), expected=round(exp, 1), beat_gaps_unique=sorted(set(gaps))[:3]); assert abs(len(ticks) - exp) <= 3 and all(abs(x - 60 / 124) < 0.002 for x in gaps), R_['tick']
    # HUD note button turns the music back on (touch), music audible again, then the pause-screen button turns it off again
    await page.touchscreen.tap(*center(nb)); await page.wait_for_timeout(500)
    assert await js(page, "__mis.settings.music") is True
    rms_on = await js(page, RMS_JS, 2500); R_['rms_music_on'] = rms_on; assert s < 1 or rms_on['median'] > max(0.01, 5 * rms_off['median']), (rms_on, rms_off)   # 2026-10-16: slow mode keeps the song muted for the level by design (Oct 10 build)
    await js(page, "__mis.pauseGame()"); await page.wait_for_timeout(500)
    pm = await rect(page, '#pMusic'); R_['pause_button'] = await js(page, "document.getElementById('pMusic').textContent"); assert pm['on'] and pm['height'] >= 44
    if s == 1.0: await shot(page, '37-pause-music.png')
    await tap_btn(page, '#pMusic'); await page.wait_for_timeout(200)
    assert await js(page, "__mis.settings.music") is False and (await js(page, "GameAudio.musicGain.gain.value")) < 0.05
    await tap_btn(page, '#pResume'); await wait_state(page, 'play'); await page.wait_for_timeout(400)
    clk2 = await js(page, CLOCK_JS, 1200); R_['clock_after_resume'] = clk2; assert abs(clk2['song_per_wall'] / s - 1) < 0.04, clk2
    await ctx.close()

LOOP_MON_JS = """() => { const A = GameAudio, m = window.__lm = { maxJumpSongMs: 0, maxJumpWallMs: 0, maxLevelJumpMs: 0, wraps: 0, n: 0, lu: null, lw: null, lp: null, ll: null, wrapAt: [], all: [] };
  const f = () => { const u = A.songTime(true), w = A.songTime(), p = performance.now(), L = __mis.levelT();
    if (u != null && __mis.state === 'play' && !A.paused) {
      if (m.lu != null && m.lp != null && p - m.lp < 100) {
        const j = Math.abs((u - m.lu) - (p - m.lp) / 1000 * A.rate) * 1000; m.maxJumpSongMs = Math.max(m.maxJumpSongMs, j); m.all.push([+L.toFixed(3), +j.toFixed(2)]); m.maxJumpWallMs = Math.max(m.maxJumpWallMs, j / A.rate);
        m.maxLevelJumpMs = Math.max(m.maxLevelJumpMs, Math.abs((L - m.ll) - (p - m.lp) / 1000 * A.rate) * 1000);
        if (w < m.lw - 1) { m.wraps++; m.wrapAt.push(+L.toFixed(3)); }
      }
      m.lu = u; m.lw = w; m.lp = p; m.ll = L; m.n++;
    } else { m.lu = null; m.lp = null; }
    if (!m.stop) requestAnimationFrame(f); };
  f(); }"""

REC_JS = """(ms) => new Promise(res => { const A = GameAudio, ctx = A.ctx, ch = A.chain; if (!ch) { res({error: 'no chain'}); return; }
  const sp = ctx.createScriptProcessor(2048, 1, 1), chunks = [], times = []; ch.bus.connect(sp); sp.connect(ctx.destination);
  sp.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); times.push(e.playbackTime); };
  setTimeout(() => { try { ch.bus.disconnect(sp); sp.disconnect(); } catch (e) {} sp.onaudioprocess = null;
    const sr = ctx.sampleRate, N = chunks.length * 2048, x = new Float32Array(N); chunks.forEach((c, i) => x.set(c, i * 2048));
    // join times (ctx seconds) of the loop point: end of the first segment + k * loop length
    const len = (ch.le - ch.ls) / ch.rate, first = A.startCtx + (ch.le - A.startOff) / ch.rate; const joins = [];
    for (let k = 0; first + k * len < times[times.length - 1] + 0.1; k++) if (first + k * len > times[0] + 0.1) joins.push(first + k * len);
    const lat = (times[0] - 0) ; void lat;
    const d2 = new Float32Array(N); for (let i = 2; i < N; i++) d2[i] = Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]);
    const t0 = times[0] - 2048 / sr * 0, near = new Uint8Array(N); let jn = 0;
    for (const j of joins) { const c = Math.round((j - t0) * sr); for (let i = Math.max(0, c - 0.12 * sr); i < Math.min(N, c + 0.12 * sr); i++) near[i] = 1; jn++; }
    let mj = 0, mo = 0, sil = 0; for (let i = 2; i < N; i++) { if (near[i]) mj = Math.max(mj, d2[i]); else mo = Math.max(mo, d2[i]); if (Math.abs(x[i]) < 1e-6) sil++; }
    res({ samples: N, sr, joins: joins.length, max_d2_near_loop_join: mj, max_d2_elsewhere: mo, silent_frac: sil / N, peak: x.reduce((a, v) => Math.max(a, Math.abs(v)), 0) });
  }, ms); })"""

async def nolimit_flow(p, browser, s, music_off=False):
    """NO TIME LIMIT (practice) on iPhone 13 touch: menu + settings entries, loop is clean (clock wraps, no jump > a few ms, no click),
    targets keep coming after the loop point and are judged, pause/resume, EXIT, NEW ZERO SET offer -> STAY -> CONTINUE, result tagged,
    next level stays in the mode. Uses a shortened level 1 (6 bars) so several loop passes fit in the test; the full-length level is covered by rules tests."""
    tag = f'nolimit{int(s * 100)}' + ('-musicoff' if music_off else '')
    R_ = REPORT.setdefault('no_limit', {}).setdefault(tag, {})
    ctx = await new_ctx(p, browser, 'iphone'); page = await ctx.new_page(); attach(page, tag)
    await page.goto(URL + '?novideo=1'); await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
    await page.touchscreen.tap(195, 450); await wait_state(page, 'menu'); await page.wait_for_timeout(700)
    await page.wait_for_function("window.GameAudio.buffer !== null", timeout=20000)
    pr = await rect(page, '#mPractice'); R_['menu_button'] = dict(rect=[round(pr['x']), round(pr['y']), round(pr['width']), round(pr['height'])], text=await js(page, "document.getElementById('mPractice').textContent"))
    assert pr['on'] and pr['height'] >= 44 and 'NO TIME LIMIT' in R_['menu_button']['text'], R_
    if s == 1.0 and not music_off: await shot(page, '40-menu-practice.png')
    # settings: MODE button cycles + persists; STANDARD START is unaffected
    await tap_btn(page, '#mSettings'); await page.wait_for_timeout(400)
    t0 = await js(page, "document.getElementById('setMode').textContent"); await tap_btn(page, '#setMode'); await page.wait_for_timeout(250)
    t1 = await js(page, "document.getElementById('setMode').textContent"); st = await js(page, "JSON.parse(localStorage.getItem('misaligned.settings.v1')).mode")
    R_['settings_mode'] = [t0, t1, st]; assert t0 == 'MODE: STANDARD' and t1 == 'MODE: NO TIME LIMIT' and st == 'nolimit', R_
    await tap_btn(page, '#setMode'); await page.wait_for_timeout(200)
    assert await js(page, "__mis.settings.mode") == 'standard'
    if s < 1:
        for _ in range(3):
            if abs(await js(page, "__mis.settings.speed") - s) < 1e-9: break
            await tap_btn(page, '#setSpeed')
    if music_off: await tap_btn(page, '#setMusic'); await page.wait_for_timeout(200)
    await tap_btn(page, '#setBack'); await wait_state(page, 'menu'); await page.wait_for_timeout(500)
    # START in STANDARD is a normal level; then back and PRACTICE
    await tap_btn(page, '#mStart'); await wait_state(page, 'play'); await page.wait_for_timeout(500)
    assert await js(page, "__mis.g.noLimit") is False and await js(page, "__mis.g.orbsOn") is True
    await js(page, "__mis.pauseGame()"); await page.wait_for_timeout(300)
    assert not (await rect(page, '#pExit'))['on'] and (await rect(page, '#pQuit'))['on'], 'standard pause shows QUIT, not EXIT PRACTICE'
    await tap_btn(page, '#pQuit'); await wait_state(page, 'menu'); await page.wait_for_timeout(600)
    await js(page, "__mis.R.LEVELS[0].endBar = 6")                                  # shortened level 1: a 6-bar (11.6 s) loop
    await tap_btn(page, '#mPractice'); await wait_state(page, 'play'); await page.wait_for_timeout(600)
    g0 = await js(page, "({nl: __mis.g.noLimit, mode: __mis.session.mode, level: __mis.g.L.id, speed: __mis.g.speed, chain: !!GameAudio.chain, loop: GameAudio.loop, rate: GameAudio.rate, musicGain: GameAudio.musicGain.gain.value})")
    R_['start'] = g0; assert g0['nl'] and g0['mode'] == 'nolimit' and g0['chain'] and abs(g0['rate'] - s) < 1e-6 and (g0['musicGain'] < 0.01) == music_off, g0
    await js(page, "window.__lm = null"); await js(page, LOOP_MON_JS)
    rec = asyncio.create_task(page.evaluate(REC_JS, int(11.6 / s * 2.15 * 1000)))      # ~2 loop joins on the recorded bus
    await js(page, AUTOPLAY_JS, {'zone': 8.0 if False else 5.5, 'ctrlAngle': None})  # a tilt outside the zero zone: practice keeps going, no zero set yet
    await page.wait_for_function("__mis.levelT() > 11.6 + 1.0", timeout=60000)         # past the first loop point
    c1 = await js(page, "({...__mis.g.counts, passes: __mis.g.passes, t: __mis.levelT(), done: __mis.g.done})")
    await page.wait_for_function("__mis.levelT() > 2 * 11.6 + 3.0", timeout=60000)
    await shot(page, '38-nolimit.png') if (s == 1.0 and not music_off) else None
    c2 = await js(page, "({...__mis.g.counts, passes: __mis.g.passes, t: __mis.levelT(), done: __mis.g.done, nextT: (__mis.nextTargetIn() || {}).dt})")
    lm = await js(page, "(() => { const m = window.__lm; return {maxJumpSongMs: m.maxJumpSongMs, maxJumpWallMs: m.maxJumpWallMs, maxLevelJumpMs: m.maxLevelJumpMs, wraps: m.wraps, wrapAt: m.wrapAt, frames: m.n, all: m.all}; })()")
    R_['loop_clock'] = lm; R_['after_first_loop'] = c1; R_['after_second_loop'] = c2
    allj = lm.pop('all'); near = [j for L_, j in allj if any(abs(L_ - w) < 0.15 for w in lm['wrapAt'])]; far = [j for L_, j in allj if not any(abs(L_ - w) < 0.15 for w in lm['wrapAt'])]
    lm['max_jump_ms_near_loop_point'] = max(near) if near else None; lm['max_jump_ms_elsewhere'] = max(far); lm['median_jump_ms'] = sorted(far)[len(far) // 2]
    # the clock is derived from the audio clock, so the loop point cannot add a step: whatever frame jitter exists elsewhere is all there is at the wrap
    assert lm['wraps'] >= 2 and near and max(near) <= max(far) + 1.0 and lm['maxJumpWallMs'] < 20 and lm['median_jump_ms'] < 6, lm
    assert not c1['done'] and not c2['done'] and c2['passes'] >= 3, (c1, c2)
    assert (c2['perfect'] + c2['good']) > (c1['perfect'] + c1['good']) >= 3, ('targets keep being judged after the loop point', c1, c2)
    assert c2['nextT'] is not None and c2['nextT'] < 12, c2                               # more targets are always ahead
    wrap = [round(b - a, 3) for a, b in zip(lm['wrapAt'], lm['wrapAt'][1:])]
    R_['wrap_spacing_level_s'] = wrap; assert all(abs(w - 11.6129) < 0.08 for w in wrap), wrap     # wraps exactly one 6-bar loop apart
    r = await rec; R_['audio_join'] = r
    if 'error' not in r:
        assert r['joins'] >= 2 and r['peak'] > 0.05, r
        assert r['max_d2_near_loop_join'] <= max(1.25 * r['max_d2_elsewhere'], 0.02), ('loop join is not louder in discontinuity than the music itself', r)
    # pause / resume inside a later pass: the level clock stands still and resumes without a jump
    await js(page, "__mis.pauseGame()"); await page.wait_for_timeout(300)
    a = await js(page, "__mis.g.lastT"); await page.wait_for_timeout(900); b = await js(page, "__mis.g.lastT")
    ex = await rect(page, '#pExit'); qt = await rect(page, '#pQuit'); R_['pause'] = dict(exit_visible=ex['on'], quit_hidden=not qt['on'], exit_text=await js(page, "document.getElementById('pExit').textContent"), frozen=abs(b - a) < 0.01)
    assert ex['on'] and not qt['on'] and abs(b - a) < 0.01 and ex['height'] >= 44, R_['pause']
    await shot(page, '41-pause-exit-practice.png') if (s == 1.0 and not music_off) else None
    await js(page, "window.__lm.maxJumpWallMs = 0")
    await tap_btn(page, '#pResume'); await wait_state(page, 'play'); await page.wait_for_timeout(700)
    lm2 = await js(page, "({maxJump: window.__lm.maxJumpWallMs, t: __mis.levelT(), last: __mis.g.lastT})"); R_['after_resume'] = lm2
    assert lm2['t'] > b + 0.3 and lm2['maxJump'] < 20 and abs(lm2['t'] - b) < 1.5, lm2
    # EXIT leaves to the menu without a result
    await js(page, "window.__lm.stop = true"); await js(page, "window.__ap.on = false")
    await js(page, "__mis.pauseGame()"); await page.wait_for_timeout(300); await tap_btn(page, '#pExit'); await wait_state(page, 'menu'); await page.wait_for_timeout(400)
    ex = await js(page, "({results: __mis.session.results.length, chain: GameAudio.chain, running: !!__mis.g && !__mis.g.done})")
    R_['exit'] = ex; assert ex['results'] == 0 and ex['chain'] is None, ex
    # ---- zero set: offer CONTINUE / STAY
    await tap_btn(page, '#mPractice'); await wait_state(page, 'play'); await page.wait_for_timeout(500)
    await js(page, AUTOPLAY_JS, {'zone': 2.8})
    await wait_state(page, 'zeroset', timeout=90000); await page.wait_for_timeout(700)
    zs = await js(page, "({offer: __mis.g.offer, paused: GameAudio.paused, done: __mis.g.done, zeroSet: __mis.g.zeroSet, t: __mis.g.lastT, score: __mis.g.score, title: document.getElementById('zsBig').textContent, cont: document.getElementById('zsContinue').textContent})")
    R_['zeroset_offer'] = zs; assert zs['offer'] and zs['paused'] and not zs['done'] and zs['zeroSet'], zs
    await shot(page, '39-nolimit-zeroset.png') if (s == 1.0 and not music_off) else None
    sb = await rect(page, '#zsStay'); cb = await rect(page, '#zsContinue'); assert sb['on'] and cb['on'] and sb['height'] >= 48 and cb['height'] >= 48
    await js(page, "window.__ap.on = false")
    await tap_btn(page, '#zsStay'); await wait_state(page, 'play'); await page.wait_for_timeout(500)
    st = await js(page, "({offer: __mis.g.offer, zone: __mis.g.zone, zeroSet: __mis.g.zeroSet, done: __mis.g.done, paused: GameAudio.paused})"); R_['after_stay'] = st
    assert not st['offer'] and st['zone'] < 1.0 and not st['zeroSet'] and not st['done'] and not st['paused'], st
    await js(page, AUTOPLAY_JS, {'zone': 2.8})
    await wait_state(page, 'zeroset', timeout=90000); await page.wait_for_timeout(300)
    assert await js(page, "__mis.g.zeroSets") >= 2
    await js(page, "window.__ap.on = false")
    await tap_btn(page, '#zsContinue'); await wait_state(page, 'result', timeout=20000); await page.wait_for_timeout(500)
    rs = await js(page, "({title: document.getElementById('resTitle').textContent, kv: document.getElementById('resKv').textContent, res: __mis.session.results[0]})"); R_['result'] = rs
    assert 'NO LIMIT' in rs['title'] and 'NO LIMIT' in rs['kv'] and rs['res']['noLimit'] and rs['res']['zeroSet'], rs
    if s == 1.0 and not music_off: await shot(page, '42-nolimit-result.png')
    # NEXT LEVEL stays in NO TIME LIMIT; the final grade is capped at B
    await tap_btn(page, '#resNext'); await wait_state(page, 'intro'); await tap_btn(page, '#introGo'); await wait_state(page, 'play'); await page.wait_for_timeout(500)
    nl2 = await js(page, "({nl: __mis.g.noLimit, level: __mis.g.L.id, chain: !!GameAudio.chain})"); R_['next_level'] = nl2; assert nl2['nl'] and nl2['level'] == 2 and nl2['chain'], nl2
    gr = await js(page, "__mis.R.grade([1,2,3].map(() => ({targets: 40, acc: 0.97, zeroSet: true, frozen: 0, score: 1000, speed: __mis.g.speed, noLimit: true})))"); R_['grade_cap'] = gr
    assert gr['grade'] == 'B' and gr['nlCapped'], gr
    await ctx.close()

STEER_JS = """() => { if (window.__orbSteer) clearInterval(window.__orbSteer);
  window.__orbSteer = setInterval(() => { const g = __mis.g, ap = window.__ap; if (!g || !ap || __mis.state !== 'play') return;
    const t = g.lastT, o = g.orbs.find(x => x.state === 'pending'); let want = null;
    if (o) { const wall = (o.T - t) / g.speed; if (wall < 3.4 && wall > -0.45) want = o.i === 0 ? o.theta : -Math.sign(o.theta) * 2.8; }   // catch orb 0, steer AWAY from orb 1
    ap.ctrlAngle = want; }, 25); }"""

CATCH_WATCH_JS = """() => new Promise(res => { const g = __mis.g, R = __mis.R; let prev = null, n0 = g.orbsCaught;
  const f = () => { const tl = R.timeLeft(g, g.lastT);
    if (g.orbsCaught > n0) { res({ before: prev, after: tl, delta: tl - prev, endAt: g.endAt, dur: g.dur, extraWall: g.extraWall, t: g.lastT }); return; }
    prev = tl; requestAnimationFrame(f); }; f(); })"""

async def orb_flow(p, browser, s):
    """ENERGY ORBS on iPhone 13 touch at speed s: toggle + persistence, orbs off => none, an auto-player steers the tilt to catch orb 0 (and avoids orb 1):
    timer +10 wall seconds, '+10s' feedback, the level continues past the ORIGINAL end (bars loop) and ends at the extended clock, taps unaffected."""
    tag = f'orbs{int(s * 100)}'
    R_ = REPORT.setdefault('energy_orbs', {}).setdefault(tag, {})
    ctx = await new_ctx(p, browser, 'iphone'); page = await ctx.new_page(); attach(page, tag)
    await page.goto(URL + '?novideo=1'); await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
    await page.touchscreen.tap(195, 450); await wait_state(page, 'menu'); await page.wait_for_timeout(700)
    await page.wait_for_function("window.GameAudio.buffer !== null", timeout=20000)
    await tap_btn(page, '#mSettings'); await page.wait_for_timeout(400)
    lab = []
    lab.append(await js(page, "document.getElementById('setOrbs').textContent")); await tap_btn(page, '#setOrbs'); await page.wait_for_timeout(250)
    lab.append(await js(page, "document.getElementById('setOrbs').textContent")); st = await js(page, "JSON.parse(localStorage.getItem('misaligned.settings.v1')).orbs")
    R_['toggle'] = [lab, st]; assert lab == ['ENERGY ORBS: ON', 'ENERGY ORBS: OFF'] and st is False, R_
    if s == 1.0:
        await tap_btn(page, '#setBack'); await wait_state(page, 'menu'); await page.wait_for_timeout(400)
        await tap_btn(page, '#mStart'); await wait_state(page, 'play'); await page.wait_for_timeout(500)
        off = await js(page, "({orbsOn: __mis.g.orbsOn, n: __mis.g.orbs.length, chain: !!GameAudio.chain, view: __mis.R.orbView(__mis.g, __mis.g.lastT)})"); R_['orbs_off'] = off
        assert not off['orbsOn'] and off['n'] == 0 and not off['chain'] and off['view'] is None, off
        await js(page, "__mis.pauseGame()"); await page.wait_for_timeout(300); await tap_btn(page, '#pQuit'); await wait_state(page, 'menu'); await page.wait_for_timeout(400)
        await tap_btn(page, '#mSettings'); await page.wait_for_timeout(400); await tap_btn(page, '#setOrbs'); await page.wait_for_timeout(250)
        assert await js(page, "__mis.settings.orbs") is True
    if s != 1.0 and await js(page, "__mis.settings.orbs") is False: await tap_btn(page, '#setOrbs'); await page.wait_for_timeout(250)
    assert await js(page, "__mis.settings.orbs") is True
    if s < 1:
        for _ in range(3):
            if abs(await js(page, "__mis.settings.speed") - s) < 1e-9: break
            await tap_btn(page, '#setSpeed')
    await tap_btn(page, '#setBack'); await wait_state(page, 'menu'); await page.wait_for_timeout(400)
    await tap_btn(page, '#mStart'); await wait_state(page, 'play'); await page.wait_for_timeout(500)
    g0 = await js(page, "({orbsOn: __mis.g.orbsOn, orbs: __mis.g.orbs.map(o => [+o.T.toFixed(2), +o.theta.toFixed(2), o.inside]), dur: __mis.g.dur, speed: __mis.g.speed, chain: !!GameAudio.chain, rate: GameAudio.rate})")
    R_['start'] = g0; assert g0['orbsOn'] and len(g0['orbs']) == 2 and g0['chain'] and abs(g0['speed'] - s) < 1e-9 and abs(g0['rate'] - s) < 1e-6, g0
    dur = g0['dur']; T0 = g0['orbs'][0][0]
    await js(page, AUTOPLAY_JS, {'zone': 2.8}); await js(page, STEER_JS)
    # orb 0 approaching: lane + catcher on screen (screenshot)
    await page.wait_for_function("(() => { const g = __mis.g, o = g.orbs[0]; return (o.T - g.lastT) / g.speed < 1.5 && (o.T - g.lastT) / g.speed > 0.9; })()", timeout=60000)
    v = await js(page, "__mis.R.orbView(__mis.g, __mis.g.lastT).orbs[0]"); R_['approach_view'] = v; assert v['flying'] and 0.4 < v['k'] < 0.95 and v['state'] == 'pending', v
    if s == 1.0: await shot(page, '43-energy-orb.png')
    watch = await js(page, CATCH_WATCH_JS)
    t_catch = time.time(); R_['catch'] = watch
    assert 9.8 <= watch['delta'] <= 10.1 and abs(watch['extraWall'] - 10) < 1e-9 and abs(watch['endAt'] - (dur + 10 * s)) < 1e-6, watch
    await page.wait_for_function("__mis.fx.floats.length > 0 && __mis.fx.timeFlash > performance.now() / 1000", timeout=3000)
    if s == 1.0: await shot(page, '44-orb-caught.png')
    fl = await js(page, "__mis.fx.floats.map(f => f.text)"); R_['float_text'] = fl; assert any(t == '+10s' for t in fl), fl
    # the level continues past the ORIGINAL end (bars loop; targets keep coming)
    await page.wait_for_function(f"__mis.levelT() > {dur} + 1.5", timeout=90000)
    mid = await js(page, "({state: __mis.state, done: __mis.g.done, passes: __mis.g.passes, left: __mis.R.timeLeft(__mis.g, __mis.g.lastT), loopWraps: GameAudio.loop && GameAudio.songTime(true) > GameAudio.loop[1], next: (__mis.nextTargetIn() || {}).dt, perfect: __mis.g.counts.perfect})")
    R_['past_original_end'] = mid; assert mid['state'] == 'play' and not mid['done'] and mid['passes'] >= 2 and mid['loopWraps'] and mid['next'] is not None and mid['left'] > 0, mid
    p0 = mid['perfect']
    await page.wait_for_function(f"__mis.g.counts.perfect > {p0} || __mis.state !== 'play'", timeout=9000)       # (a freeze can pause judging for a few seconds)
    assert await js(page, "__mis.g.counts.perfect") > p0, 'targets are still judged in the extension'
    # ... and ends at the extended clock
    await wait_state(page, 'result', timeout=60000); wall_after_catch = time.time() - t_catch
    expect = watch['after']
    R_['end'] = dict(wall_s_after_catch=round(wall_after_catch, 1), expected_s=round(expect, 1)); assert abs(wall_after_catch - expect) < 3.2, R_['end']
    sm = await js(page, "__mis.session.results[0]"); R_['summary'] = {k: sm[k] for k in ('orbsCaught', 'orbsMissed', 'extraWall', 'acc', 'perfect', 'good', 'miss', 'stray')}
    assert sm['orbsCaught'] == 1 and sm['orbsMissed'] == 1 and sm['extraWall'] == 10 and sm['stray'] == 0 and sm['acc'] <= 1, sm
    ap = await js(page, "window.__ap.taps"); R_['autoplay_taps'] = ap; assert sm['perfect'] + sm['good'] >= 0.85 * ap, (sm, ap)       # the orb never swallowed a beat tap
    assert 'ENERGY ORBS' in await js(page, "document.getElementById('resKv').textContent")
    await js(page, "window.__ap.on = false; clearInterval(window.__orbSteer)")
    await ctx.close()

def finish():
    errs = [l for l in LOGS if l[1] in ('error', 'pageerror', 'requestfailed')]
    REPORT['console_errors'] = errs
    REPORT['console_warnings'] = [l for l in LOGS if l[1] == 'warning'][:10]
    json.dump(REPORT, open(os.path.join(SHOTS, '_e2e-report.json' if not (os.environ.get('ONLY_SLOW') or os.environ.get('ONLY_MUSIC') or os.environ.get('ONLY_NOLIMIT') or os.environ.get('ONLY_ORB')) else '_e2e-partial-report.json'), 'w'), indent=1, default=str)
    print(json.dumps(REPORT, indent=1, default=str))

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        if os.environ.get('ONLY_MUSIC'):
            for sp_ in [float(x) for x in os.environ['ONLY_MUSIC'].split(',')]:
                await music_flow(p, browser, sp_)
            await browser.close(); finish(); return
        if os.environ.get('ONLY_ORB'):
            for sp_ in [float(x) for x in os.environ['ONLY_ORB'].split(',')]:
                await orb_flow(p, browser, sp_)
            await browser.close(); finish(); return
        if os.environ.get('ONLY_NOLIMIT'):
            await nolimit_flow(p, browser, 1.0)
            if os.environ['ONLY_NOLIMIT'] == '2': await nolimit_flow(p, browser, 0.7, music_off=True)
            await browser.close(); finish(); return
        if os.environ.get('ONLY_SLOW'):
            for sp_ in [float(x) for x in os.environ['ONLY_SLOW'].split(',')]:
                await slow_flow(p, browser, sp_, full=sp_ < 1)
            if os.environ.get('ONLY_MUSIC'):
                pass
            await browser.close(); finish(); return
        ctx = await new_ctx(p, browser, 'iphone')
        page = await ctx.new_page(); attach(page, 'iphone')
        await page.goto(URL)
        await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
        await page.wait_for_timeout(900)
        await shot(page, '01-start.png')
        assert await js(page, "window.GameAudio.ctx === null"), 'AudioContext must not exist before the first tap'
        # ---- first tap unlocks audio and plays the title video
        await page.touchscreen.tap(195, 500)
        await wait_state(page, 'video')
        await page.wait_for_timeout(1500)
        v = await js(page, "(()=>{const v=document.getElementById('titleVideo');return {t:v.currentTime,paused:v.paused,muted:v.muted,src:v.currentSrc.split('/').pop(),err:v.error&&v.error.code}})()")
        await page.wait_for_timeout(700)
        v2 = await js(page, "document.getElementById('titleVideo').currentTime")
        REPORT['title_video'] = dict(first=v, later=v2, advancing=v2 > v['t'])
        a = await js(page, "({state:GameAudio.ctx.state, mode:GameAudio.mode, c:GameAudio.ctx.currentTime, base:GameAudio.ctx.baseLatency, out:GameAudio.ctx.outputLatency})")
        await shot(page, '02-title-video.png')
        # ---- skip
        await tap_btn(page, '#skipBtn')
        await wait_state(page, 'menu')
        await page.wait_for_function("window.GameAudio.buffer !== null", timeout=20000)
        await page.wait_for_timeout(800)
        s1 = await js(page, "GameAudio.songTime()"); await page.wait_for_timeout(1000); s2 = await js(page, "GameAudio.songTime()")
        a2 = await js(page, "({state:GameAudio.ctx.state, c:GameAudio.ctx.currentTime, dur:GameAudio.buffer.duration, mode:GameAudio.mode, endReason:window.__titleEnd})")
        REPORT['audio'] = dict(ctx_after_tap=a, after_menu=a2, songTime_1=s1, songTime_2=s2, advanced_s=(s2 - s1) if s1 is not None and s2 is not None else None)
        await shot(page, '03-menu.png')
        REPORT['decode_offset_probe'] = await js(page, KICK_PROBE_JS)
        # ---- settings + calibration
        await tap_btn(page, '#mSettings'); await page.wait_for_timeout(500)
        await tap_btn(page, '#latPlus'); await tap_btn(page, '#latPlus'); await page.wait_for_timeout(200)
        await shot(page, '04-settings.png')
        await tap_btn(page, '#latMinus'); await tap_btn(page, '#latMinus')
        await tap_btn(page, '#latCal'); await page.wait_for_timeout(400)
        await tap_btn(page, '#calibStart')
        # simulate a player who taps 45 ms late on every click
        await js(page, """() => { const A = GameAudio; const pad = document.getElementById('calibPad');
          const check = () => { /* tap 45 ms after each scheduled click */ };
          window.__calibTimer = setInterval(()=>{}, 1000);
          const clicks = [];  // read from closure not exposed: re-derive from ctx time
        }""")
        # the click times are inside main.js; emulate taps from wall clock: clicks start 1.2 s after calibStart
        t0 = time.time()
        for i in range(10):
            target = t0 + 1.2 + i * (60 / 124) + 0.045
            await page.wait_for_timeout(max(0, int((target - time.time()) * 1000)))
            await page.dispatch_event('#calibPad', 'pointerdown')
            await page.dispatch_event('#calibPad', 'pointerup')
        await page.wait_for_timeout(1500)
        cal = await js(page, "window.__calibResult")
        REPORT['calibration'] = dict(simulated_late_ms=45, measured_ms=cal)
        await shot(page, '05-calibrate.png')
        await tap_btn(page, '#calibApply'); await page.wait_for_timeout(300)
        REPORT['latency_applied'] = await js(page, "__mis.settings.latencyMs")
        # reset latency to 0 for the gameplay test
        await js(page, "__mis.settings.latencyMs = 0")
        await tap_btn(page, '#setBack'); await page.wait_for_timeout(400)
        # ---- how-to is its own menu item
        await tap_btn(page, '#mHow'); await wait_state(page, 'howto'); await page.wait_for_timeout(600)
        await shot(page, '06-tutorial.png')
        await tap_btn(page, '#howBack'); await wait_state(page, 'menu'); await page.wait_for_timeout(300)
        # ---- START must go straight into level 1 (regression: it used to open the how-to card)
        await start_direct(page, 'iphone13-touch')
        await shot(page, '26-start-direct.png')
        await page.wait_for_function("__mis.levelT() > 3.3", timeout=20000)
        await shot(page, '07-level1-coach.png')
        # ---- level 1: perfect taps + slider via pointer events, park inside the green zone
        await js(page, AUTOPLAY_JS, {'zone': 2.8, 'jitter': 0.0})
        await page.wait_for_function("__mis.g && __mis.levelT() > 6.5", timeout=30000)
        # catch a PERFECT popup and hold the canvas frame so the screenshot shows it
        await page.evaluate("""() => new Promise(res => { const f = () => { const n = __mis.fx.popups.filter(p => p.judge === 'PERFECT' && performance.now()/1000 - p.t0 > 0.1 && performance.now()/1000 - p.t0 < 0.3).length; if (n) { window.__hold = true; res(true); } else requestAnimationFrame(f); }; f(); })""")
        await shot(page, '08-midlevel-perfect.png')
        await js(page, "window.__hold = false")
        # ---- arrows held with a real touch while autoplay is running (screenshot shows the pressed state)
        cdp0 = await ctx.new_cdp_session(page)
        ar = await rect(page, '#aLU'); ax, ay = center(ar)
        await touch(cdp0, 'touchStart', [{'x': ax, 'y': ay, 'id': 4}]); await page.wait_for_timeout(200)
        await shot(page, '24-arrows.png')
        await touch(cdp0, 'touchEnd', [])
        info = await js(page, "(()=>{const g=__mis.g;return {t:__mis.levelT(), tilt:__mis.R.tilt(g,g.lastT), combo:g.combo, counts:g.counts, zone:g.zone, p:g.p}})()")
        REPORT['l1_mid'] = info
        # ---- freeze test: steer to 0 degrees, wait for lockout
        await js(page, "window.__ap.ctrlAngle = 0")
        try:
            await laser_test(page, 'iphone13-touch', '31-laser-frozen.png')
            await esc_test(page, 'iphone13-touch', '25-esc-frozen.png')
            await js(page, "window.__ap.ctrlAngle = 0")
            await page.wait_for_function("__mis.g.frozenCount >= 2", timeout=30000)
            await page.wait_for_timeout(500)
            await shot(page, '09-frozen.png')
            fz = await js(page, "(()=>{const g=__mis.g;return {frozenCount:g.frozenCount, combo:g.combo, tiltDrawn:__mis.R.tilt(g,g.lastT), narrator:g.narrator.text, shownPct:__mis.R.display(g,g.lastT)}})()")
        except Exception as e:
            fz = {'error': str(e)}
        REPORT['l1_freeze'] = fz
        await js(page, "window.__ap.ctrlAngle = null")        # back to the near-miss zone
        await wait_state(page, 'result', timeout=60000)
        await page.wait_for_timeout(900)
        await shot(page, '10-result.png')
        REPORT['l1_result'] = await js(page, "__mis.session.results[0]")
        # ---- level 2 (intro card, flip), with some sloppy and skipped taps
        await js(page, "window.__ap.on = false")
        await tap_btn(page, '#resNext'); await wait_state(page, 'intro'); await page.wait_for_timeout(500)
        await shot(page, '11-level2-intro.png')
        await tap_btn(page, '#introGo'); await wait_state(page, 'play')
        await js(page, AUTOPLAY_JS, {'zone': 2.6, 'jitter': 0.085, 'skipEvery': 9})
        await page.wait_for_function("__mis.g && __mis.g.flipOn === true", timeout=40000)
        await page.wait_for_timeout(900)
        await shot(page, '12-level2-flip.png')
        REPORT['l2_flip'] = await js(page, "(()=>{const g=__mis.g;return {flipOn:g.flipOn, display:__mis.R.display(g,g.lastT), tilt:__mis.R.tilt(g,g.lastT)}})()")
        # pause / resume / restart check
        await js(page, "__mis.pauseGame()"); await page.wait_for_timeout(500)
        st0 = await js(page, "__mis.g.lastT"); await page.wait_for_timeout(800); st1 = await js(page, "__mis.g.lastT")
        await shot(page, '13-pause.png')
        await tap_btn(page, '#pResume'); await wait_state(page, 'play')
        await page.wait_for_timeout(600)
        st2 = await js(page, "__mis.g.lastT")
        REPORT['pause'] = dict(frozen_during_pause=abs(st1 - st0) < 0.01, advanced_after_resume=st2 > st1 + 0.3)
        await wait_state(page, 'result', timeout=60000); await page.wait_for_timeout(600)
        REPORT['l2_result'] = await js(page, "__mis.session.results[1]")
        # ---- level 3 (inverts)
        await js(page, "window.__ap.on = false")
        await tap_btn(page, '#resNext'); await wait_state(page, 'intro'); await tap_btn(page, '#introGo'); await wait_state(page, 'play')
        await js(page, AUTOPLAY_JS, {'zone': 2.6, 'jitter': 0.03})
        await page.wait_for_function("__mis.g && __mis.g.invertOn === true", timeout=40000)
        await page.wait_for_timeout(1400)
        await shot(page, '14-level3-invert.png')
        REPORT['l3_invert'] = await js(page, "(()=>{const g=__mis.g;return {invertOn:g.invertOn, sign:g.sign, tilt:__mis.R.tilt(g,g.lastT)}})()")
        await wait_state(page, 'result', timeout=60000); await page.wait_for_timeout(600)
        await js(page, "window.__ap.on = false")
        REPORT['l3_result'] = await js(page, "__mis.session.results[2]")
        await tap_btn(page, '#resNext'); await wait_state(page, 'final'); await page.wait_for_timeout(700)
        await shot(page, '15-final-grade.png')
        REPORT['final'] = await js(page, "__mis.R.grade(__mis.session.results)")
        await tap_btn(page, '#finCredits'); await wait_state(page, 'credits'); await page.wait_for_timeout(3500)
        await shot(page, '16-credits.png')
        # restart from credits
        await tap_btn(page, '#crAgain'); await wait_state(page, 'play'); await page.wait_for_timeout(500)
        REPORT['restart_from_credits'] = await js(page, "__mis.state + ' level ' + __mis.g.L.id + ' / results reset: ' + (__mis.session.results.length === 0)")
        assert REPORT['restart_from_credits'].startswith('play level 1'), REPORT['restart_from_credits']
        await ctx.close()

        # ---- Pixel 7, mobile, quick path to a level
        ctx = await new_ctx(p, browser, 'pixel'); page = await ctx.new_page(); attach(page, 'pixel')
        await page.goto(URL + '?novideo=1'); await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
        await page.touchscreen.tap(200, 450); await wait_state(page, 'menu'); await page.wait_for_timeout(900)
        await shot(page, '17-pixel7-menu.png')
        cdp = await ctx.new_cdp_session(page)
        await start_direct(page, 'pixel7-touch')
        await arrow_tests(page, cdp, 'pixel7')
        await js(page, "__mis.g.twist = 0")      # the arrow test pushed the tilt beyond the slider's range; start the autoplayer clean
        await js(page, AUTOPLAY_JS, {'zone': 2.8})
        await page.wait_for_function("__mis.g && __mis.levelT() > 7", timeout=30000)
        await esc_test(page, 'pixel7-touch', '27-pixel7-esc.png')
        await page.wait_for_function("__mis.g && __mis.levelT() > 20", timeout=40000)
        await shot(page, '18-pixel7-play.png')
        # real touch two-finger twist using CDP
        await js(page, "window.__ap.on = false; window.__ap.down=false")
        # release the synthetic slider pointer
        await js(page, "document.getElementById('stage').dispatchEvent(new PointerEvent('pointerup',{pointerId:5,bubbles:true}))")
        tw0 = await js(page, "__mis.g.twist")
        cx, cy, r = 206, 330, 60
        import math
        def pts(a): return [{'x': cx + r * math.cos(a), 'y': cy + r * math.sin(a), 'id': 1}, {'x': cx - r * math.cos(a), 'y': cy - r * math.sin(a), 'id': 2}]
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pts(0)})
        for i in range(1, 11):
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pts(i * math.radians(2))})
            await page.wait_for_timeout(16)
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        await page.wait_for_timeout(100)
        tw1 = await js(page, "__mis.g.twist")
        # real touch drag of the slider with CDP
        L = await js(page, "__mis.rend.L")
        sx = (L['trackX0'] + L['trackX1']) / 2; sy = L['trackY']
        tw2a = await js(page, "__mis.g.twist")
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': sx, 'y': sy, 'id': 1}]})
        for i in range(1, 9):
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': sx + i * 8, 'y': sy, 'id': 1}]}); await page.wait_for_timeout(16)
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        tw2b = await js(page, "__mis.g.twist")
        REPORT['touch_input'] = dict(two_finger_twist_deg=round(tw1 - tw0, 2), slider_drag_deg=round(tw2b - tw2a, 2), slider_px=64)
        await page.touchscreen.tap(200, 300)
        REPORT['touch_tap_counts'] = await js(page, "__mis.g.counts")
        await ctx.close()

        # ---- landscape phone + desktop
        ctx = await new_ctx(p, browser, 'landscape'); page = await ctx.new_page(); attach(page, 'landscape')
        await page.goto(URL + '?novideo=1'); await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
        await page.touchscreen.tap(400, 100); await wait_state(page, 'menu'); await page.wait_for_timeout(700)
        await shot(page, '19-landscape-menu.png')
        await tap_btn(page, '#mHow'); await wait_state(page, 'howto'); await page.wait_for_timeout(400)
        await shot(page, '20-landscape-tutorial.png')
        await tap_btn(page, '#howBack'); await wait_state(page, 'menu')
        await start_direct(page, 'landscape-touch')
        await js(page, AUTOPLAY_JS, {'zone': 2.8})
        await page.wait_for_function("__mis.g && __mis.levelT() > 10", timeout=30000)
        await shot(page, '21-landscape-play.png')
        await ctx.close()

        ctx = await new_ctx(p, browser, 'desktop'); page = await ctx.new_page(); attach(page, 'desktop')
        await page.goto(URL + '?novideo=1'); await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
        await page.mouse.click(640, 400); await wait_state(page, 'menu')
        await page.wait_for_timeout(450); await page.click('#mStart'); await wait_state(page, 'play'); await page.wait_for_timeout(700)
        REPORT.setdefault('start_regression', {})['desktop-mouse'] = await js(page, "({state: __mis.state, level: __mis.g.L.id, howto_visible: document.getElementById('screen-howto').classList.contains('on')})")
        await js(page, AUTOPLAY_JS, {'zone': 2.8})
        await page.wait_for_function("__mis.g && __mis.levelT() > 12", timeout=30000)
        await shot(page, '22-desktop-play.png')
        # keyboard path
        await js(page, "window.__ap.on=false; document.getElementById('stage').dispatchEvent(new PointerEvent('pointerup',{pointerId:5,bubbles:true}))")
        c0 = await js(page, "JSON.stringify(__mis.g.counts)")
        await page.keyboard.press('Space'); await page.keyboard.press('Space')
        c1 = await js(page, "JSON.stringify(__mis.g.counts)")
        REPORT['keyboard'] = dict(before=c0, after=c1)
        # keyboard ArrowUp/ArrowDown tilt (held) and Escape while frozen
        await page.evaluate("window.focus()")
        k0 = await js(page, "__mis.g.twist"); await page.keyboard.down('ArrowDown'); await page.wait_for_timeout(500); await page.keyboard.up('ArrowDown'); k1 = await js(page, "__mis.g.twist")
        await page.keyboard.down('ArrowUp'); await page.wait_for_timeout(300); await page.keyboard.up('ArrowUp'); k2 = await js(page, "__mis.g.twist")
        REPORT['keyboard_tilt'] = dict(down_deg=round(k1 - k0, 2), up_deg=round(k2 - k1, 2))
        assert k1 > k0 and k2 < k1, REPORT['keyboard_tilt']
        await js(page, "window.__ap.on=false; window.__ap.down=false; window.__ap.tapped=new Set()")
        await js(page, "__mis.g.immuneUntil = -1; __mis.g.twist = -__mis.R.worldTilt(__mis.g, __mis.g.lastT) - __mis.g.jolt")      # park at exactly 0 deg -> lock (v12: clear any flat-tangent immunity the letter taps picked up)
        # keep it parked every frame (expiring rings shove the grid, the world tilt keeps moving) until the freeze triggers
        await page.wait_for_function("(() => { const m = __mis, g = m.g; if (!m.R.isFrozen(g, g.lastT)) { g.immuneUntil = -1; g.twist = -m.R.worldTilt(g, g.lastT) - g.jolt; } return m.R.isFrozen(g, g.lastT); })()", timeout=5000, polling='raf')
        sh0 = await js(page, "__mis.g.laserShots"); await page.keyboard.press('f'); await page.wait_for_timeout(100)
        REPORT['keyboard_fire'] = dict(shots_before=sh0, shots_after=await js(page, "__mis.g.laserShots")); assert REPORT['keyboard_fire']['shots_after'] == sh0 + 1, REPORT['keyboard_fire']
        await page.keyboard.press('Escape'); await page.wait_for_timeout(150)
        REPORT['keyboard_escape'] = await js(page, "({frozen: __mis.R.isFrozen(__mis.g, __mis.g.lastT), state: __mis.state, escapes: __mis.g.escapes})")
        assert not REPORT['keyboard_escape']['frozen'] and REPORT['keyboard_escape']['state'] == 'play' and REPORT['keyboard_escape']['escapes'] == 1, REPORT['keyboard_escape']
        await ctx.close()

        # ---- reduced motion
        ctx = await new_ctx(p, browser, 'reduced'); page = await ctx.new_page(); attach(page, 'reduced')
        await page.goto(URL + '?novideo=1'); await page.wait_for_function("window.__mis && window.__mis.state === 'boot'")
        REPORT['reduced_motion_default'] = await js(page, "__mis.settings.reduceMotion")
        await page.touchscreen.tap(195, 450); await wait_state(page, 'menu')
        await start_direct(page, 'reduced-motion-touch')
        await js(page, AUTOPLAY_JS, {'zone': 2.8, 'skipEvery': 3})
        await page.wait_for_function("__mis.g && __mis.levelT() > 12", timeout=30000)
        await shot(page, '23-reduced-motion-play.png')
        REPORT['reduced_motion_shake_flag'] = await js(page, "__mis.fx.shake")
        await ctx.close()
        # ---- GAME SPEED / slow mode + tilt lock (iPhone 13 touch): 100% (lock only), 85% and 70% (full)
        await slow_flow(p, browser, 1.0, full=False)
        for sp_ in (0.85, 0.7):
            await slow_flow(p, browser, sp_, full=True)
        for sp_ in (1.0, 0.7):
            await music_flow(p, browser, sp_)
        await nolimit_flow(p, browser, 1.0)
        await nolimit_flow(p, browser, 0.7, music_off=True)
        await orb_flow(p, browser, 1.0)
        await orb_flow(p, browser, 0.85)
        await browser.close()
    finish()

asyncio.run(main())
