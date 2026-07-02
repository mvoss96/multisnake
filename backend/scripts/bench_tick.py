"""Tick-Timing-Benchmark für einen Vorher/Nachher-Vergleich der Backend-Performance.

Baut eine `GameRoom` aus der echten `config`, befüllt sie mit einer konfigurierbaren
Bot-Zahl, lässt die Snakes über einige Warmup-Ticks wachsen und misst danach die
`tick()`-Dauer über viele Iterationen. Gibt avg/max ms pro `tick()` sowie die
durchschnittliche Punktzahl pro Snake auf stdout aus.

Keine Zeit-Assertion (maschinenabhängig) — reines Messwerkzeug.

    cd backend && uv run python scripts/bench_tick.py [--snakes N] [--ticks T] [--warmup W]
"""

import argparse
import sys
import time
from pathlib import Path

# Erlaubt `uv run python scripts/bench_tick.py` aus backend/ heraus (Paket `game`).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from game import config  # noqa: E402
from game.game_room import GameRoom  # noqa: E402


def _avg_points(room: GameRoom) -> float:
    snakes = [p.snake for p in room.players.all() if p.snake]
    if not snakes:
        return 0.0
    return sum(len(s.points) for s in snakes) / len(snakes)


def run(snakes: int, ticks: int, warmup: int) -> None:
    room = GameRoom(config)
    room.debug_set_bot_count(snakes)

    # Warmup: Snakes wachsen lassen, damit `points`/`target_length` realistisch sind.
    for _ in range(warmup):
        room.tick(config.TICK_DT)

    avg_points = _avg_points(room)

    durations: list[float] = []
    for _ in range(ticks):
        start = time.perf_counter()
        room.tick(config.TICK_DT)
        durations.append((time.perf_counter() - start) * 1000.0)

    avg_ms = sum(durations) / len(durations)
    max_ms = max(durations)
    print(
        f"snakes={snakes} avg_points={avg_points:.0f}  "
        f"tick avg={avg_ms:.2f}ms  max={max_ms:.2f}ms  ({ticks} ticks)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snakes", type=int, default=30, help="Anzahl Bots (Snakes)")
    parser.add_argument("--ticks", type=int, default=1000, help="gemessene Ticks")
    parser.add_argument("--warmup", type=int, default=300, help="Warmup-Ticks vor der Messung")
    args = parser.parse_args()
    run(args.snakes, args.ticks, args.warmup)


if __name__ == "__main__":
    main()
