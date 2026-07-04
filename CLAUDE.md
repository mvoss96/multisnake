# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## WHAT

### Tech stack
- **Backend**: Python 3.12, FastAPI + WebSocket (`/ws`), uvicorn. No database/ORM — all game state lives in-memory in one `GameRoom` instance for the process lifetime. Fully type-annotated, checked with `mypy --strict`; linted/formatted with `ruff`; dependencies + venv managed by `uv` (`backend/pyproject.toml` + `backend/uv.lock`). WebSocket messages (in and out) are Pydantic models, not raw dicts.
- **Frontend**: Vanilla JS, no framework/bundler/build step. Plain `<script>` tags loaded in a fixed order; HTML5 Canvas for all rendering. Untyped/untested by design (see WHY) — out of scope for the backend modernization below.
- `backend/tests/` mirrors `backend/game/`'s structure; run via `uv run pytest` (see HOW).

### Project structure
```
backend/
  main.py             FastAPI app (lifespan-managed startup), WebSocket endpoint (Pydantic
                       match/case dispatch), broadcast_tick()/game_loop() (30 Hz)
  game/
    config.py          ALL tunable backend gameplay constants — single source of truth
    game_room.py        Core simulation: GameRoom.tick() — movement, collisions, food, respawns
    snake.py             Snake physics: movement, turning, dash, growth
    board.py              Board bounds + out-of-bounds check (configurable margin)
    food.py                Food spawning, value tiers (1/2/5), lifetime/despawn
    bot.py                  AI heuristic (seek food / avoid danger / wander)
    player.py                HumanPlayer / AIPlayer / PlayerManager abstraction
    vector.py                 Minimal Vector2 (no numpy dependency)
    protocol.py                Pydantic message models (in/out) + JSON (de)serialization
    types.py                    Per-consumer config Protocols (FoodConfig/SnakeConfig/BotConfig/
                                 GameConfig) — see WHY
  tests/              Mirrors game/'s structure (tests/game/test_*.py) + test_main.py
    conftest.py         Shared fixtures: test_config, game_room, spawn_snake_at
frontend/
  index.html            Script load order matters — config.js must load first
  style.css
  js/
    config.js            ALL tunable frontend visual/input constants (mirrors selected
                          backend/game/config.py values manually — not shared/imported)
    state.js               Global GameState (playerId, board, controlMode, ownDirection)
    network.js               WebSocketClient — one send* method per outgoing message type
    input.js                    Keyboard handling (absolute vs. relative steering, dash key)
    renderer.js                  All canvas drawing (snakes, food, spikes, glow/blink effects)
    main.js                       Wires everything together on DOMContentLoaded
```

### Apps/libs
Single app, no monorepo/libs split. One FastAPI process serves both the WebSocket API and the static frontend (`StaticFiles` mount in `main.py`) — there is no separate frontend server or package.

## WHY

### Purpose of the project
Multiplayer Snake with continuous (non-grid) movement: one human player against several AI bots sharing one board, camera follows the player's own snake. Started as a local learning/demo project; it has since also been deployed publicly (Docker container behind a Caddy reverse proxy) for hands-on multiplayer testing, so treat any change touching the WebSocket protocol or debug commands as potentially internet-facing, not purely local-only.

