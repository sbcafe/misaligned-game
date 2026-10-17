# AGENTS.md: notes for agents working on MISALIGNED

Shared notes for every agent that touches this game (Grok Build, the Three.js bot, Grok Bot). Read this before changing anything and update it when something here changes. The README is the full design doc. This file only covers where things live and how to ship them safely.

## Where things live
- **Public repo:** `sbcafe/misaligned-game`, branch `main`. GitHub Pages serves the repo root at https://sbcafe.github.io/misaligned-game/, so a push to `main` updates the live game. Game files (`index.html`, `js/`, `assets/`, `tests/`) sit at that root.
- **Working copy:** Grok Build edits `~/misaligned-game/mobile/`. That folder is not a git checkout. `~/misaligned-game` is not a git repository. No clone of this repo lives under `~`. Sibling folders there are not published: `album/`, `mobile.old/`, `mobile.bak-*`, `serve.py`, and `shots/`.
- **How we published:** `mobile/` is the source tree. It is copied into a temporary clone at `/tmp/misaligned-pages`, and that clone is what gets pushed. `/tmp/misaligned-pages` does not last across sessions.

### Exact steps used
**11 Oct 2026** (first publish, `b21a31f`):
1. Copy `~/misaligned-game/mobile/.` into a new directory `/tmp/misaligned-pages`.
2. Add `.nojekyll`, `git init -b main`, commit, create the GitHub repo, and push `main`. The repo later moved to `sbcafe/misaligned-game`.

**16 Oct 2026** (tap-the-letter, `a03117e`):
1. `gh repo clone sbcafe/misaligned-game /tmp/misaligned-pages`
2. `rsync -a --delete --exclude '.git' --exclude '.nojekyll' --exclude screenshots ~/misaligned-game/mobile/ /tmp/misaligned-pages/`
3. Commit on `main` and push with `git -c credential.helper='!gh auth git-credential' push origin main`

### Recommended stable flow
Make `~/misaligned-game/mobile` the durable clone of this repo (git root = the same files Pages already serves). Ignore `screenshots/`. Then edit, test, commit, and push in that folder with no copy step. Until that is done, repeat the 16 Oct rsync into a fresh `/tmp/misaligned-pages`; do not assume that path still exists.

## Before you change anything
1. Check `git log origin/main` against your working copy. Another agent may have pushed since you last looked. Never overwrite newer work from a stale copy.
2. Back up first if the working copy isn't a git checkout: `cp -a mobile mobile.bak-YYYY-MM-DD-<what>`.

## Run and test
- Local serve: `python3 serve.py 8765` from `~/misaligned-game` (Range requests for iOS audio and video). From this repo clone, `python3 -m http.server 8765` at the clone root. From the working copy, the same command from `~/misaligned-game/mobile`.
- Rules tests: `node tests/rules.test.js` from this repo root, or from `~/misaligned-game/mobile`. Must pass, and the count should only go up.
- End-to-end: `PORT=8765 <venv with playwright>/bin/python tests/e2e.py`, with the server running. If a check fails because the design changed, fix the check and say so in the commit message.
- After any JS change, bump the `?v=N` cache-buster in `index.html` (currently `v=15`) so phones don't keep running old files.

## Publishing
- Push to `main` only after both test suites pass.
- One commit per change, with a message that says what changed for the player.
- Rules stay pure (`js/rules.js`) and rendering stays separate (`js/render.js`). Tests target the rules.
- Until `mobile/` is the durable clone, publish by rsyncing it into a fresh `/tmp/misaligned-pages` as on 16 Oct, then commit and push from that clone. Push with `git -c credential.helper='!gh auth git-credential'` so https does not prompt.

## Never commit
- LAN IPs, hostnames, machine IDs, `/home/al/...` paths in code, tokens or keys.
- `screenshots/`, `mobile.bak-*`, `server.log`, or other local output.
- New third-party assets without their license. The code, music, video and poster are all rights reserved (see Notice in the README). The fonts are OFL.

## Licensing
This repo is public to read and play, not open source, and it doesn't accept pull requests. Don't add a license file unless Alex says so.
