"""Builds the static game viewer: a folder you can put on GitHub Pages as it is.

Reads saved tournament files (`tournaments/<id>.json`) and writes, into the output folder, the site itself plus
the data split so that the browser only fetches what it shows:

    data/tournaments.json            the list of tournaments
    data/<id>/tournament.json        players, standings, tie-breaks, rounds and a summary line per game
    data/<id>/games/r<R>-b<B>.json   one game: every ply with its position, time, tokens, cost, call and evaluation
    data/<id>/tournament.pgn         every game in PGN
    logos/<key>.png                  the players' logos, downloaded once

With Stockfish (STOCKFISH, PATH or .venv/bin/stockfish) every position is evaluated at --depth, in parallel, and
each move is judged the way lichess does it (win chance lost: inaccuracy, mistake, blunder; accuracy per move).
Evaluations already in the output for the same moves and depth are reused, so rebuilding after a new round only
analyses the new games. Usage:

    .venv/bin/python viewer/build.py tournaments/<id>.json --out viewer/dist --human-name David
    python -m http.server -d viewer/dist
"""

import argparse
import json
import math
import os
import shutil
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import chess
import chess.engine
import chess.pgn
import httpx

ROOT = Path(__file__).resolve().parent.parent
SITE = Path(__file__).resolve().parent / "site"
VENDOR = ROOT / "system_one_chess" / "static" / "vendor"
MODELS_FILE = ROOT / "system_one_chess" / "models.json"
SYSTEM_ONE = {"jev": "Jev", "laya": "Laya", "kev": "Kev"}
MATE_CP = 1000
JUDGEMENTS = (("blunder", 0.3), ("mistake", 0.2), ("inaccuracy", 0.1))


def win_chances(cp: float) -> float:
    """Lichess's winning chances in [-1, 1] from the mover's side."""
    cp = max(-MATE_CP, min(MATE_CP, cp))
    return 2 / (1 + math.exp(-0.00368208 * cp)) - 1


def move_accuracy(before: float, after: float) -> float:
    """Lichess's move accuracy from the win percentage before and after the move, mover's side."""
    before, after = 50 + 50 * before, 50 + 50 * after
    if after >= before:
        return 100.0
    return max(0.0, min(100.0, 103.1668 * math.exp(-0.04354 * (before - after)) - 3.1669))


def find_stockfish() -> str | None:
    for path in (os.environ.get("STOCKFISH"), shutil.which("stockfish"), str(ROOT / ".venv" / "bin" / "stockfish")):
        if path and Path(path).exists():
            return path
    return None


def player_name(model_id: str, human: str) -> str:
    if model_id == "human":
        return human
    return SYSTEM_ONE.get(model_id) or model_id.removeprefix("llm:").split("/", 1)[-1]


def logo_key(model_id: str) -> str:
    return model_id.removeprefix("llm:").split("/", 1)[0] if model_id.startswith("llm:") else model_id


def download_logos(ids: list[str], out: Path) -> dict[str, str]:
    logos = json.loads(MODELS_FILE.read_text()).get("logos", {})
    folder = out / "logos"
    folder.mkdir(exist_ok=True)
    found = {}
    for key in {logo_key(model_id) for model_id in ids}:
        if key not in logos:
            continue
        target = folder / f"{key}.png"
        if not target.exists():
            try:
                response = httpx.get(logos[key], timeout=20, follow_redirects=True)
                response.raise_for_status()
                target.write_bytes(response.content)
            except httpx.HTTPError as error:
                print(f"  logo {key}: {error}", file=sys.stderr)
                continue
        found[key] = f"logos/{key}.png"
    return found


def termination_of(board: chess.Board, game: dict, result: str | None) -> str:
    """Why the game ended, in words, including the ends the board cannot see: illegal answers, the clock."""
    if game.get("forfeited"):
        return "illegal moves"
    if game.get("timed_out"):
        return "time forfeit"
    outcome = board.outcome()
    if outcome is not None:
        return outcome.termination.name.lower().replace("_", " ")
    if board.is_repetition(3):
        return "threefold repetition"
    if board.is_fifty_moves():
        return "fifty moves"
    if result == "1/2-1/2" and board.can_claim_threefold_repetition():
        return "repetition (claimable)"
    if result == "1/2-1/2" and board.can_claim_fifty_moves():
        return "fifty moves (claimable)"
    return "unfinished" if not result else "adjudicated"


