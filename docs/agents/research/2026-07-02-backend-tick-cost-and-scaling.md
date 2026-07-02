---
date: 2026-07-02T08:41:51+00:00
git_commit: 9b858e26c8c13260a94f340d16181f6521a1b6cb
branch: main
topic: "Backend per-tick compute cost and how it scales with players/snakes/food"
tags: [research, codebase, backend, game-loop, game_room, performance, scaling]
status: complete
---

# Research: Backend per-tick compute cost and how it scales with players/snakes/food

## Research Question
Analyse the backend. It is currently laggy when too many players connect, and the
app will run on a very resource-constrained VPS. Document how the backend's
per-tick work is structured and where its cost scales with the number of
players, snakes, food, and connections.

> Scope note (per `/rpi-research`): this document maps **what exists today** — the
> control flow, the loops, and their algorithmic complexity as written. It does
> **not** propose fixes, optimizations, or refactors.

## Summary

The backend is a single-process, single-threaded (asyncio) simulation. One global
`GameRoom` instance holds all state; one background `game_loop()` task drives the
whole game at a nominal 30 Hz. There is **one shared world** — no rooms/sharding —
so every snake and every food interacts with every other, and every connected
client receives the **complete world state** every tick.

Each tick does two things back-to-back on the event loop:
1. `game_room.tick(dt)` — advance the simulation (AI, movement, collisions, food).
2. `broadcast_tick()` — serialize the full state once and send it to every client.

The dominant per-tick costs are **quadratic in the number of snakes** and, for the
larger of those loops, additionally **linear in snake body length** (points per
snake). The full state (all snake bodies + all food) is sent to every client with
no viewport culling, and JSON encoding happens once per client.

Key variables used throughout this document:

| Symbol | Meaning | Typical / max today |
|--------|---------|---------------------|
| `N` | number of live snakes (humans + bots) | `max(NUM_BOTS, human_count)` = `max(6, humans)` |
| `C` | number of open WebSocket connections | = number of connected clients |
| `F` | number of food items | `FOOD_COUNT_TARGET` = 90 baseline, spikes higher after deaths |
| `P` | points (body vertices) per snake | ~27 at spawn, **~530 for a fully grown snake** (see below) |

### Why `P` is large
A snake stores one body vertex (`Vector2`) **per tick it has been alive**, trimmed
from the tail by cumulative distance until the trail reaches `target_length`
(`snake.py:81` `_trim`). Movement per tick is `SNAKE_SPEED * TICK_DT = 90/30 = 3`
units, and `MAX_SNAKE_LENGTH = 200 * 8 = 1600` units, so a maxed snake carries
roughly `1600 / 3 ≈ 530` points. `P` is therefore not a small constant — it grows
with score and feeds directly into the quadratic collision loop below.

### File map

```
backend/
  main.py                     game_loop() @30Hz, broadcast_tick(), /ws endpoint, connections dict
  game/
    game_room.py              tick() — the hot path: AI ctx, movement, collisions, food, respawn
    config.py                 TICK_RATE=30, NUM_BOTS=6, BOARD 1500x1500, FOOD_COUNT_TARGET=90,
                              MAX_SNAKE_LENGTH, BOT_* sight/lookahead constants
    snake.py                  move()/_trim() — O(P) list.insert(0)+trim; points grow with length
    bot.py                    decide() — danger scan over other snakes' points[::3], nearest-food scan
    food.py                   FoodManager.tick() O(F) lifetime decay, ensure_min_food() refill
    player.py                 PlayerManager, get_input_direction() dispatch (human vs bot)
    board.py                  is_out_of_bounds(), random_point()
    vector.py                 Vector2.distance_to() (math.hypot) — called in every hot loop
    protocol.py               Pydantic in/out models; StateMessage = full snakes[] + food[]
```

### Per-tick control flow

