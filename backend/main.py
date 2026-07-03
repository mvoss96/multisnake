import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

from game import config
from game.game_room import GameRoom
from game.player import HumanPlayer
from game.protocol import (
    DashMessage,
    DebugBotsMessage,
    DebugInvulnerableMessage,
    DebugPauseMessage,
    DebugResetMessage,
    DebugSpawnAtMessage,
    DebugTeleportMessage,
    DirectionMessage,
    JoinMessage,
    RestartMessage,
    game_over_message,
    parse_client_message,
    welcome_message,
)

game_room = GameRoom(config)
connections: dict[str, WebSocket] = {}  # player_id -> WebSocket

# debug_* WS commands are a local dev tool (see CLAUDE.md) with no auth of
# their own; default on so `uv run uvicorn` keeps working unconfigured, but
# disable explicitly for the public Docker deployment.
DEBUG_COMMANDS_ENABLED = os.environ.get("ENABLE_DEBUG_COMMANDS", "true").lower() != "false"

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


async def broadcast_tick() -> None:
    game_over_events = [] if game_room.paused else game_room.tick(config.TICK_DT)
    # State nur EINMAL pro Tick zu JSON-Text serialisieren (nicht C-mal), dann
    # denselben Frame parallel an alle Verbindungen senden.
    text = game_room.serialize_state().model_dump_json()

    items = list(connections.items())
    results = await asyncio.gather(*(ws.send_text(text) for _, ws in items), return_exceptions=True)
    for (player_id, _), res in zip(items, results, strict=True):
        if isinstance(res, Exception):
            connections.pop(player_id, None)
            game_room.remove_player(player_id)

    for player_id, score in game_over_events:
        target_ws = connections.get(player_id)
        if target_ws:
            try:
                await target_ws.send_json(game_over_message(player_id, score).model_dump())
            except Exception:
                pass


def sleep_duration(elapsed: float, tick_dt: float) -> float:
    """Verbleibende Schlafzeit bis zur nächsten Tick-Deadline. Bei Überlast
    (elapsed >= tick_dt) 0.0 -> die Loop läuft ohne Pause weiter, statt durch
    eine feste Pause in Zeitlupe zu geraten."""
    return max(0.0, tick_dt - elapsed)


async def game_loop() -> None:
    loop = asyncio.get_running_loop()
    while True:
        start = loop.time()
        await broadcast_tick()
        await asyncio.sleep(sleep_duration(loop.time() - start, config.TICK_DT))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    asyncio.create_task(game_loop())
    yield


app = FastAPI(lifespan=lifespan)


# StaticFiles serves the frontend without any Cache-Control header, so browsers fall
# back to heuristic caching - after a deploy, clients can keep running a stale mix of
# HTML/CSS/JS for a long time without any visible sign of it (confusing bug reports
# that don't match what a fresh load shows). "no-cache" forces a conditional
# revalidation (If-None-Match/If-Modified-Since, which StaticFiles already supports)
# on every request instead - cheap 304s when unchanged, always-fresh content when not.
@app.middleware("http")
async def add_no_cache_header(request: Request, call_next: RequestResponseEndpoint) -> Response:
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    player_id = str(uuid.uuid4())
    connections[player_id] = websocket
    await websocket.send_json(
        welcome_message(
            player_id, game_room.board, game_room.obstacles, DEBUG_COMMANDS_ENABLED
        ).model_dump()
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = parse_client_message(raw)
            except ValidationError:
                continue

            match msg:
                case JoinMessage(name=name):
                    if game_room.players.get(player_id) is None:
                        clean_name = (name or "").strip()[:20] or "Spieler"
                        game_room.add_human_player(player_id, name=clean_name)
                case DirectionMessage(angle=angle):
                    player = game_room.players.get(player_id)
                    if isinstance(player, HumanPlayer):
                        player.set_direction(angle)
                case RestartMessage():
                    game_room.respawn_player(player_id)
                case DashMessage():
                    player = game_room.players.get(player_id)
                    if player and player.snake:
                        player.snake.try_dash()
                case DebugPauseMessage(paused=paused) if DEBUG_COMMANDS_ENABLED:
                    game_room.set_paused(paused)
                case DebugTeleportMessage(x=x, y=y) if DEBUG_COMMANDS_ENABLED:
                    game_room.debug_teleport(player_id, x, y)
                case DebugSpawnAtMessage(x=x, y=y) if DEBUG_COMMANDS_ENABLED:
                    game_room.debug_respawn_at(player_id, x, y)
                case DebugInvulnerableMessage(enabled=enabled) if DEBUG_COMMANDS_ENABLED:
                    game_room.debug_set_invulnerable(player_id, enabled)
                case DebugBotsMessage(count=count) if DEBUG_COMMANDS_ENABLED:
                    game_room.debug_set_bot_count(count)
                case DebugResetMessage() if DEBUG_COMMANDS_ENABLED:
                    game_room.debug_reset()
    except WebSocketDisconnect:
        pass
    finally:
        connections.pop(player_id, None)
        game_room.remove_player(player_id)


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
