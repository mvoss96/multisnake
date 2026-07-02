---
date: 2026-07-02T09:07:07+00:00
git_commit: 9b858e26c8c13260a94f340d16181f6521a1b6cb
branch: main
topic: "Backend tick performance for a resource-constrained VPS"
tags: [plan, backend, game_room, spatial-grid, broadcast, game-loop, performance]
status: complete
---

# PLAN: Backend-Tick-Performance für eine ressourcenbeschränkte VPS

Ziel: Der multiSnake-Backend soll bei vielen gleichzeitig verbundenen Spielern auf
einer VPS S+ (2 vCores, 2 GB RAM, 90 GB NVMe) nicht mehr laggen. Grundlage ist die
Research `docs/agents/research/2026-07-02-backend-tick-cost-and-scaling.md`.

Der Engpass ist **ein einzelner CPU-Kern** (der Tick läuft in genau einer
asyncio-Task, GIL) plus die **Serialisierungs-CPU** beim Broadcast. Dieses Paket
senkt die dominanten CPU-Terme, **ohne das Spielverhalten zu ändern**. Bandbreite
pro Client (Viewport-Culling) ist bewusst **nicht** Teil dieses Plans (offen wegen
Zoom/Mobile-Screensizes) — dafür wird später ein separater Plan erstellt. Reine
Zuschauer sind derzeit nicht vorgesehen und bleiben außen vor.

Umgesetzt werden §1–§4 aus der Vorbesprechung:
- **§1 Spatial Grid** — All-Pairs-Distanzloops (Kollision, Food-Fressen, Food-Magnet)
  durch ein Raster als Broad-Phase ersetzen.
- **§2 Broadcast** — State 1× serialisieren und parallel senden statt pro Client neu.
- **§3 Kontext-Entschlackung** — teuren AI-Kontext nicht mehr für Menschen bauen.
- **§4 Loop-Robustheit** — deadline-kompensierte `game_loop`, konstantes `dt`.

## Acceptance Criteria

- **Verhaltensgleich:** Alle bestehenden Tests bleiben ohne inhaltliche Änderung grün
  (`uv run pytest`). `uv run ruff check .`, `uv run ruff format --check .` und
  `uv run mypy .` (strict, repo-weit) sind sauber.
- Kollision, Food-Fressen und Food-Magnet liefern **dieselben Ergebnisse** wie vorher,
  jetzt über das Spatial Grid statt All-Pairs.