```
game_loop()                                  main.py:66
  └─ await asyncio.sleep(TICK_DT=1/30)        # fixed sleep, NOT deadline-compensated
  └─ broadcast_tick()                         main.py:43
       ├─ game_room.tick(dt)  ── unless paused ──┐
       │    1. food_manager.tick(dt)              O(F)          food.py:54
       │    2. build alive_snakes                 O(N)          game_room.py:216
       │    3. AI + movement loop (per snake):                  game_room.py:218-230
       │         - build DecisionContext          O(N)+O(F) each → O(N²)+O(N·F)
       │         - bot.decide()                   O(N·P)+O(F) each → O(N²·P)+O(N·F)
       │         - snake.move()                   O(P) each → O(N·P)
       │    4. _apply_food_magnet                 O(F·N)        game_room.py:194
       │    5. snake-vs-snake collisions          O(N²·P)       game_room.py:234-253
       │    6. food eating                        O(N·F)        game_room.py:255-267
       │    7. death handling / respawn / drop    O(N·P)        game_room.py:269-280
       │    8. (returns game_over_events)
       ├─ serialize_state().model_dump()          O(N·P + F)    game_room.py:282
       └─ for each connection: ws.send_json(state)              main.py:48
              → JSON-encodes the payload once PER client        O(C·(N·P + F))
```

## Detailed Findings

### 1. The game loop is a single fixed-interval task on one event loop
`main.py:66-69`:
```python
async def game_loop() -> None:
    while True:
        await asyncio.sleep(config.TICK_DT)
        await broadcast_tick()
```
- One task, created in `lifespan` (`main.py:74`), runs for the process lifetime.
- The sleep is a **fixed** `TICK_DT` (33.3 ms); it is not reduced by the time
  `broadcast_tick()` itself takes. Effective tick period = `TICK_DT + work_time`,
  so as `work_time` grows the actual tick rate drops below 30 Hz. There is no
  frame-drop / catch-up logic and no measurement of how long a tick took.
- `dt` passed into the simulation is always the constant `config.TICK_DT`
  (`main.py:44`), not the real elapsed wall-clock time. So if ticks slow down,
  the *simulation* still advances as if each tick were exactly 1/30 s — the world
  runs in slow-motion relative to real time rather than compensating.
- The same event loop also handles all incoming WebSocket messages
  (`websocket_endpoint`, `main.py:94`). Simulation work and message handling share
  one thread; a long tick delays message processing and vice-versa.

### 2. Population size `N` — how many snakes exist
`config.NUM_BOTS = 6` is a **target total population**, not a fixed bot count.
`_rebalance_bots()` (`game_room.py:104-107`) sets `target_bots = max(0, NUM_BOTS - human_count)`.
Therefore total live snakes `N = human_count + max(0, 6 - human_count) = max(6, human_count)`.

- With ≤6 humans: bots top the arena up to 6 snakes total.
- With >6 humans: bots drop to 0 and `N` equals the number of humans, growing
  unbounded with connections. Every additional human adds a full snake to all the
  per-snake and quadratic loops below.
- `debug_set_bot_count` (`game_room.py:146`) can also raise the AI count directly
  (bounded to 50 by `DebugBotsMessage.count` `le=50`, `protocol.py:52`), but this
  is gated off in the Docker deployment (`ENABLE_DEBUG_COMMANDS=false`).

### 3. AI context construction is already O(N²) + O(N·F) before any AI runs
In the movement loop (`game_room.py:218-230`), for **every** snake a fresh
`DecisionContext` is built:
```python
context = {
    "board": self.board,
    "foods": list(self.food_manager.foods.values()),          # O(F) copy per snake
    "other_snakes": [s for s in alive_snakes if s.id != snake.id],  # O(N) per snake
}
```
- `other_snakes` is rebuilt per snake → **O(N²)** total, even for human players
  who never read it (`HumanPlayer.get_input_direction` ignores `context`,
  `player.py:26`).
- `list(self.food_manager.foods.values())` copies the food dict per snake → **O(N·F)**.
- This work happens for humans and bots alike, every tick.

### 4. Bot AI: danger scan is O(N·P) per bot → O(N²·P) across bots
`Bot.decide` (`bot.py:26-64`), run once per AI snake per tick:
- **Danger scan** (`bot.py:38-45`): iterates every *other* snake and samples that
  snake's body every 3rd point (`other.points[::3]`), calling `distance_to`
  (`math.hypot`) on each. Cost per bot ≈ `O(N · P/3)`; across all bots ≈
  **O(N²·P/3)**. This shares the quadratic-in-snakes, linear-in-body-length shape
  with the real collision loop (§6).
- **Nearest-food scan** (`bot.py:52-56`): iterates all foods → `O(F)` per bot →
  **O(N·F)** total.
- No spatial index or sight-radius culling is applied *before* the distance checks;
  `BOT_SIGHT_RADIUS`/`BOT_DANGER_MARGIN` are used only as comparison thresholds
  inside the full scan, not to skip work.