### Purpose of certain modules
- `game_room.py` is deliberately the only place where cross-entity rules live (snake-vs-snake collisions, food consumption, spike-zone death, food magnet/consolidation on death). `snake.py` and `food.py` only know about their own state and stay unaware of each other.
- `config.py` (both backend and frontend) exists so gameplay/visual tuning never requires touching logic files — new tunables always go here first, not inline. It stays a flat module of constants (not a dataclass/settings object) deliberately — every consumer already imports and passes it around as `from game import config`, and there's no env-var loading or multi-config need that would justify the bigger refactor.
- `game/types.py`'s config Protocols are split **per consumer** (`FoodConfig`, `SnakeConfig`, `BotConfig`, plus `GameConfig` combining all three for `GameRoom`) rather than one shared protocol, specifically so a minimal fake config in a test only has to satisfy the attributes that particular module actually reads.
- `frontend/js/config.js` was split out from `renderer.js`/`input.js` to stop duplicating magic numbers across files. It mirrors (does not import) select backend `config.py` values, since the two runtimes share no code — keep both sides in sync by hand when changing shared values like food/spike radii.
- The backend `debug_*` WebSocket message types (`debug_pause`, `debug_teleport`, `debug_spawn_at`, `debug_invulnerable`, `debug_bots`) exist purely for developer/agent-driven testing of the dense, fast-killing bot arena — not a player-facing feature. They carry no authentication of their own, so `main.py`'s `DEBUG_COMMANDS_ENABLED` flag (from the `ENABLE_DEBUG_COMMANDS` env var, default on) gates them at the `match`/`case` dispatch level — local `uv run uvicorn` keeps them on unconfigured, while the Docker deployment (`docker-compose.yml`) sets it to `false` so an anonymous internet client can't freeze the game (`debug_pause`) or otherwise manipulate global state. `DebugBotsMessage.count` additionally has a hard upper bound (`le=50` in `protocol.py`) as defense-in-depth, since it used to accept an unbounded value that could drive bot-spawning into a CPU/memory exhaustion DoS. The frontend surfaces these via an in-game **debug console** (bottom-left 🐞 toggle / backtick key; `#debug-console` in `index.html`, wired in `main.js`) with controls for bot count, pause, self-invulnerability and teleport — it is only shown when the server reports `debug_enabled: true` in the `welcome` message (from the same `DEBUG_COMMANDS_ENABLED` flag), so the public deployment (debug off) never renders a dead/ineffective console. For use on the **public server**, there is a per-connection admin path whose **password auth is delegated to Caddy** (the reverse proxy). Caddy puts `basic_auth` on the **`/admin` page** in the VPS Caddyfile. Since the container only binds `127.0.0.1` (reachable *only* through Caddy), a `GET /admin` reaching the app means Caddy already authenticated — so `main.py`'s `/admin` route then sets a **signed cookie** (`admin_session` = HMAC over a per-process or `ADMIN_COOKIE_SECRET` key; `Secure` only when `X-Forwarded-Proto=https`). The **public `/ws` handshake carries that cookie** (cookies are reliably sent on WS handshakes — unlike cached Basic-Auth creds, which browsers like Chrome do **not** attach to WS upgrades, so protecting a WS route with Caddy basic_auth is a dead end for browsers). `main.py` validates the cookie, marks only that connection admin (`admin_ids`), and reports `is_admin: true` in `welcome`; its `debug_*` are then accepted even with `DEBUG_COMMANDS_ENABLED=false` (guard `DEBUG_COMMANDS_ENABLED or player_id in admin_ids`). Full scope incl. global commands — a deliberate trust decision. The cookie is only issued when **`TRUST_PROXY_ADMIN=true`** (env via non-committed VPS `.env`, wired in `docker-compose.yml`) — the safety switch so `/admin` visitors don't become admin before the Caddy rule exists (default `false` ⇒ no admin). Only `/admin` needs Caddy protection (not `/ws`); the frontend always connects to `/ws` and shows the console on `welcome.is_admin`. (`.env` is gitignored.)
- `protocol.py`'s WS messages are Pydantic models (a discriminated union on `type` for incoming messages) instead of raw dicts, so `main.py` validates input via Pydantic and dispatches with `match`/`case` on the parsed model type instead of manual `isinstance` checks on dict values.
- `/ws` DoS/abuse hardening (all in `main.py`, env-tunable, wired in `docker-compose.yml`): (1) **CSWSH** — the handshake rejects any browser `Origin` not in `ALLOWED_WS_ORIGINS` (missing `Origin` = non-browser client is allowed); the compose default MUST list the public domain (`https://snake.marcusvoss.de`) or real players get rejected. (2) **Connection cap** `MAX_WS_CONNECTIONS` (reject beyond, code 1013) since every connection spawns a snake. (3) **Per-connection message-rate limit** `WS_MAX_MSGS_PER_SEC` (sliding 1s window; a flood disconnects the socket). Also: `DirectionMessage.angle` (and the debug `x`/`y` coordinate fields) use Pydantic `Field(allow_inf_nan=False)` — a non-finite `angle` used to poison head coordinates via `snake.move()`'s trig and, combined with an unguarded `game_loop()`, permanently stall the sim for everyone; `game_loop()` now also wraps each tick in `try/except` so no single bad tick can kill broadcasting. Still no message-*size* limit (beyond Pydantic validation) — acceptable for current scope.
- The backend modernization (Python 3.12, strict typing, tests, `uv`) intentionally stopped at the backend boundary — the frontend has no build step to hang a type-checker/bundler off of, and introducing one was out of scope for this pass.