- Die Tick-Loop hält 30 Hz, solange der Kern es schafft, und degradiert sauber
  (kein „Zeitlupen"-Effekt durch feste Pause; `dt` bleibt konstant `TICK_DT`).
- Der Broadcast serialisiert den State **einmal** pro Tick (nicht mehr `C`-mal) und
  sendet parallel; tote Verbindungen werden weiterhin korrekt entfernt.
- Ein Benchmark-Skript `backend/scripts/bench_tick.py` misst die `tick()`-Dauer bei
  konfigurierbarem Snake-/Bot-Count für einen Vorher/Nachher-Vergleich.

## Technical Key Decisions and Tradeoffs

1. **Spatial Grid als eigene, generische Struktur (`game/spatial_grid.py`):** Uniform-Grid
   mit `query(position, radius)`, das `ceil(radius / cell_size)` Zell-Ringe absucht.
   - Why: Ein radiusbasiertes Query erlaubt EINE Zellgröße für alle Abstände
     (Kollision ~28, Food-Fressen ~23, Magnet 60), Korrektheit ist unabhängig von der
     Zellgröße.
   - Impact: Grid ist reiner **Vorfilter**; der exakte `distance_to`-Check bleibt
     dahinter → bit-identische Ergebnisse.

2. **Grids werden NACH dem Movement-Loop gebaut (Kollision/Fressen/Magnet):** aus der
   `alive_snakes`-Liste vom Tick-Anfang, mit den nach dem Movement aktualisierten
   Punkten.
   - Why: Genau das liest der bestehende Code an diesen Stellen — so bleibt das
     Ergebnis identisch (inkl. der Feinheit, dass eine in diesem Tick durch Rand/Kollision
     gestorbene Snake weiterhin als Hindernis zählt).
   - Impact: Grids werden pro Tick neu gebaut (`O(N·P)`), das ist gewollt und billig
     gegenüber der eingesparten quadratischen Arbeit.

3. **Bot-Gefahren-Scan (`bot.py:38`) bleibt unverändert (nicht gridifiziert):**
   - Why: (a) Er hängt an einer reihenfolge­abhängigen In-Place-Mutation während des
     Movement-Loops (spätere Bots sehen bereits bewegte frühere Snakes) — eine
     gridbasierte Umschreibung wäre nicht mehr bit-identisch. (b) Dieser Term skaliert
     mit der **Bot**-Zahl, und die sinkt auf 0, je mehr Menschen beitreten
     (`N = max(NUM_BOTS, human_count)`, `game_room.py:104`) — also genau im
     Lag-Szenario „viele Menschen" irrelevant.
   - Impact: Bot-Verhalten bleibt exakt gleich; die Bot-Tests bleiben unangetastet.

4. **Loop: konstantes `dt`, nur die Sleep-Zeit wird kompensiert:**
   - Why: Variables `dt` bei Überlast könnte bei diesem Kill-on-touch-Spiel „Tunneling"
     verursachen (Snake springt durch eine andere hindurch, weil zwischen zwei
     Positionen nicht geprüft wird).
   - Impact: Bei Überlast wird die Welt eher langsamer als echtzeit, statt instabil —
     der eigentliche CPU-Gewinn kommt aus §1–§3, §4 macht die Degradation nur sauber.

5. **Neue Konstante `GRID_CELL_SIZE` in `config.py`:** muss zusätzlich im
   `test_config`-`SimpleNamespace` (`conftest.py:18`) gespiegelt werden.
   - Why: `GameRoom` liest sie; Tests bauen den Room aus diesem Fake-Config.
   - Impact: Fehlt sie im Fixture, brechen alle `game_room`-basierten Tests.

## Current State

Ein asyncio-Task (`main.py:66`) tickt @30 Hz auf **einem** Kern:

```
game_loop():  await sleep(TICK_DT)  → broadcast_tick()      # feste Pause, keine Kompensation
broadcast_tick() (main.py:43):
  tick(dt=TICK_DT)  (game_room.py:212):
    movement-loop (218-230):  pro Snake AI-Kontext bauen  → O(N²)+O(N·F)   ← auch für Menschen
    _apply_food_magnet (194): pro Food × alle Snakes       → O(F·N)
    collision (234-253):      pro Kopf × alle Snakes × P    → O(N²·P)        ← größter Term
    food eating (255-267):    pro Kopf × alle Foods         → O(N·F)
  serialize_state().model_dump()                            # 1× Dict
  for ws in connections:  await ws.send_json(state)         # ← JSON pro Client neu, sequentiell
```

`N`=Snakes, `P`=Punkte/Snake (bis ~530 bei Maximallänge), `F`=Futter (~90), `C`=Clients.

## Desired End State

```
game_loop():  start=t; broadcast_tick(); sleep(max(0, TICK_DT - elapsed))   # deadline-kompensiert
broadcast_tick():
  tick(dt=TICK_DT):
    movement-loop:  AI-Kontext NUR für AIPlayer, foods-Liste 1× geteilt      → ~O(N + bots·N)
    body_grid = SpatialGrid(alle Punkte der alive_snakes)                     → O(N·P) bauen
    _apply_food_magnet:  head_grid, pro Food nur nahe Köpfe                   → ~O(F)
    collision:  pro Kopf nur Kandidaten aus body_grid                         → ~O(N·P)
    food eating: food_grid, pro Kopf nur nahe Foods                          → ~O(N)
  text = serialize_state().model_dump_json()                                 # 1× JSON
  await gather(*(ws.send_text(text) for ws in connections))                  # parallel, 1× kodiert
```

Bot-Gefahren-Scan bleibt wie gehabt (siehe Decision 3).

## Abstractions and Code Reuse

- `backend/game/`
  - `spatial_grid.py` **(neu)** — generisches Uniform-Grid
    - `SpatialGrid[T]` — `insert(pos, item)`, `query(pos, radius) -> Iterator[tuple[Vector2, T]]`
  - `game_room.py` — `tick()` nutzt Grids; Kontext-Bau entschlackt
    - `tick` — Grid-Aufbau + gridbasierte Kollision/Fressen; nur AI-Kontext
    - `_apply_food_magnet` — head-basiertes Grid statt All-Pairs
  - `config.py` — neue Konstante `GRID_CELL_SIZE`
  - `types.py` — `GameConfig` um `GRID_CELL_SIZE` erweitern (`types.py:48`)
- `backend/`
  - `main.py` — `broadcast_tick` (1× kodieren + `gather`), `game_loop` (deadline-kompensiert),
    neuer reiner Helper `sleep_duration()`
  - `scripts/bench_tick.py` **(neu)** — Tick-Timing-Messung
- `backend/tests/`
  - `conftest.py` — `test_config` um `GRID_CELL_SIZE` ergänzen (`conftest.py:18`)
  - `game/test_spatial_grid.py` **(neu)** — Grid-Unit-Tests
  - `test_main.py` — Test für `sleep_duration`; bestehende Broadcast-Tests bleiben gültig

Wiederverwendung: `Vector2.distance_to` (`vector.py:10`) bleibt der exakte Check hinter
jedem Grid-Query. Die `DecisionContext`-Abstraktion (`bot.py:12`) und
`Player.get_input_direction` (`player.py:14`) bleiben unverändert.

## Logging & Observability

Keine dauerhaften Log-Änderungen. `scripts/bench_tick.py` gibt reine Messwerte auf
stdout aus (avg/max ms pro `tick()`), z.B.:

```
snakes=30 avg_points=180  tick avg=6.1ms  max=9.8ms  (1000 ticks)
```

## Implementation

### Phase 1: Loop-Robustheit + Broadcast-Effizienz (§4, §2)

Dependencies: None

Rein Backend, unabhängig vom Grid. Sofortige Entlastung bei vielen Clients und
Beseitigung des „Zeitlupen"-Effekts. Liefert außerdem das Benchmark-Skript, mit dem
die späteren Grid-Phasen gemessen werden.

**Tasks**:
- [x] `main.py`: reinen Helper `sleep_duration(elapsed: float, tick_dt: float) -> float`
  ergänzen (`return max(0.0, tick_dt - elapsed)`).
- [x] `main.py:66` `game_loop()` auf deadline-kompensiert umstellen (Arbeit messen,
  Rest schlafen), `dt` bleibt `config.TICK_DT`:
  ```python
  async def game_loop() -> None:
      loop = asyncio.get_running_loop()
      while True:
          start = loop.time()
          await broadcast_tick()
          await asyncio.sleep(sleep_duration(loop.time() - start, config.TICK_DT))
  ```
- [ ] `main.py:43` `broadcast_tick()`: State **einmal** zu JSON-Text serialisieren und
  parallel per `send_text` senden; Stale-Handling über die `gather`-Ergebnisse:
  ```python
  text = game_room.serialize_state().model_dump_json()
  items = list(connections.items())
  results = await asyncio.gather(
      *(ws.send_text(text) for _, ws in items), return_exceptions=True
  )
  for (player_id, _), res in zip(items, results):
      if isinstance(res, Exception):
          connections.pop(player_id, None)
          game_room.remove_player(player_id)
  ```
  (Das nachgelagerte Senden der `game_over`-Nachrichten bleibt unverändert.)
- [x] `backend/scripts/bench_tick.py` anlegen: `GameRoom` aus `config` bauen, per
  `debug_set_bot_count(N)` befüllen, viele Ticks laufen lassen (Snakes wachsen),
  danach `tick()` über z.B. 1000 Iterationen mit `time.perf_counter` messen, avg/max
  und durchschnittliche Punktzahl pro Snake ausgeben. Keine Zeit-Assertion (maschinen­
  abhängig).
- [x] `tests/test_main.py`: Unit-Test für `sleep_duration` (u.a. `elapsed > tick_dt → 0.0`).

**Automated Verification**:
- [x] `cd backend && uv run pytest` — alle Tests grün (inkl. bestehender Broadcast-Tests
  in `test_main.py`, die weiterhin `receive_json` empfangen können, da `send_text` mit
  gültigem JSON denselben Text-Frame liefert wie zuvor `send_json`).
- [x] `cd backend && uv run python scripts/bench_tick.py` läuft fehlerfrei und gibt
  Messwerte aus (Baseline vor den Grid-Phasen festhalten).
- [x] `uv run ruff check . && uv run ruff format --check . && uv run mypy .` sauber.

### Phase 2: Kontext-Entschlackung + Spatial Grid für Kollision (§3, §1a)

Dependencies: Phase 1 (Benchmark als Vergleichsbasis)

Einführung der Grid-Struktur und Umstellung des größten Terms (Snake-vs-Snake-Kollision),
plus Wegfall des AI-Kontext-Baus für Menschen.

**Tasks**:
- [x] `game/spatial_grid.py` anlegen — generisches `SpatialGrid[T]` (PEP-695-Syntax
  `class SpatialGrid[T]:` statt `Generic[T]` — ruff `UP046` erzwingt das unter py312):
  ```python
  class SpatialGrid[T]:
      def __init__(self, cell_size: float) -> None: ...
      def insert(self, position: Vector2, item: T) -> None:
          # cell = (int(position.x // cell_size), int(position.y // cell_size))
      def query(self, position: Vector2, radius: float) -> Iterator[tuple[Vector2, T]]:
          # rings = ceil(radius / cell_size); über (cx±rings, cy±rings) iterieren,
          # alle (pos, item) der Zellen yielden (Aufrufer macht den exakten Abstandscheck)
  ```
- [x] `config.py`: `GRID_CELL_SIZE: Final[float] = 40.0` ergänzen (Kommentar: nur
  Tuning der Dichte/Geschwindigkeit, Korrektheit unabhängig; ≥ typischer
  Interaktionsabstand).
- [x] `types.py:48`: `GRID_CELL_SIZE: float` zu `GameConfig` hinzufügen.
- [x] `tests/conftest.py:18`: `GRID_CELL_SIZE=40.0` im `test_config`-`SimpleNamespace`
  ergänzen.
- [x] `game_room.py` Movement-Loop (`218-230`): `foods`-Liste **einmal** bilden;
  vollen Kontext nur für `AIPlayer` bauen, Menschen erhalten einen geteilten
  Leer-Kontext:
  ```python
  foods_list = list(self.food_manager.foods.values())
  human_ctx: DecisionContext = {"board": self.board, "foods": foods_list, "other_snakes": []}
  for player in all_players:
      snake = player.snake
      if not snake or not snake.alive: continue
      if isinstance(player, AIPlayer):
          ctx = {"board": self.board, "foods": foods_list,
                 "other_snakes": [s for s in alive_snakes if s.id != snake.id]}
      else:
          ctx = human_ctx
      angle = player.get_input_direction(ctx)
      ...
  ```
  (`AIPlayer` aus `game.player` importieren.)
- [x] `game_room.py` Kollision (`234-253`): nach dem Movement-Loop `body_grid` aus allen
  Punkten der `alive_snakes` bauen und die inneren Doppelschleifen ersetzen:
  ```python
  body_grid: SpatialGrid[Snake] = SpatialGrid(self.config.GRID_CELL_SIZE)
  for s in alive_snakes:
      for p in s.points:
          body_grid.insert(p, s)
  ...
  reach = snake.radius + self.config.SNAKE_MAX_RADIUS  # deckt max. other.radius ab
  for point, other in body_grid.query(head, reach):
      if other.id == snake.id: continue
      if head.distance_to(point) < snake.radius + other.radius:
          snake.alive = False; break
  ```
  Rand-/Invulnerable-Checks bleiben unverändert davor.
- [x] `tests/game/test_spatial_grid.py` anlegen: `insert`/`query` findet Punkte
  innerhalb, ignoriert weit entfernte; `query`-Radius größer als eine Zelle sucht
  mehrere Ringe ab; leeres Grid liefert nichts.
- [x] Kollisions-Äquivalenztest in `tests/game/test_game_room.py` ergänzen: bekannter
  Treffer tötet weiterhin, knapper Vorbei-Fall (`dist` knapp über `r1+r2`) tötet nicht.

**Automated Verification**:
- [x] `cd backend && uv run pytest` — bestehende Kollisions-/Tick-Tests **unverändert**
  grün; neue Grid- und Äquivalenztests grün.
- [x] `uv run ruff check . && uv run ruff format --check . && uv run mypy .` sauber.

### Phase 3: Grid für Food-Fressen und Food-Magnet (§1b)

Dependencies: Phase 2 (`SpatialGrid`, `GRID_CELL_SIZE`)

Die verbleibenden All-Pairs-Loops über Futter auf das Grid umstellen. Damit sind alle
food-bezogenen quadratischen Terme entfernt. (Bot-Gefahren-Scan bleibt bewusst
unverändert, siehe Decision 3.)

**Tasks**:
- [x] `game_room.py` Food-Fressen (`255-267`): `food_grid: SpatialGrid[Food]` aus allen
  Food-Positionen bauen; pro Kopf nur nahe Foods abfragen:
  ```python
  food_grid: SpatialGrid[Food] = SpatialGrid(self.config.GRID_CELL_SIZE)
  for f in self.food_manager.foods.values():
      food_grid.insert(f.position, f)
  ...
  reach = snake.radius + self.config.FOOD_BIG_RADIUS  # deckt max. Food-Radius ab
  for _pos, food in food_grid.query(head, reach):
      if head.distance_to(food.position) < snake.radius + self._food_radius(food):
          snake.grow(score_value=food.score_value); eaten_ids.append(food.id)
  ```
  **Verhaltensgleichheit — nicht deduplizieren:** Der aktuelle Code (`game_room.py:261-264`)
  ruft `grow()` für **jede** Snake auf, die dasselbe Food in einem Tick erreicht (zwei
  Köpfe → zwei `grow()`); nur das anschließende Entfernen über `eaten_ids`/`remove`
  (`:265-266`) ist idempotent und passiert erst **nach** der Schleife. Die Grid-Variante
  muss das exakt so beibehalten: `food_grid` wird einmal vor der Schleife gebaut und
  während der Schleife nicht verändert, jede qualifizierende Snake wächst. **Kein**
  Überspringen/Dedup auf Basis von `eaten_ids` innerhalb der Schleife — das würde das
  zweite `grow()` unterdrücken und das Verhalten ändern.
- [x] `game_room.py` `_apply_food_magnet` (`194-210`): `head_grid` aus den Köpfen der
  `alive_snakes` bauen; pro Food nur nahe Köpfe abfragen und den nächsten wählen:
  ```python
  head_grid: SpatialGrid[Snake] = SpatialGrid(self.config.GRID_CELL_SIZE)
  for s in alive_snakes:
      head_grid.insert(s.head(), s)
  for food in self.food_manager.foods.values():
      nearest_head, nearest_dist = None, radius
      for _pos, s in head_grid.query(food.position, radius):
          d = s.head().distance_to(food.position)
          if d < nearest_dist:
              nearest_dist, nearest_head = d, s.head()
      ...  # Pull-Logik unverändert
  ```
- [x] Äquivalenztests in `tests/game/test_game_room.py`: Food genau in Fress-Reichweite
  wird gegessen, knapp außerhalb nicht; ein Food nahe zwei Köpfen wandert zum näheren
  (Magnet); **ein Food, das zwei Köpfe gleichzeitig erreichen, lässt beide Snakes
  wachsen** (Doppel-`grow()`, siehe Verhaltensgleichheits-Hinweis oben) und wird danach
  einmal entfernt.

**Automated Verification**:
- [x] `cd backend && uv run pytest` — bestehende Food-/Magnet-Tests unverändert grün,
  neue Äquivalenztests grün.
- [x] `uv run ruff check . && uv run ruff format --check . && uv run mypy .` sauber.
- [x] `cd backend && uv run python scripts/bench_tick.py` zeigt gegenüber der Phase-1-
  Baseline eine deutlich niedrigere `tick()`-Zeit bei hoher Snake-Zahl (Werte im
  `## Implementation Notes` festhalten).

**Manual Verification**:
- [x] Browser-Test mit 40 Bots durchgeführt (Methode leicht abweichend von der
  Vorlage: die echte Client-Methode heißt `sendDebugBotCount(40)`, nicht
  `sendDebugBots`). Ergebnis über ein WS-`onState`-Tap gemessen:
  - **Echtzeit/keine Zeitlupe:** 450 Server-Ticks in 15,3 s Wall-Clock = **29,4 Hz**
    (Ziel 30 Hz), Client empfing 29,5 Frames/s. Kein Auseinanderdriften von
    Server-Ticks und Wall-Clock.
  - **Kollisionen/Respawn:** über 5 s respawnten 36 von 40 Snakes (Bots kollidierten,
    starben und kamen neu) — Grid-Kollision + Respawn funktionieren.
  - **Food-Fressen/Refill:** in 5 s 104 Food-IDs verschwunden (gefressen/abgelaufen),
    Refill hielt konstant 90 (`FOOD_COUNT_TARGET`).
  - Keine Console-Warnungen/-Fehler, keine fehlgeschlagenen Netzwerk-Requests;
    Renderer/Leaderboard/Food/Snake-Trails zeichnen korrekt.

## Implementation Notes

During implementation, document user feedback, problems, and decisions here.

- Baseline (`bench_tick.py`, Phase 1, warmup=300, ticks=1000):
  - `snakes=30 avg_points=34  tick avg=6.81ms  max=22.66ms`
  - `snakes=50 avg_points=36  tick avg=15.55ms  max=30.95ms`
  - (avg_points bleibt niedrig, weil Bots in der dichten Arena schnell sterben und
    klein respawnen — als konstante Vergleichsbasis unerheblich.)
- Nach Phase 3 (gleiche Maschine, warmup=300, ticks=1000):
  - `snakes=30 avg_points=36  tick avg=2.68ms  max=4.39ms`  (vorher avg 6.81ms, max 22.66ms)
  - `snakes=50 avg_points=34  tick avg=5.78ms  max=10.36ms` (vorher avg 15.55ms, max 30.95ms)
  - ~2.5–2.7× schneller im Schnitt, Spitzen (`max`) um Faktor ~3–5 niedriger — der
    quadratische Kollisions-/Food-Term ist raus. (Bot-Gefahren-Scan bleibt bewusst
    quadratisch, siehe Decision 3; im „viele Menschen"-Szenario sinkt die Bot-Zahl
    ohnehin auf 0.)
- Auf der echten VPS (85.215.231.147, 2 vCores/1,8 GB) unter EXAKT den Prod-Limits
  gemessen (`docker run --cpus=1.0 -m 512m` mit dem gebauten Image; Live-Service
  unberührt — Wegwerf-Container mit ge­mounteten Code-Bäumen alt/neu). Tick-Budget
  bei 30 Hz = 33,3 ms:
  | snakes | alt avg (max) | neu avg (max) | Speedup |
  |--------|---------------|---------------|---------|
  | 30  | 7,62 ms (57,4)  | 3,05 ms (5,7)  | 2,5× |
  | 50  | 18,03 ms (30,3) | 7,16 ms (63,0) | 2,5× |
  | 80  | **42,45 ms (99,1) — über Budget** | 15,18 ms (71,8) | 2,8× |
  | 120 | **93,14 ms (222) — über Budget**  | 31,22 ms (94,0) | 3,0× |
  Kernaussage: Der alte Code reißt das 33,3-ms-Budget schon bei ~80 Snakes (Spiel würde
  in Zeitlupe laufen); der neue Code bleibt bis ~120 Snakes im Budget — die tragbare
  Population auf dieser Hardware verdoppelt sich grob. (`max` ist auf der geteilten VPS
  stark verrauscht — GC/Scheduling-Jitter; der `avg` ist das belastbare Signal.)

## References

- Research: `docs/agents/research/2026-07-02-backend-tick-cost-and-scaling.md`
- Hot path: `backend/game/game_room.py:212` (`tick`), `:234` (Kollision), `:194` (Magnet),
  `:255` (Fressen), `:218` (Kontext)
- Broadcast/Loop: `backend/main.py:43` (`broadcast_tick`), `:66` (`game_loop`)
- Config-Protokolle: `backend/game/types.py:48` (`GameConfig`)
- Test-Fixtures: `backend/tests/conftest.py:18` (`test_config`)
</content>