### 5. Snake movement is O(P) per snake (list front-insert + tail trim)
`Snake.move` (`snake.py:54-79`):
- `self.points.insert(0, new_head)` inserts at the **front** of a Python list,
  which shifts all existing elements → O(P).
- `_trim()` (`snake.py:81-90`) walks points from the head accumulating distance
  until `target_length` is reached → O(P).
- Total movement cost ≈ **O(N·P)**. Because `P` scales with snake length (§Summary),
  a board full of long snakes makes this loop noticeably heavier than at spawn.

### 6. Snake-vs-snake collision is the dominant loop: O(N²·P)
`game_room.py:234-253`:
```python
for player in all_players:            # N snakes
    ...
    head = snake.head()
    ...
    for other in alive_snakes:        # N snakes
        if other.id == snake.id: continue
        for point in other.points:    # P points, FULL body (no [::step] here)
            if head.distance_to(point) < snake.radius + other.radius:
                snake.alive = False; break
```
- Each living head is tested against **every point of every other snake**, every
  tick, with a `math.hypot` call per comparison.
- Cost ≈ **O(N² · P)**. Unlike the bot danger scan (§4), this loop does **not**
  subsample points — it walks the entire body. With `N` humans of long snakes,
  `P` in the hundreds, this is the single largest term in the tick.
- There is no broad-phase / spatial partitioning (no grid, quadtree, or
  bounding-box pre-check) anywhere in the collision path; `Board`/`Vector2` expose
  only direct distance math (`board.py`, `vector.py`).

### 7. Food magnet and food eating are O(F·N)
- `_apply_food_magnet` (`game_room.py:194-210`): for each food, loops over all
  alive snakes' heads to find the nearest within `FOOD_MAGNET_RADIUS` → **O(F·N)**.
- Food eating (`game_room.py:255-267`): for each snake head, loops over all foods →
  **O(N·F)**. `list(self.food_manager.foods.values())` is copied per snake here too.
- `F` baseline is `FOOD_COUNT_TARGET = 90` (`config.py:43`), refilled every tick by
  `ensure_min_food` (`food.py:47`). `F` spikes above baseline right after deaths:
  `_drop_food_from_snake` (`game_room.py:164-191`) converts a dead snake's body into
  many food items (sampled every `FOOD_DROP_SAMPLE_STEP=2` points), so `F`
  temporarily rises with the number and length of snakes dying — which in a dense
  arena is frequent.

### 8. Death → respawn keeps the population (and its cost) up
`game_room.py:269-280`: when a snake dies, AI players are **immediately respawned**
in the same tick (`_spawn_snake_for`), and `_find_safe_spawn_point`
(`game_room.py:42-53`) itself loops up to 20 candidate points, each checked against
**every point of every other alive snake** (`O(P·N)` per attempt). Human deaths
instead emit a `game_over` event and clear the snake. So AI population stays pinned
at target and never decays; the arena never "empties out" to reduce load.

### 9. Broadcast: full state to every client, encoded once per client
`broadcast_tick` (`main.py:43-63`):
```python
state = game_room.serialize_state().model_dump()      # built ONCE
for player_id, ws in list(connections.items()):
    await ws.send_json(state)                          # encoded per client, sequentially
```
- `serialize_state` (`game_room.py:282-320`) builds the **entire** world: every
  snake with its full `points` list (`[round(x,1), round(y,1)]` per vertex) plus
  every food. Payload size ≈ **O(N·P + F)**. No per-client viewport culling — a
  client sees only a camera window in the frontend, but the server sends the whole
  board regardless.
- The Python dict is built once, but `ws.send_json` JSON-encodes it **again for
  every connection** → total serialization ≈ **O(C · (N·P + F))**.
- Sends are **sequential `await`s**, not `asyncio.gather`ed — client C waits behind
  clients 1..C-1 each tick. A slow/backpressured socket extends the whole broadcast.
- Bandwidth per tick ≈ `C · payload`, at up to 30 ticks/s. With many long snakes
  (`N·P` large) and many clients (`C` large), egress scales as the product.

### 10. Aggregate per-tick cost
Summing the dominant terms, one tick is approximately:

```
  O(N²·P)      snake-vs-snake collisions        (game_room.py:234)   ← largest
+ O(N²·P/3)    bot danger scans                 (bot.py:38)
+ O(N²)        per-snake context building       (game_room.py:224)
+ O(N·F)       food magnet + eating + bot food  (game_room.py:194,255; bot.py:52)
+ O(N·P)       movement (insert/trim)           (snake.py:54)
+ O(C·(N·P+F)) broadcast serialization + send   (main.py:45-51)
```
Everything quadratic keys off `N` (snake count), and the two heaviest terms are
additionally multiplied by `P` (body length, which itself grows with score). `C`
(connections) multiplies only the broadcast term. When >6 humans connect, `N` = the
human count, so `N`, `C`, and `P` all rise together, and the `N²·P` collision term
grows fastest. All of it runs inside the single 30 Hz event-loop task (§1), where a
tick exceeding 33 ms directly delays subsequent ticks and inbound message handling.

## Code References
- `backend/main.py:66-69` — `game_loop()`: fixed `TICK_DT` sleep, no deadline compensation
- `backend/main.py:43-63` — `broadcast_tick()`: single state build, per-client sequential `send_json`
- `backend/main.py:44` — simulation always advanced by constant `TICK_DT`, not real elapsed time
- `backend/game/game_room.py:212-280` — `tick()`: the full hot path
- `backend/game/game_room.py:218-230` — per-snake `DecisionContext` build (O(N²)+O(N·F))
- `backend/game/game_room.py:234-253` — snake-vs-snake collision (O(N²·P), full body scan)
- `backend/game/game_room.py:194-210` — `_apply_food_magnet` (O(F·N))
- `backend/game/game_room.py:255-267` — food eating (O(N·F))
- `backend/game/game_room.py:42-53` — `_find_safe_spawn_point`: up to 20 attempts × all body points
- `backend/game/game_room.py:104-107` — `_rebalance_bots`: `N = max(NUM_BOTS, human_count)`
- `backend/game/game_room.py:282-320` — `serialize_state`: full snakes[]+food[], no viewport cull
- `backend/game/bot.py:26-64` — `Bot.decide`: danger scan (O(N·P)) + food scan (O(F)) per bot
- `backend/game/snake.py:54-90` — `move`/`_trim`: O(P) front-insert + tail trim
- `backend/game/food.py:47-61` — `ensure_min_food` refill + `tick` lifetime decay (O(F))
- `backend/game/vector.py:10-11` — `distance_to` = `math.hypot`, called in every hot loop
- `backend/game/config.py:4-5,12,43,50` — `TICK_RATE=30`, `NUM_BOTS=6`, `FOOD_COUNT_TARGET=90`, `MAX_SNAKE_LENGTH`

## Architecture Documentation
- **Single world, single process, single loop.** All state lives in one in-memory
  `GameRoom`; one asyncio task ticks it and broadcasts. No sharding, no worker
  processes, no threads. CPU-bound tick work and I/O (message receive + broadcast)
  are interleaved on the same event loop.
- **No spatial partitioning.** Collision, food-magnet, food-eating, bot danger, and
  safe-spawn all use direct all-pairs distance checks. `Board` and `Vector2` provide
  only bounds checks and point-to-point distance.
- **Body length is state that grows.** `Snake.points` accumulates one vertex per tick
  (trimmed by length), so per-snake cost `P` scales with score, not a fixed segment
  count. This feeds the quadratic loops.
- **Full-state broadcast.** The server always sends the entire board to every client;
  camera/viewport culling exists only client-side in the frontend renderer.
- **Population is self-sustaining.** Bots refill to `max(6, humans)` and AI snakes
  respawn in the same tick they die, so the arena stays dense.
