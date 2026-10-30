# Pawnbreaker — a chess roguelike (Alpha v0.3)

Play: **https://pawnbreaker.app**

Chess in the spirit of Balatro: beat the bot, earn gold for captures, collect 120 relics, upgrade your pieces and face 12 bosses named after chess openings (atomic chess, fog of war, antichess, king of the hill, three-check, minefield and more). Static site — no build step; runs offline in the browser.

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
(Needs http(s), not file:// — Stockfish runs in a Web Worker.)

## Licence
Pawnbreaker is free software under the **GNU General Public License v3.0** (see `LICENSE`), because it bundles GPL components:

- Board UI: [chessground](https://github.com/lichess-org/chessground) 9.2.1 by lichess.org — GPL-3.0 (`vendor/chessground/LICENSE`)
- Engine: [Stockfish.js](https://github.com/nmrugg/stockfish.js) 11 (Stockfish by T. Romstad, M. Costalba, J. Kiiski, G. Linscott and contributors) — GPL-3.0 (`vendor/stockfish/Copying.txt`)
- Pieces: cburnett set — GPL-2.0-or-later
- Move validation: [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 — BSD-2-Clause (`vendor/chessjs/LICENSE`)
- Font: Rubik — SIL OFL 1.1 (`vendor/fonts/OFL-Rubik.txt`)

The complete corresponding source is this repository (all files are unminified sources except the upstream vendor builds, whose sources are linked above). See `CREDITS.md`.