class Engines:
    """A pool of Stockfish processes, one per thread, each analysing whole games."""

    def __init__(self, path: str, depth: int):
        self.path, self.depth = path, depth
        self._local = threading.local()
        self._all: list[chess.engine.SimpleEngine] = []
        self._lock = threading.Lock()

    def _engine(self) -> chess.engine.SimpleEngine:
        if not hasattr(self._local, "engine"):
            engine = chess.engine.SimpleEngine.popen_uci(self.path)
            engine.configure({"Threads": 1, "Hash": 64})
            self._local.engine = engine
            with self._lock:
                self._all.append(engine)
        return self._local.engine

    def evaluate(self, moves: list[str]) -> list[dict]:
        """White's evaluation and the best move of the start and of every position after each move."""
        engine = self._engine()
        board = chess.Board()
        evals = []
        for index in range(len(moves) + 1):
            if index:
                board.push_uci(moves[index - 1])
            if board.is_game_over():
                if board.is_checkmate():
                    evals.append({"cp": -MATE_CP if board.turn == chess.WHITE else MATE_CP, "mate": 0, "best": None})
                else:
                    evals.append({"cp": 0, "mate": None, "best": None})
                continue
            info = engine.analyse(board, chess.engine.Limit(depth=self.depth))
            score = info["score"].white()
            pv = info.get("pv") or []
            evals.append(
                {
                    "cp": score.score(mate_score=100000) if not score.is_mate() else (MATE_CP if score.mate() > 0 else -MATE_CP),
                    "mate": score.mate(),
                    "best": board.san(pv[0]) if pv else None,
                    "best_uci": pv[0].uci() if pv else None,
                }
            )
        return evals

    def close(self) -> None:
        for engine in self._all:
            engine.quit()


def judge(plies: list[dict], evals: list[dict]) -> None:
    """Adds to every ply the evaluation after it, the move the engine preferred and how much the move cost."""
    for index, ply in enumerate(plies):
        before, after = evals[index], evals[index + 1]
        sign = 1 if ply["colour"] == "white" else -1
        cp_before = max(-MATE_CP, min(MATE_CP, before["cp"])) * sign
        cp_after = max(-MATE_CP, min(MATE_CP, after["cp"])) * sign
        wc_before, wc_after = win_chances(cp_before), win_chances(cp_after)
        ply["eval"] = {"cp": after["cp"], "mate": after["mate"]}
        ply["best"] = before.get("best")
        ply["best_uci"] = before.get("best_uci")
        ply["loss"] = max(0, cp_before - cp_after)
        ply["accuracy"] = round(move_accuracy(wc_before, wc_after), 1)
        drop = wc_before - wc_after
        ply["judgement"] = next((name for name, limit in JUDGEMENTS if drop >= limit), None)
        if ply["judgement"] is None and before.get("best_uci") == ply["uci"]:
            ply["judgement"] = "best"


def build_game(entry: dict, round_number: int, board_number: int, previous: dict | None, engines: Engines | None):
    game = entry["game"]
    records = {m["ply"]: m for m in game.get("moves", [])}
    board = chess.Board()
    plies = []
    for index, uci in enumerate(game["moves_uci"], 1):
        move = chess.Move.from_uci(uci)
        record = records.get(index, {})
        colour = "white" if board.turn == chess.WHITE else "black"
        san = board.san(move)
        board.push(move)
        call = record.get("call") or {}
        plies.append(
            {
                "ply": index,
                "colour": colour,
                "player": record.get("player") or entry[colour],
                "san": san,
                "uci": uci,
                "fen": board.fen(),
                "check": board.is_check(),
                "seconds": round(float(record.get("seconds") or 0), 2),
                "input_tokens": record.get("input_tokens"),
                "output_tokens": record.get("output_tokens"),
                "cost_usd": record.get("cost_usd"),
                "illegal_answers": record.get("illegal_answers") or [],
                "forced": bool(record.get("forced")),
                "top": record.get("top") or [],
                "at": record.get("at"),
                "call": {
                    key: call.get(key)
                    for key in ("reply", "finish_reason", "reasoning_chars", "blanks", "truncated", "schema", "max_tokens")
                    if call.get(key) not in (None, "", 0, False)
                },
            }
        )
    evals = None
    depth = None
    if previous and previous.get("moves_uci") == game["moves_uci"] and previous.get("evals"):
        if engines is None or previous.get("depth") == engines.depth:
            evals, depth = previous["evals"], previous.get("depth")
    if evals is None and engines is not None and game["moves_uci"]:
        evals, depth = engines.evaluate(game["moves_uci"]), engines.depth
    if evals:
        judge(plies, evals)
    result = entry["result"]
    return {
        "round": round_number,
        "board": board_number,
        "white": entry["white"],
        "black": entry["black"],
        "result": result,
        "termination": termination_of(board, game, result),
        "fen": board.fen(),
        "moves_uci": game["moves_uci"],
        "plies": plies,
        "evals": evals,
        "depth": depth,
        "illegal": game.get("illegal", {}),
        "pardons": game.get("pardons", 0),
        "usage": game.get("usage_by_colour", {}),
        "pgn": entry.get("pgn", ""),
    }