## HOW

### How to run
```bash
cd backend
uv sync                                                     # first time / after dependency changes
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
Open `http://localhost:8000/`. The same FastAPI process serves the WebSocket API and the static frontend — nothing else needs to run. `uv` manages the Python 3.12 interpreter, `.venv/`, and locked dependencies (`uv.lock`) automatically — no manual venv activation needed, prefix any command with `uv run`.

`--reload` is required for the normal edit-reload workflow. Without it, `main.py`'s `game_loop()` background task keeps running the stale code and must be manually restarted after every backend change.

### How to verify changes
Run from `backend/` before considering a backend change complete:
```bash
uv run pytest                           # or: uv run pytest --cov=game --cov=main
uv run ruff check .
uv run ruff format --check .
uv run mypy .                           # strict, repo-wide, no per-module exemptions
```
- Tests live under `backend/tests/`, mirroring `backend/game/`'s structure. `tests/conftest.py` provides `test_config` (small/deterministic config), `game_room` (a `GameRoom` built from it), and `spawn_snake_at` (places a snake at an exact position/heading, bypassing the randomized safe-spawn search) — reuse these instead of constructing a `GameRoom` by hand.
- `GameRoom` uses an injected `self._rng = random.Random()` (not the `random` module directly) specifically so tests can seed/monkeypatch it for deterministic assertions on tier-consolidation, spawn color, etc.
- `tests/test_main.py` exercises the WebSocket layer via FastAPI's `TestClient`. It deliberately avoids `with TestClient(app):` (which would trigger the real lifespan — spawning `NUM_BOTS` bots and a live 30 Hz `game_loop()` — making tests slow/non-deterministic); instead it monkeypatches `main.game_room`/`main.connections` per test and calls `await main.broadcast_tick()` directly to force exactly one tick. `TestClient`'s websocket send runs in a background thread, so a short `asyncio.sleep(...)` after `send_json`/`send_text` is needed before forcing a tick, otherwise there's a race between "message queued" and "message handled".
- For frontend/visual changes (no equivalent test suite by design, see WHY): use the `debug_*` WS commands to freeze the simulation (`debug_pause`) and place the player at an exact spot (`debug_teleport`, `debug_invulnerable`) instead of racing against bot deaths in the dense default arena. Prefer moderate, roughly square viewport resizes over extreme aspect ratios when trying to "zoom in" — canvas scale is driven only by `canvas.height / VIEW_WORLD_HEIGHT`, so a very tall/narrow resize distorts the view rather than zooming it, and shrinks on-screen UI text.
- The dev server serves static JS without explicit cache headers, so browsers apply heuristic caching — after editing frontend files, force a cache-bypassing reload of the changed files (e.g. `fetch(url, {cache: "reload"})`) before reloading the page, otherwise stale JS can silently keep running.

### How to follow standards
- Add new gameplay constants to `backend/game/config.py`; add new visual/input constants to `frontend/js/config.js`. Never hardcode magic numbers inline in logic or rendering code.
- Keep cross-entity game rules in `game_room.py`; keep `snake.py` / `food.py` / `board.py` self-contained.
- All backend code must be fully type-annotated and pass `uv run mypy .` (repo-wide `strict = true`, no per-module exemptions left). If a function takes the `config` module as a parameter, type it against the narrowest `game/types.py` Protocol that covers the attributes it actually reads (extend that Protocol rather than widening to `GameConfig` or falling back to `types.ModuleType`).
- New WebSocket message types go in `game/protocol.py` as a Pydantic `BaseModel` added to the `ClientMessage`/outgoing unions, not as ad-hoc dict handling in `main.py`.
- Existing code comments are in German — match that convention in this repo unless told otherwise.
