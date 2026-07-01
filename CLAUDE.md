# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## WHAT

### Tech stack
- **Backend**: Python, FastAPI + WebSocket (`/ws`), uvicorn. No database/ORM — all game state lives in-memory in one `GameRoom` instance for the process lifetime.
- **Frontend**: Vanilla JS, no framework/bundler/build step. Plain `<script>` tags loaded in a fixed order; HTML5 Canvas for all rendering.
- No automated test suite (`backend/tests/` exists but is empty) and no linter configured. Verification is manual (see HOW).

### Project structure
```
backend/
  main.py             FastAPI app, WebSocket endpoint, 30 Hz game loop, debug_* WS commands
  game/
    config.py          ALL tunable backend gameplay constants — single source of truth
    game_room.py        Core simulation: GameRoom.tick() — movement, collisions, food, respawns
    snake.py             Snake physics: movement, turning, dash, growth
    board.py              Board bounds + out-of-bounds check (configurable margin)
    food.py                Food spawning, value tiers (1/2/5), lifetime/despawn
    bot.py                  AI heuristic (seek food / avoid danger / wander)
    player.py                HumanPlayer / AIPlayer / PlayerManager abstraction
    vector.py                 Minimal Vector2 (no numpy dependency)
    protocol.py                WS message dict builders (welcome/game_over) + JSON parsing
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
Multiplayer Snake in the style of slither.io: continuous (non-grid) movement, one human player against several AI bots sharing one board, camera follows the player's own snake. Local learning/demo project, not intended for public deployment.

### Purpose of certain modules
- `game_room.py` is deliberately the only place where cross-entity rules live (snake-vs-snake collisions, food consumption, spike-zone death, food magnet/consolidation on death). `snake.py` and `food.py` only know about their own state and stay unaware of each other.
- `config.py` (both backend and frontend) exists so gameplay/visual tuning never requires touching logic files — new tunables always go here first, not inline.
- `frontend/js/config.js` was split out from `renderer.js`/`input.js` to stop duplicating magic numbers across files. It mirrors (does not import) select backend `config.py` values, since the two runtimes share no code — keep both sides in sync by hand when changing shared values like food/spike radii.
- The backend `debug_*` WebSocket message types (`debug_pause`, `debug_teleport`, `debug_spawn_at`, `debug_invulnerable`, `debug_bots`) exist purely for developer/agent-driven testing of the dense, fast-killing bot arena — not a player-facing feature.

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
There is no automated test suite, so verification is manual:
- **Backend logic**: exercise `GameRoom` / `Snake` / `FoodManager` directly with one-off `python3 -c "..."` scripts rather than driving the live game — the default 6-bot arena kills a human player within 1–2 seconds most of the time, making live verification unreliable.
- **Frontend/visual changes**: use the `debug_*` WS commands to freeze the simulation (`debug_pause`) and place the player at an exact spot (`debug_teleport`, `debug_invulnerable`) instead of racing against bot deaths. Prefer moderate, roughly square viewport resizes over extreme aspect ratios when trying to "zoom in" — canvas scale is driven only by `canvas.height / VIEW_WORLD_HEIGHT`, so a very tall/narrow resize distorts the view rather than zooming it, and shrinks on-screen UI text.
- The dev server serves static JS without explicit cache headers, so browsers apply heuristic caching — after editing frontend files, force a cache-bypassing reload of the changed files (e.g. `fetch(url, {cache: "reload"})`) before reloading the page, otherwise stale JS can silently keep running.

### How to follow standards
- Add new gameplay constants to `backend/game/config.py`; add new visual/input constants to `frontend/js/config.js`. Never hardcode magic numbers inline in logic or rendering code.
- Keep cross-entity game rules in `game_room.py`; keep `snake.py` / `food.py` / `board.py` self-contained.
- Existing code comments are in German — match that convention in this repo unless told otherwise.