def summarize_game(game: dict, file: str) -> dict:
    usage = game["usage"]
    sides = {}
    for colour in ("white", "black"):
        mine = [p for p in game["plies"] if p["colour"] == colour]
        judged = [p for p in mine if "accuracy" in p]
        sides[colour] = {
            "seconds": round(sum(p["seconds"] for p in mine), 1),
            "cost_usd": round(usage.get(colour, {}).get("cost_usd", 0.0), 6),
            "accuracy": round(sum(p["accuracy"] for p in judged) / len(judged), 1) if judged else None,
            "blunders": sum(p.get("judgement") == "blunder" for p in mine),
            "mistakes": sum(p.get("judgement") == "mistake" for p in mine),
        }
    last = game["plies"][-1]["uci"] if game["plies"] else None
    return {
        "board": game["board"],
        "white": game["white"],
        "black": game["black"],
        "result": game["result"],
        "termination": game["termination"],
        "plies": len(game["plies"]),
        "fen": game["fen"],
        "last": [last[:2], last[2:4]] if last else None,
        "file": file,
        "sides": sides,
    }


def standings(data: dict, games: list[dict], human: str, logos: dict[str, str]) -> list[dict]:
    rows_saved = data["standings"]["rows"]
    points = {pid: row["points"] for pid, row in rows_saved.items()}
    rows = []
    for pid, row in rows_saved.items():
        faced = sorted(points.get(o, 0.0) for o in data["opponents"].get(pid, []))
        mine = [p for g in games for p in g["plies"] if p["player"] == pid]
        judged = [p for p in mine if "accuracy" in p]
        moves = len(mine)
        rows.append(
            {
                "id": pid,
                "name": player_name(pid, human),
                "logo": logos.get(logo_key(pid), ""),
                "games": row["games"],
                "wins": row["wins"],
                "draws": row["draws"],
                "losses": row["losses"],
                "points": row["points"],
                "byes": row.get("byes", 0),
                "forfeits": row.get("forfeits", 0),
                "illegal": row.get("illegal", 0),
                "buchholz_cut1": sum(faced[1:]) if faced else 0.0,
                "buchholz": sum(faced),
                "buchholz_cut2": sum(faced[2:]) if len(faced) > 1 else 0.0,
                "sonneborn_berger": sum(points.get(o, 0.0) * e for o, e in data["scores"].get(pid, [])),
                "moves": moves,
                "seconds": round(sum(p["seconds"] for p in mine), 1),
                "seconds_per_move": round(sum(p["seconds"] for p in mine) / moves, 2) if moves else None,
                "input_tokens": row.get("input_tokens", 0),
                "output_tokens": row.get("output_tokens", 0),
                "cost_usd": round(row.get("cost_usd", 0.0), 6),
                "accuracy": round(sum(p["accuracy"] for p in judged) / len(judged), 1) if judged else None,
                "acpl": round(sum(min(p["loss"], MATE_CP) for p in judged) / len(judged), 1) if judged else None,
                "best_rate": round(sum(p.get("judgement") == "best" for p in judged) / len(judged), 3) if judged else None,
                "inaccuracies": sum(p.get("judgement") == "inaccuracy" for p in mine),
                "mistakes": sum(p.get("judgement") == "mistake" for p in mine),
                "blunders": sum(p.get("judgement") == "blunder" for p in mine),
            }
        )
    rows.sort(
        key=lambda r: (-r["points"], -r["buchholz_cut1"], -r["buchholz"], -r["buchholz_cut2"], -r["sonneborn_berger"], -r["wins"], r["cost_usd"], r["name"])
    )
    for rank, row in enumerate(rows, 1):
        row["rank"] = rank
    return rows


