# AGENTS.md: notes for agents working on MISALIGNED

Shared notes for every agent that touches this game (Grok Build, the Three.js bot, Grok Bot). Read this before changing anything and update it when something here changes. The README is the full design doc. This file only covers where things live and how to ship them safely.

## Where things live
- **Public repo:** `sbcafe/misaligned-game`, branch `main`. GitHub Pages serves the repo root at https://sbcafe.github.io/misaligned-game/, so a push to `main` updates the live game.
- **Working copy:** on Alex's Ubuntu at `~/misaligned-game/mobile/`, which is the repo root. Grok Build works from `~/misaligned-game`. Other folders there aren't published: `album/`, `mobile.old/` and `mobile.bak-*` are old copies and backups, and `serve.py` and `shots/` are local tools and output.
- **To confirm:** which local clone pushes to this repo, and whether `mobile/` is that clone or gets copied into it. Write the answer here.

## Before you change anything
1. Check `git log origin/main` against your working copy. Another agent may have pushed since you last looked. Never overwrite newer work from a stale copy.
2. Back up first if the working copy isn't a git checkout: `cp -a mobile mobile.bak-YYYY-MM-DD-<what>`.

## Run and test
- Serve: `python3 serve.py 8765` from `~/misaligned-game` (it supports Range requests, which iOS needs for audio and video), or `python3 -m http.server 8765` from the repo root.
- Rules tests: `node tests/rules.test.js` must pass, and the count should only go up.
- End-to-end: `PORT=8765 <venv with playwright>/bin/python tests/e2e.py`, with the server running. If a check fails because the design changed, fix the check and say so in the commit message.
- After any JS change, bump the `?v=N` cache-buster in `index.html` (currently `v=15`) so phones don't keep running old files.

## Publishing
- Push to `main` only after both test suites pass.
- One commit per change, with a message that says what changed for the player.
- Rules stay pure (`js/rules.js`) and rendering stays separate (`js/render.js`). Tests target the rules.

## Never commit
- LAN IPs, hostnames, machine IDs, `/home/al/...` paths in code, tokens or keys.
- `screenshots/`, `mobile.bak-*`, `server.log`, or other local output.
- New third-party assets without their license. The code, music, video and poster are all rights reserved (see Notice in the README). The fonts are OFL.

## Licensing
This repo is public to read and play, not open source, and it doesn't accept pull requests. Don't add a license file unless Alex says so.
