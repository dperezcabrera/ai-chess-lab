# Game viewer

A static site to browse and analyse every game of a tournament. It needs no server, so it can be put on GitHub Pages as it is.

- **Tournament page:** standings with tie-breaks, engine accuracy and cost, charts, a crosstable and every game as a small board, filtered by round, player, result or ending.
- **Game page:** the board with an advantage bar, the moves marked as best, inaccuracy, mistake or blunder, and the advantage and thinking-time graphs. For each move it shows time, tokens, cost, the raw reply, the illegal answers and Jev's probabilities. A live Stockfish button analyses any position in the browser.

## Build

```bash
.venv/bin/python viewer/build.py tournaments/<id>.json --human-name David
python -m http.server -d viewer/dist
```

The build splits each tournament into a small summary file and one file per game, so the browser only downloads what it shows. With Stockfish available (`STOCKFISH`, `PATH` or `.venv/bin/stockfish`) it evaluates every position at `--depth` (14 by default). Evaluations already built for the same moves and depth are reused, so a rebuild only analyses new games. Several tournament files can be passed at once, and the output keeps the ones built earlier.

## Publish on GitHub Pages

```bash
cd viewer/dist
git init -b gh-pages && git add . && git commit -m "Game viewer"
git push -f https://github.com/dperezcabrera/system-one-chess.git gh-pages
```

Then choose the `gh-pages` branch as the source in the repository's Pages settings.

## Release a tournament round by round

`--rounds N` builds the site as the tournament stood after round N. The standings, the rank history and the highlights come from those rounds alone. Later games are left out of the output, and the pairings of the next round appear as a teaser. The human player's time, tokens and cost are never published.

`release.sh` builds a round into a separate site repository and commits it there:

```bash
viewer/release.sh tournaments/<id>.json 2 ../ai-chess-battle
git -C ../ai-chess-battle push
```

Engine evaluations are cached in `viewer/cache`, so a release only analyses its new games.