def build_tournament(path: Path, out: Path, human: str, engines: Engines | None, jobs: int) -> dict:
    data = json.loads(path.read_text())
    tid = data["id"]
    folder = out / "data" / tid
    (folder / "games").mkdir(parents=True, exist_ok=True)
    logos = download_logos(data["participants"], out)
    tasks = []
    for round_number, round_ in enumerate(data["rounds"], 1):
        for board_number, entry in enumerate(round_["pairings"], 1):
            file = f"games/r{round_number}-b{board_number}.json"
            target = folder / file
            previous = json.loads(target.read_text()) if target.exists() else None
            tasks.append((round_number, board_number, entry, previous, file))
    done = [0]

    def work(task):
        round_number, board_number, entry, previous, file = task
        game = build_game(entry, round_number, board_number, previous, engines)
        (folder / file).write_text(json.dumps(game, separators=(",", ":")))
        done[0] += 1
        print(f"\r  {tid}: {done[0]}/{len(tasks)} games", end="", file=sys.stderr, flush=True)
        return game, file

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        results = list(pool.map(work, tasks))
    print(file=sys.stderr)
    games = [game for game, _ in results]
    rounds = []
    for round_number, round_ in enumerate(data["rounds"], 1):
        mine = [summarize_game(g, f) for g, f in results if g["round"] == round_number]
        rounds.append({"number": round_number, "bye": round_["bye"], "games": mine})
    models = data.get("models", {})
    players = {
        pid: {
            "name": player_name(pid, human),
            "logo": logos.get(logo_key(pid), ""),
            "kind": "human" if pid == "human" else ("system_one" if pid in SYSTEM_ONE else "llm"),
            "upstream": pid.removeprefix("llm:") if pid.startswith("llm:") else models.get(pid, {}).get("upstream", pid),
            "tier": models.get(pid, {}).get("tier", ""),
            "pricing": models.get(pid, {}).get("pricing"),
            "reasoning": models.get(pid, {}).get("reasoning"),
        }
        for pid in data["participants"]
    }
    all_plies = [p for g in games for p in g["plies"]]
    last_at = max((p["at"] for p in all_plies if p.get("at")), default=None)
    summary = {
        "id": tid,
        "title": f"Swiss tournament, {len(data['participants'])} players, {data['rounds_total']} rounds",
        "started_at": data["started_at"],
        "last_move_at": last_at,
        "elapsed": data.get("elapsed"),
        "rounds_total": data["rounds_total"],
        "time_limit": data.get("time_limit"),
        "depth": engines.depth if engines else next((g["depth"] for g in games if g.get("depth")), None),
        "totals": {
            "games": len(games),
            "moves": len(all_plies),
            "cost_usd": round(sum(p["cost_usd"] or 0 for p in all_plies), 4),
            "seconds": round(sum(p["seconds"] for p in all_plies), 1),
            "input_tokens": sum(p["input_tokens"] or 0 for p in all_plies),
            "output_tokens": sum(p["output_tokens"] or 0 for p in all_plies),
            "decisive": sum(g["result"] in ("1-0", "0-1") for g in games),
            "draws": sum(g["result"] == "1/2-1/2" for g in games),
        },
        "players": players,
        "standings": standings(data, games, human, logos),
        "rounds": rounds,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    (folder / "tournament.json").write_text(json.dumps(summary, separators=(",", ":")))
    (folder / "tournament.pgn").write_text("\n\n".join(g["pgn"] for g in games if g["pgn"]) + "\n")
    return {
        "id": tid,
        "title": summary["title"],
        "started_at": summary["started_at"],
        "players": len(players),
        "rounds": len(rounds),
        "games": len(games),
        "leader": summary["standings"][0]["name"] if summary["standings"] else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", type=Path, nargs="+", help="saved tournament files")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "dist")
    parser.add_argument("--human-name", default="Human", help="how the human player is shown")
    parser.add_argument("--depth", type=int, default=14, help="Stockfish depth per position")
    parser.add_argument("--no-engine", action="store_true", help="skip Stockfish, keep evaluations already built")
    parser.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1), help="games analysed at once")
    args = parser.parse_args()
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    for item in SITE.iterdir():
        target = out / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)
    shutil.copytree(VENDOR, out / "vendor", dirs_exist_ok=True)
    (out / ".nojekyll").touch()
    stockfish = None if args.no_engine else find_stockfish()
    if not args.no_engine and stockfish is None:
        print("Stockfish not found: building without evaluations", file=sys.stderr)
    engines = Engines(stockfish, args.depth) if stockfish else None
    try:
        index_path = out / "data" / "tournaments.json"
        listed = {t["id"]: t for t in json.loads(index_path.read_text())} if index_path.exists() else {}
        for path in args.files:
            entry = build_tournament(path, out, args.human_name, engines, args.jobs)
            listed[entry["id"]] = entry
        index_path.write_text(json.dumps(sorted(listed.values(), key=lambda t: -t["started_at"]), indent=1))
    finally:
        if engines:
            engines.close()
    print(f"Built {out}")


if __name__ == "__main__":
    main()