- **Tuning knobs live in `config.py`.** Tick rate, bot target, board size, food count,
  max snake length, and bot sight/lookahead constants are all centralized there
  (per the project's config-as-single-source-of-truth convention).

## Open Questions
- **Measured vs. theoretical cost:** this document maps algorithmic complexity from
  the source. No profiling data (actual ms/tick at given `N`, `C`, `P`) was collected;
  where the practical bottleneck lands (CPU tick work vs. broadcast serialization vs.
  network egress) on the target VPS is not established here.
- **Connections without snakes:** a client that connects but never sends `join`
  occupies a `connections` entry (receives broadcasts, adds to `C`) but no snake
  (no `N`). The relative weight of "spectator" connections vs. active players on the
  broadcast term is not separately characterized.
- **`F` after mass deaths:** the transient size of `F` following simultaneous deaths
  in a dense arena (via `_drop_food_from_snake`) is bounded only by snake lengths and
  `FOOD_DROP_SAMPLE_STEP`; its realistic peak was not quantified.

## Follow-up Research 2026-07-02 — mapping the cost onto the target VPS

Target hardware (Netcup VPS S+ class): **2 vCores, 2 GB RAM, 90 GB NVMe**.
This section relates the architecture documented above to those specific limits.
It stays descriptive — it characterizes the fit, it does not prescribe changes.

### The 2nd vCore does not help the hot path
The entire simulation + broadcast runs inside **one asyncio task on one thread**
(`main.py:66-69`, §1). Python's GIL plus the single-task design mean the tick loop
is effectively **single-core**. Consequences on 2 vCores:
- The `game_loop()` tick work (collisions, AI, movement, serialization) is confined
  to **one core**. The second vCore cannot share that per-tick CPU cost.
- The second core is still useful for other work the OS/runtime does off the hot
  path (kernel networking/TLS if fronted by Caddy, OS tasks, the uvicorn/asyncio
  socket writes to some degree), but it cannot parallelize a single tick.
- So for capacity planning, the relevant CPU budget is **~1 core**, not 2.

### The per-tick time budget
At `TICK_RATE = 30` the loop has **~33 ms per tick** of that one core. Because
`game_loop` sleeps a fixed `TICK_DT` and does not compensate for work time (§1),
once a tick's CPU work approaches ~33 ms the effective rate drops below 30 Hz and
inbound messages queue behind it — i.e. the "lag" described in the research question.

### Order-of-magnitude read of the dominant term
The largest term is snake-vs-snake collision, `O(N²·P)` (§6), driven by
`Vector2.distance_to` = `math.hypot` (`vector.py:10`). Pure-Python method-call +
`hypot` overhead lands very roughly in the ~1M calls/second range on a single
modern vCore. Illustratively (collision term only, ignoring the other loops and
serialization that also consume the budget):

| Scenario | N (snakes) | P (avg points) | ~distance calls/tick (N²·P) | rough share of 33 ms |
|----------|-----------|----------------|------------------------------|----------------------|
| Default arena, small snakes | 6 | 30 | ~1.1k | small |
| 6 grown snakes | 6 | 400 | ~14k | modest |
| 10 humans, mid snakes | 10 | 200 | ~20k | approaching budget |
| 10 humans, grown snakes | 10 | 500 | ~50k | over a single-tick budget |
| 15 humans, grown snakes | 15 | 500 | ~110k | well over budget |

These are single-loop estimates for framing only — the bot danger scan (`O(N²·P/3)`,
absent once humans replace bots), context building (`O(N²)`), food loops (`O(N·F)`),
and serialization all draw from the **same** 33 ms/one-core budget, so the real
saturation point is lower than the collision term alone suggests. No measurements
were taken; treat the "budget" column as indicative, not measured.

### RAM and disk are not the constraint
- **2 GB RAM:** state is small and in-memory — a few dozen snakes each holding at
  most a few hundred `Vector2` points, plus ~90–few-hundred food dataclasses. This
  is on the order of megabytes, far below 2 GB. Memory is not the bottleneck; **CPU
  on the single hot-path core is.**
- **90 GB NVMe:** the app has no database and no disk I/O on the hot path (state is
  in-memory, `main.py`); disk is irrelevant to tick performance.

### Network egress is a second, separate ceiling
Independent of CPU, the broadcast term `O(C·(N·P + F))` (§9) sends the full board to
every client 30×/s, JSON-encoded per client and sent sequentially on the one loop.
Both the **serialization CPU** (on the hot-path core) and the **upstream bandwidth**
of the VPS scale with `C · payload`. With many long snakes (`N·P` large) and many
clients (`C`), this competes with the simulation for the same core's time and for
the VPS's uplink. The specific uplink of the VPS S+ tier was not part of the specs
given, so the bandwidth ceiling is noted but not quantified here.

### Bottom line for this hardware
The documented `N²·P` (CPU, one core) and `C·(N·P+F)` (serialization + egress)
terms both key off the same variables that rise when "too many players connect"
(`N`, `C`, and `P` growing together once humans exceed `NUM_BOTS=6`), and they draw
on the two resources this VPS is tightest on: **a single usable CPU core for the
tick, and uplink bandwidth** — not RAM or disk.
</content>
</invoke>
