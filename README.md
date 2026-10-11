# MISALIGNED - mobile prototype (test build)

A SMARTBEAN PROTOTYPE - *prototype build*. One thumb, portrait first (also fine in landscape and on desktop).
Plain HTML + canvas + JS. No build step, no CDN, no network calls: everything is in this folder.
It keeps the idea and the "rules are pure, renderer is separate" architecture of `../mis-aligned-mvp.html`
(that file is untouched).

## Play
https://sbean0.github.io/misaligned-game/

## Run it locally
```
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```
Opening `index.html` straight from disk (file://) also works
for everything except decoding the music with WebAudio (browsers block `fetch` of local files); the game then falls back
to a plain `<audio>` element automatically.
Debug: `?novideo=1` skips the title video.
Cache busting: `index.html` loads the scripts as `js/*.js?v=11` - bump the number when you change JS so phones do not keep the old files.

## How to play (this is also the in-game tutorial)
| | |
|---|---|
| 1 TAP | Rings close on a letter. **Tap anywhere** on the beat (the targets are the real kicks of the track). PERFECT +-75 ms, GOOD +-145 ms; 145-245 ms is EARLY/LATE (a miss); a tap that matches nothing costs 15 points. PERFECT snaps the letter home, GOOD snaps 65%, a miss makes the letter drift further and **shoves the grid** (+-1.8 deg). |
| 2 TWIST | The whole grid + horizon is tilted. **Drag the big slider** at the bottom (it works 1:1 with your finger; it can be dragged from anywhere in the bottom zone), **hold the arrow buttons** (see below) or **twist two fingers** in the play area. The gauge above the slider shows the *real* tilt. A quick tap in the slider zone also counts as a beat tap, so you can tap with the other thumb while sliding. |
| 3 THE AI LIES | "AI // ALIGNMENT CHECK" shows a % that is deliberately unreliable (flattering, jittery, random false 100.0% blips). Park the grid within 0.6 deg for 0.4 s and the check says 100% -> **ALIGNED. GRID FROZEN.** (3 s lockout, combo reset, zero meter -20%). **Frozen? Tap the floating ESC button** to end the lock-out early (-50 points). |
| 4 THE REAL WIN | Stay **1.5-4 deg off** (green on the gauge) and **keep your combo** (>= 3) to fill the ZERO METER -> **NEW ZERO SET** (+1000). |

Levels (each ~38.7 s = 20 bars of the track; the three levels together are the whole 1:56 song):

| Level | Track bars | Targets | Drift | Surprise rule |
|---|---|---|---|---|
| 1 CALIBRATE | 1-20 (intro, verse, pre-build) | 36 kicks (beats 1 and 3) | slow | the % lies; 4-step coach text (tilt, tap, lie, real win) |
| 2 THE % FLIPS | 21-40 (chorus, breakdown, build) | 55 (every beat; 1 per bar in the kick-less breakdown) | medium | in two windows the narrator's % **flips**: 100% means far, 0% means frozen |
| 3 THE GRID INVERTS | 41-60 (final chorus, bridge, peak, outro) | 48 real kicks incl. syncopated pick-ups | fast | the grid turns **upside down** and the slider is **reversed** (bars 7-13), then the % flips again |

Score: PERFECT 300, GOOD 100, x(1 + floor(combo/10)) up to x4, +40/s in the near-miss zone, +1000 for a Zero Set.
Grade S-D from accuracy and Zero Sets (S needs all three, >= 92% accuracy and never frozen). Result screen per level,
final grade, credits (scrolling list over the title card's final frame), restart / play again everywhere.

**START goes straight into level 1.** The rules are taught in-game by the level-1 coach lines (tilt, tap, the lie, the real win, ESC); **HOW TO PLAY** is a separate, optional menu item (its button starts level 1 too).

### Arrow buttons (thumb tilt)
Four neon chevron buttons, an up/down pair on the **left edge** and the same pair on the **right edge** (60 px, 56 px on short screens), just above the gauge, inside the safe area and clear of the HUD buttons. Both pairs do the same thing, so either thumb works.
* **Hold UP** = rotate the grid counter-clockwise, **hold DOWN** = clockwise, 5 deg/s at first, accelerating to 30 deg/s after about 1.4 s of holding; release stops. Pressed state = magenta fill.
* They are separate DOM buttons above the canvas: pressing one is never a beat tap, and one thumb can hold an arrow while the other taps the beat (multi-touch safe). The slider and two-finger twist still work.
* **Level 3 inverted grid:** the arrows go through the same `sign` as the slider (`Rules.tiltStep -> twistBy`), so they reverse exactly when the slider reverses, and are tinted pink while reversed. (The grid is flipped but the horizon tilt is not, so "reversed" means "the controls work backwards", same as the slider.)
* Hidden outside gameplay; dimmed while the grid is frozen. Settings -> **ARROW BUTTONS** toggle (on by default). Keyboard: ArrowUp / ArrowDown do the same.

### ESC (unfreeze)
While the grid is frozen a pulsing neon **ESC** button (132x64 px) floats at the bottom centre, above the gauge, clear of the arrows. Tapping it (or pressing the Escape key) ends the lock-out immediately: -50 points (never below 0), a short "ESC -100" toast, the grid drops back at a 5-7 deg tilt, the button disappears. The combo was already reset by the freeze, nothing more is taken. It is not a beat tap. It is a rules event (`Rules.escape(g, t)`), pure and deterministic. Outside a freeze, the Escape key pauses.

### FROZEN-MODE LASER (DYSTOPIAN SCORE)
While the grid is frozen a neon **FIRE** button (132x64 px, pink) floats **directly above ESC** (bottom centre, clear of the arrows and HUD; hidden when not frozen; a separate DOM button, so never a beat tap and multi-touch safe). Keyboard: **F**.
* Each press shoots one vertical beam from the button. Five seeded "misalignment nodes" (magenta rings with a cyan diamond and glitch slices) drift left-right across the screen on slow sine paths (`Rules.laserPos`, seeded per level/freeze, wall-clock speed). A beam that passes within **6%** of the screen width of a node's centre line destroys it: **+150** with a spark and floating "ALIGNMENT BONUS +150"; within **13%** it is a **near miss, +50** (max 2 per node); otherwise the beam fizzles upward. So it is timing, not spam.
* **Flat points (no combo multiplier), never the combo**: they are added to the score and tracked separately as **DYSTOPIAN BONUS** (level result: `+N (hits / shots)`, final grade screen: total). A SYNTH zap (WebAudio, through the master gain: mute/volume apply) and a haptic tick; reduced motion = no screen shake, no particles, a plain ring + dim flash.
* Bounded: **12 shots per freeze**, **120 ms** between shots (wall-clock, also at 70% speed), at most 5 nodes, a **600 points cap per freeze and 900 per level** (both below a zero set's +1000). A freeze already costs the combo (and its multiplier), 20% of the zero meter and 3 s of scoring, so freezing on purpose to farm lasers is a worse deal than holding the 1.5-4 deg near-miss zone. The bonus never changes the grade letter (the grade is accuracy / zero sets / freezes).
* ESC still unfreezes at once and **clears the lasers**; the round also ends with the freeze. Rules: `Rules.fire(g, t)` (pure, seeded, time argument), `Rules.laserView(g, t)` for the renderer.
* Coach / HOW TO PLAY: "FROZEN? FIRE LASERS FOR BONUS, OR TAP ESC."

### Tilt lock (tap the gauge marker)
Tap the small **triangle marker on the TILT gauge** (the hit zone is the whole gauge row: 64 px tall, full gauge width, separate from the canvas, so it is never a beat tap and works while the other thumb holds an arrow) or press **L**. The displayed tilt is **held perfectly still for 8 s (wall-clock)** (v6; v5 5 s, v1 2 s): drift, slider, arrows and twist cannot change it (the slider handle still moves; the tilt just ignores it). The marker gets a countdown ring, a padlock and the gauge turns ice-blue, and the gauge label reads **TAP AGAIN** with the time left. **Tap the same triangle again** (or press L) to end the hold immediately. Either way it **eases back over 0.35 s** (no jump) and recharges for **6 s** from the moment the hold ends (marker dimmed, the hit zone passes touches through to the slider again).
* Rules (`Rules.lockTilt(g, t)`, pure): not available in the lead-in, while frozen, while locked, or on cooldown. `Rules.releaseTilt(g, t)` is the second tap: it ends an active lock at that time and starts the 6 s recharge.
* **Zero meter**: locking in the 1.5-4 deg zone counts normally (it is a tool for holding the crooked zone). **Freeze**: locking inside <0.6 deg still counts toward the freeze dwell, so it freezes you after 0.4 s and the freeze ends the lock (no loophole).
* **Beat-tap misses during a lock still break the combo, but their grid shove is ignored** (not deferred).
* Cooldown after the lock is **6 s** (v6; was 4 s / 3 s), shown dimmed on the marker. Slow mode: the lock, release and cooldown are wall-clock seconds (they are stored as song seconds x speed).
* Level 1 coach: "TAP THE ARROW TO LOCK YOUR TILT 8s. TAP IT AGAIN TO LET GO." Also in HOW TO PLAY. Because the gauge row is now the lock button, dragging the slider starts below it (the slider box). The gauge stays tappable for the whole hold, so the second tap can release it.

### Floating tangent (gradient 0)
A seeded tangent line drifts through the playfield (canvas fractions, wall-clock motion, so slow mode does not speed it up). It is the tangent to a small hill, and it labels its slope `m`. **Flat means gradient 0** (`|m| <= 0.08`): the line turns lime and reads **FLAT · GRADIENT 0**. Touching that flat grants **42 s wall-clock freeze immunity** (`Rules.tap` with a point, `immuneUntil`). The 0.6° dwell does not run, so parking at 100% does not freeze until the 42 s ends. Touching it again restarts the 42 s. A touch on the flat is not a stray tap; a real kick window is still judged. A sloped line does not grant immunity. The HUD reads **FREEZE IMMUNE Ns**. It does not add score and it does not change the grade except by avoiding freezes. Level 1 coach and HOW TO PLAY item 7.

Controls: touch (above), mouse (same), keyboard: Space/Enter/J = tap, Left/Right (or A/D) = slide, Up/Down = tilt, L = lock tilt, F = fire laser (frozen), Esc = unfreeze (or pause), P = pause.
Pause button + mute button (top right, 52 px). Settings: volume, mute, latency offset (+-10 ms steps, **CALIBRATE**
metronome tapper), reduce motion, **game speed**, music / sfx / beat tick, arrow buttons, haptics. Haptics use `navigator.vibrate` when it exists (not on iOS Safari).

## MORE TIME (v5 easing) - what changed and why
"More time for players" is read as *less pressure*, not a longer song. Everything is one constant in `rules.js`, and the level-to-level scaling is kept (every ratio between level 1/2/3 is unchanged).

| | before | v5 |
|---|---|---|
| PERFECT / GOOD window at 100% (wall-clock) | +-60 / +-120 ms | **+-75 / +-145 ms** (EARLY/LATE band +-220 -> +-245 ms) |
| PERFECT / GOOD at 85% / 70% slow | 75/145, 90/170 | **85/160, 95/180** (never tighter than 100%) |
| Ring approach (how long a ring is visible before the beat) | 1.0 beat (0.48 s) | **1.6 beats (0.77 s)**, 1.6x |
| Mark creep (drift growth) per second | 0.08 / 0.14 / 0.20 cells | **0.06 / 0.105 / 0.15** (-25%) |
| ZERO METER needed (seconds in the green zone) | 8 / 10 / 11 s | **6 / 8 / 9 s**; drains at 0.15 s per s out of the streak (was 0.35, before that 0.5) |
| Freeze (100%) | 0.3 s dwell, costs 30% of the meter | **0.4 s dwell, costs 20%** |
| ESC | -100 points | **-50 points** |
| Miss shove on the grid | 1.8 deg | **1.4 deg** |
| Tilt lock | 2 s lock, 3 s cooldown | **5 s lock, 4 s cooldown** (v6: **8 s lock, 6 s cooldown**) |

Grade thresholds are **unchanged** (S: 92% accuracy, 3 zero sets, no freezes; A: 80%, 2 zero sets; B: 65%, 1). The wider windows raise accuracy and the smaller meter makes zero sets easier, so S/A are *more* reachable, not less; no change was needed to keep them achievable.

## ENERGY ORBS (v6: earn +10 s by steering the tilt)
Settings -> **ENERGY ORBS: ON / OFF** (default ON, saved). A **TIME m:ss** readout in the HUD shows the level clock (wall-clock seconds left; not shown in NO TIME LIMIT).
* **Mechanic (one thumb)**: a glowing lime/gold orb with a star flare flies from the horizon down a dashed **lane** to a **landing ring** on the catch line just above the tilt gauge. The lane's bottom position encodes a **tilt angle** (`theta`); a **catcher bracket** `[ ]` on the same line slides left/right with your **current tilt** (`x = centre + tilt * px-per-degree`, 9-14 px per degree). Slide/arrows/twist/tilt-lock the grid until the bracket sits on the landing ring when the orb arrives; the bracket glows lime and says **LOCK ON**. Rules: caught when `|tilt - theta| <= 1.5 deg` at any moment of the arrival window **+-0.2 s (wall-clock)**. No tapping, never a beat tap, nothing is consumed.
* **Tension with the near-miss zone**: orb 0 of every level needs an angle **inside** the green zone (2.1-3.4 deg either side), orb 1 an angle **outside** it (7-10 deg, so the zero meter pauses/drains while you go for it), orb 2 either. Angles are never within 2.1 deg of 0 (that would freeze you; and a frozen grid has tilt 0, so an orb that arrives during a freeze is simply missed). **Tilt lock** is the clean way: park on theta, tap the marker, and the 8 s lock holds the catch.
* **Spawn plan** (seeded, deterministic, `Rules.buildOrbs`): level 1 has **2 orbs** (arrive at ~34% and ~74% of the level +-1 s), levels 2 and 3 have **3** (25 / 50 / 75%). Each is announced by a faint pulsing shimmer on the horizon for 1.5 s, flies for 3.2 s (wall-clock; x speed in song time), stays visible as a fading orb for 0.7 s if missed. Level 1's coach says "ENERGY ORB! TILT TO CATCH IT: +10s" while the first one approaches.
* **Reward**: **+10 s of level time, wall-clock** (also in slow mode: stored as `10 x speed` song seconds), **max +30 s per level** (a capped catch gives the remainder, e.g. +5 s, then +0 "MAX TIME"). The catch also counts as **three taps**: combo +3, and the zero meter jumps by three level-1 kick spacings (`3 × 2 beats` ≈ 2.9 s of the meter) immediately, even outside the green. That bump can finish a NEW ZERO SET. Feedback: lime burst + floating `+10s` and `ZERO +3` at the catcher, the HUD timer flashes lime (static lime in reduced motion), a three-note chime (`GameAudio.chime`, SFX gain, so SFX OFF mutes it), a 14 ms haptic. **Missing costs nothing** (a grey `ORB LOST`, no score / combo / zero-meter / grid effect).
* **Music and level length**: a standard level is tied to track bars, so extension works by **looping the level's bars**. With orbs enabled a standard level's audio always runs on the loop chain from NO TIME LIMIT (section = the level's first bar to its last bar, 6 ms crossfade, clock = unwrapped audio clock), so nothing has to be re-scheduled when an orb is caught. Without a catch the level still ends at its normal last bar. With a catch the clock is `dur + extra`: when the original end passes, the bars simply loop, the target generator continues (pass 1 of the same seeded plan), flips/inverts repeat, and the level ends at `dur + extra` exactly (it can end mid-bar; the music fades out over 0.6 s). No new orbs spawn in the extended part. Accuracy for an extended level is computed over the targets actually judged. With ENERGY ORBS OFF the old single-source audio path is used and the level is exactly as before.
* **NO TIME LIMIT**: orbs still appear (a set per pass) but are worth **+500 points** each (tallied as ORB points), never time.
* Rules API (pure, time as an argument): `startLevel(idx, seed, speed, {orbs: true})`, `buildOrbs`, events `orbcatch {i, extra, points, capped}` / `orbmiss`, `orbView(g, t)` for the renderer, `timeLeft(g, t)`. Constants: `ORB_EXTRA_S 10, ORB_MAX_EXTRA_S 30, ORB_TRAVEL_S 3.2, ORB_ANNOUNCE_S 1.5, ORB_TOL 1.5, ORB_WIN_S 0.2, ORB_NL_POINTS 500`.

## NO TIME LIMIT (practice mode)
* **Where**: menu button **PRACTICE: NO TIME LIMIT** (always practice, starts level 1) and **Settings -> MODE: STANDARD / NO TIME LIMIT** (saved; decides what START and HOW TO PLAY -> START do). Works with slow mode and with music off.
* **Rules** (`Rules.startLevel(idx, seed, speed, {noLimit: true})`): the level never ends at its last bar. Targets are generated lazily, one **pass** (= the level's bars) at a time, half a pass ahead of the clock, from the same bar rules (`buildTargets(L, li, pass)`). Pass 0 is *identical* to the standard level; later passes use a per-pass seed (`1000 + level*77 + pass*131`) so mark/drift directions differ. Old targets are pruned. The flip / invert schedule repeats each pass; the tutorial coach runs only in pass 0, then shows a practice hint. Deterministic: same seed => same targets and same state for the same inputs (unit-tested).
* **Drift**: the mark creep multiplier rises smoothly x1.0 -> **x1.5 over 3 passes, then caps** (`NL_CREEP_MAX`). Tilt oscillation and kicks are unchanged, so it never becomes impossible.
* **No countdown, no failing**: nothing ends the level except the zero set. Freezes, ESC, lasers, tilt lock, arrows, slow mode all work. Score and combo count.
* **Ending**: when the zero meter fills, the world pauses and a **NEW ZERO SET** card offers **CONTINUE: NEXT LEVEL** (ends the level, result screen tagged `NO LIMIT`) or **STAY & KEEP PRACTICING** (meter resets to 0, practice continues; another zero set offers again but the +1000 is paid once per level). **EXIT PRACTICE** on the pause screen leaves to the menu without recording a result (it replaces QUIT TO MENU in this mode).
* **Grade**: any NO TIME LIMIT result caps the final letter at **B** (S/A become B; C/D untouched), stacked with the slow-mode cap at A. Results/final/credits say NO LIMIT; the HUD shows `NO LIMIT` beside the level name. No leaderboard exists, so nothing else is affected.
* **Audio loop**: `GameAudio.play(offset, {loopStart, loopEnd, xfade})` with `loopStart/End` = the level's first/last bar line (level 1: bars 0-20, level 2: 20-40, level 3: 40-60; levels 2/3 still start with their lead-in bar). Instead of `source.loop`, it chains buffer sources scheduled sample-accurately on the audio clock; each runs 6 ms past the loop end while the next fades in from the loop start over the same 6 ms (equal-power crossfade), so the jump is smoothed: no click. Segments are topped up every second (3 loops ahead). The same chain runs muted through `musicGain` when MUSIC is OFF, and at `playbackRate = s` in slow mode. **Clock**: `songTime(true)` is the *unwrapped* audio-clock position (monotonic), which the rules use as level time; `songTime()` (wrapped) is only used for display. Taps use the same unwrapped time, so judging cannot see the loop. BEAT TICK uses unwrapped beat times too. HTML-audio fallback: loops with a seek at the loop point (may click; no crossfade).
* Pause/resume: `AudioContext.suspend()` freezes the clock and the scheduled chain together; the level clock resumes where it stopped.

## MUSIC / SFX / BEAT TICK
Settings: **MUSIC: ON/OFF**, **SFX: ON/OFF**, **BEAT TICK: ON/OFF** (all saved in localStorage), next to the existing master MUTE and VOLUME. Quick toggles: a **note button** in the HUD next to the speaker (48 px, crossed out when music is off) and a **MUSIC** button on the pause screen.
* Audio graph: `song source -> musicGain -> master gain -> out` and `blips / laser zaps -> sfxGain -> master gain`. **MUSIC off sets only `musicGain` to 0**: the song keeps playing silently through it, so `AudioContext.currentTime` / the beat clock, the rings and the judging stay exactly in sync (also at 85% / 70%, where the source runs at `playbackRate = s`). SFX (PERFECT/GOOD/MISS blips, laser fire/hit zaps, freeze, ESC, tilt lock) stay audible. In the `<audio>` fallback MUSIC off = `muted`, the clock (`currentTime`) still runs.
* Because the kick is the cue, with music off the grid/sun pulse on the beat is stronger, the rings are thicker with a glow that fills in as they close, and four **beat dots** under the HUD show the beat of the bar (white = downbeat). **BEAT TICK** is a separate quiet metronome click scheduled on the audio clock at `startCtx + (beatTime - startOffset) / rate`, so it is exact at any speed; it goes through the master gain only (works with SFX off). Default off.
* The title video keeps its own audio and follows only MASTER mute/volume.

## GAME SPEED (slow mode)
Settings -> **GAME SPEED: 100% / 85% / 70%** (cycle button, saved in localStorage; the label says SLOW MODE below 100%). The pause screen has the same cycle button; a change applies from the next level (or a restart), never mid-level, so nothing desyncs.
* **Music is muted for that level.** The track still plays at `playbackRate = s` so the beat clock, rings, and judgments stay locked to the kicks, but `musicGain` is 0 for the whole level (the same path as MUSIC OFF: thicker rings, a stronger pulse, beat dots). SFX stay on. The saved MUSIC toggle is not changed, so 100% speed brings the song back. Menu, result, and credits beds play at full speed and follow the MUSIC toggle. The speed button reads **SLOW, MUSIC MUTED**. A change of speed still applies on the next level or a restart, so a 100% level that is already playing is not silenced mid-song.
* **Rules run in song time** (seconds of the track): `songTime = startOffset + (ctx.currentTime - start - outputLatency) * s`. So targets, rings, drift kicks, creep, flip/invert windows, narrator and tilt-arrow speed (deg per song second) all slow down by exactly `s`, and stay locked to the audio. `rules.js` takes the speed only as a constructor argument of the level (`startLevel(idx, seed, speed)`) to convert wall-clock constants.
* **Wall-clock quantities** (converted to song time with `x s`): judgment windows, the 3 s freeze and its 0.4 s dwell, the zero meter (counts wall seconds in the zone, so a slower, longer level is easier to fill), tilt lock 5 s / cooldown 4 s, latency offset and calibration (ms of real time), haptics/toasts/animations. The level takes `38.7 s / s` of wall time (55 s at 70%).
* A wall window of w ms equals `w x s` ms of song time (the song moves slower than the wall), then widened a little in slow mode:

| speed | PERFECT (wall) | GOOD (wall) | in song time (P / G) |
|---|---|---|---|
| 100% | +-75 ms | +-145 ms | 75 / 145 ms |
| 85% SLOW | +-85 ms | +-160 ms | 72.3 / 136.0 ms |
| 70% SLOW | +-95 ms | +-180 ms | 66.5 / 126.0 ms |

* **Grade**: any level played below 100% tags the result "SLOW MODE", and the final letter is **capped at A** (an S becomes A) so scores stay comparable. HUD shows `SLOW 85%` next to the level name; result, final and credits screens say SLOW MODE too. The title video and the credits music are not slowed.

## Judgment windows and audio sync
* At 100%: PERFECT +-75 ms, GOOD +-145 ms, EARLY/LATE up to +-245 ms (miss), expiry at +185 ms. Slow-mode windows: see GAME SPEED.
* **Beat clock** = the audio. The track is fetched and decoded into an `AudioBuffer`; `source.start(when, offset)` runs it.
  `songTime = ctx.currentTime (interpolated with performance.now between 128-sample render quanta) - outputLatency - baseLatency`,
  i.e. the part of the song being *heard*. Level time = songTime - startBar*1.9355 s. Rules never read a clock: they get the time as an argument.
* A tap is stamped with the **pointer event's own `timeStamp`** and converted (`songTime now - age of the event`), so frame-rate
  and main-thread delays do not move the judgment. Then the user latency offset is subtracted (positive = you tap late).
* **Calibrate** (Settings): 10 metronome clicks scheduled on the audio clock; the median of (tap - click) after the first 2 taps becomes the offset.
* Fallbacks: no WebAudio or decode failure -> `<audio>.currentTime`; no audio at all -> a performance.now timer (silent but playable).
* Pausing suspends the AudioContext, so the beat clock stops with the music. The tab going to the background pauses the game.
* Measured in headless Chromium (see `screenshots/_e2e-report.json`): the browser-decoded MP3 has no extra start delay vs the original WAV
  (kick positions within about 1 ms of the 124 BPM grid).

## Files
```
index.html            all screens (DOM overlays), styles
js/rules.js           PURE rules: levels, targets (from the track's kick plan), drift, judging, tilt, narrator, zero set, freeze, grade. Seeded RNG (mulberry32), stateless hash for the display
js/audio.js           WebAudio beat clock + <audio> fallback + click/blip synth
js/render.js          canvas renderer: sky, banded sun, perspective grid, chrome Orbitron letters, RGB-split glitch on MIS, scanlines, vignette, HUD
js/main.js            screen state machine (boot -> title video -> menu -> how-to -> intro -> play <-> pause -> result -> final -> credits), input, settings, glue
assets/stomp-signal.mp3   the title track Misaligned, 160 kbps stereo (2.3 MB). The filename stays; the credits and tags say Misaligned.
assets/title.mp4 / .webm  the 10 s title video (720p H.264+AAC 2.3 MB; 540p VP9+Opus fallback 1.0 MB)
assets/poster.jpg     poster + credits frame (the video's last frame)
assets/*.woff2        Orbitron 900/700 and Space Mono 400/700, subsetted (SIL OFL, see OFL-*.txt)
tests/rules.test.js   node tests for the pure rules (determinism, ESC, arrows, inverted reversal, speed windows, tilt lock): `node tests/rules.test.js`
tests/e2e.py          Playwright end-to-end run (iPhone 13 + Pixel 7 touch emulation, landscape, desktop, reduced motion) that produces screenshots/
screenshots/          01-start.png ... 44-orb-caught.png (43 energy orb approaching with the catcher, 44 orb caught: +10s, 38 no-limit gameplay, 39 NEW ZERO SET offer, 40 menu with PRACTICE, 41 pause with EXIT PRACTICE, 42 no-limit result, 24 arrows, 25 ESC while frozen, 26 gameplay right after START, 28 settings speed, 29 slow play, 30 tilt lock, 31 laser while frozen, 32 music-off settings, 34 tilt lock at 85%, 35 pause speed, 36 HUD with music off, 37 pause music), _e2e-report.json
```

## Design notes
* Rules (`Rules.*`) take `(state, levelTime, input)` and return events (`judge`, `drift`, `frozen`, `thaw`, `zeroset`, `flip`, `invert`, `end`). The renderer only reads the state. Headless check: `node -e "require('./js/rules.js')"` runs the same rules in Node (an autoplayer finishes all 3 levels with 100% accuracy and 3 Zero Sets).
* Everything random is seeded: level drift directions, tilt waves, thaw kicks, the narrator's jitter/blips (`hash01(seed, time bucket)`), so a run is reproducible from the seed (`session.seed`).
* The narrator is a character, not a UI: it flatters you toward 100% (the freeze trap) and scolds you inside the green zone.
* Mobile: `viewport-fit=cover` + `env(safe-area-inset-*)` (read into the canvas layout through a probe element), `touch-action: none`, `overscroll-behavior: none`, no scroll bounce, no hover-only UI, all buttons >= 48 px (most 56 px), canvas DPR capped at 2, text >= 11 px.
* `prefers-reduced-motion` (and the Settings toggle): no screen shake, no flash, no RGB-split/glitch, no grid inversion animation, static credits (scrollable).
* Title: first tap unlocks audio and plays `title.mp4` with sound (`playsinline`, poster, SKIP); on end/skip it fades into the menu (a looping verse bed of the track plays under the menu). If the video cannot play (codec, autoplay block, stall > 4.5 s) the game goes straight to the menu.
* Fonts: Orbitron (title/numbers) and Space Mono (UI) are OFL. They were subsetted/instanced and **renamed** ("MIS Display", "MIS Mono") because the OFL Reserved Font Name rule forbids reusing "Orbitron" for modified files; the OFL texts are in `assets/`.

## Known limits
* Prototype balance: difficulty, windows and drift were tuned only by an automatic player, not by humans. Not yet played on a real phone.
* Bluetooth headphones: output latency is estimated from `outputLatency`/`baseLatency` (missing on iOS Safari) - use Calibrate.
* iOS Safari: `navigator.vibrate` is unsupported (no haptics); video volume cannot be changed from JS (system volume only).
* The very first beat of a level starts about 0.05-0.1 s after the level begins (the audio start delay) - L2/L3 have a 1-bar lead-in for that.
* Slow mode: pitch drops with tempo (no time-stretch, on purpose). `playbackRate` is a float32 parameter, so 0.85 is stored as 0.85000002 (a 3e-8 relative clock error, irrelevant).
* The arrow buttons sit over the edges of the play area: the coach panel narrows to stay clear of them on short screens.
* A second finger landing in the play area while another finger is also in the play area becomes a twist, so the first finger's tap has already counted (-15 if it was off-beat).
* Level 2's breakdown has no kick, so only the ring and the pad pump give the timing there (one target per bar).
* Credits scroll is CSS-timed (26 s) and not synced to the music; the credits music is a loop of the peak chorus.
* Music: *Misaligned* (file `assets/stomp-signal.mp3`) is synthesized (no samples, no vocals). It has not been listened to by a human yet.
* The title video was re-encoded to 720p for phones (audio stream copied unchanged); the 1080p master is `../../music-library/videos/misaligned-title-test-10s.mp4`.
* NO TIME LIMIT loop: the loop join is a bar line of the track (the end of a section jumps back to its first bar), so musically it is a hard cut from the section's last bar (a build in level 1) to its first bar; it is click-free (6 ms crossfade, verified on the audio bus) but it has not been listened to by a human.
