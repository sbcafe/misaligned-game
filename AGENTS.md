# AGENTS.md: notes for agents working on MISALIGNED

Shared notes for every agent that touches this game (Grok Build, the Three.js bot, Grok Bot). Read this before changing anything and update it when something here changes. The README is the full design doc. This file only covers where things live and how to ship them safely.

## Where things live
- **Public repo:** `sbcafe/misaligned-game`, branch `main`. GitHub Pages serves the repo root at https://sbcafe.github.io/misaligned-game/, so a push to `main` updates the live game. Game files (`index.html`, `js/`, `assets/`, `tests/`) sit at that root.
- **Clone:** `~/misaligned-game/mobile` is the durable git checkout of this repo (`origin` = `https://github.com/sbcafe/misaligned-game.git`, branch `main`). Grok Build's workspace is the parent `~/misaligned-game`; git commands for this repo run inside `mobile/`.
- **Not published:** sibling folders in `~/misaligned-game` stay local: `album/`, `mobile.old/`, `mobile.bak-*`, `serve.py`, and `shots/`. `screenshots/` inside this clone is gitignored.

## Before you change anything
1. `git fetch origin` and check `git log origin/main` against your working copy. Another agent may have pushed since you last looked. Never overwrite newer work from a stale copy.
2. For a large or risky change, back up from the parent: `cp -a mobile mobile.bak-YYYY-MM-DD-<what>`.

## Run and test
- Local serve: `python3 serve.py 8765` from `~/misaligned-game` (Range requests for iOS audio and video; it serves `./mobile`). Or `python3 -m http.server 8765` from this clone.
- Rules tests: `node tests/rules.test.js` from this clone. Must pass, and the count should only go up.
- End-to-end: `PORT=8765 <venv with playwright>/bin/python tests/e2e.py`, with the server running. If a check fails because the design changed, fix the check and say so in the commit message.
- After any JS change, bump the `?v=N` cache-buster in `index.html` (currently `v=15`) so phones don't keep running old files.

## Publishing
- Edit, test, commit, and `git push origin main` from this clone. Do not copy the tree into `/tmp/misaligned-pages`; that flow is retired.
- Push to `main` only after both test suites pass.
- One commit per change, with a message that says what changed for the player.
- Rules stay pure (`js/rules.js`) and rendering stays separate (`js/render.js`). Tests target the rules.
- Repo-local identity and the `gh` credential helper are already set. Plain `git push` is enough.

## Never commit
- LAN IPs, hostnames, machine IDs, `/home/al/...` paths in code, tokens or keys.
- `screenshots/`, `mobile.bak-*`, `server.log`, or other local output.
- New third-party assets without their license. The code, music, video and poster are all rights reserved (see Notice in the README). The fonts are OFL.

## Licensing
This repo is public to read and play, not open source, and it doesn't accept pull requests. Don't add a license file unless Alex says so.
