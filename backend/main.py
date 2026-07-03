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
from starlette.responses import FileResponse, Response

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

# Admin-Zugang für die /admin-Debug-Konsole: Die Authentifizierung macht der Reverse-
# Proxy (Caddy basic_auth auf /admin*, inkl. der Admin-WS-Route /admin/ws). Die App
# selbst prüft kein Passwort - sie VERTRAUT Verbindungen auf /admin/ws als Admin, aber
# nur wenn TRUST_PROXY_ADMIN=true gesetzt ist. Das Flag ist der Sicherheits-Schalter:
# solange es aus ist (Default), gewährt /admin/ws KEINE Admin-Rechte - so ist die Route
# nicht versehentlich offen, bevor die Caddy-basic_auth-Regel steht. Da der Container nur
# an 127.0.0.1 lauscht, erreicht die App ausschließlich über Caddy; ist /admin* dort
# geschützt, sind /admin/ws-Verbindungen also authentifiziert.
TRUST_PROXY_ADMIN = os.environ.get("TRUST_PROXY_ADMIN", "false").lower() == "true"
# player_ids der pro-Verbindung als Admin erkannten Clients.
admin_ids: set[str] = set()

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


# /admin liefert dieselbe SPA wie / - der Reverse-Proxy (Caddy) schützt den Pfad per
# basic_auth. Die App macht hier KEINE Auth (das Frontend verbindet dann auf /admin/ws).
# Muss VOR dem StaticFiles-Mount stehen.
@app.get("/admin")
async def admin_page() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "index.html"))


async def _serve_ws(websocket: WebSocket, is_admin: bool) -> None:
    await websocket.accept()
    player_id = str(uuid.uuid4())
    connections[player_id] = websocket
    if is_admin:
        admin_ids.add(player_id)
    await websocket.send_json(
        welcome_message(
            player_id,
            game_room.board,
            game_room.obstacles,
            DEBUG_COMMANDS_ENABLED,
            is_admin,
        ).model_dump()
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = parse_client_message(raw)
            except ValidationError:
                continue

            # debug_*-Befehle sind erlaubt, wenn sie global freigeschaltet sind
            # (lokaler Dev) ODER diese Verbindung sich als Admin authentifiziert hat.
            debug_ok = DEBUG_COMMANDS_ENABLED or player_id in admin_ids

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
                case DebugPauseMessage(paused=paused) if debug_ok:
                    game_room.set_paused(paused)
                case DebugTeleportMessage(x=x, y=y) if debug_ok:
                    game_room.debug_teleport(player_id, x, y)
                case DebugSpawnAtMessage(x=x, y=y) if debug_ok:
                    game_room.debug_respawn_at(player_id, x, y)
                case DebugInvulnerableMessage(enabled=enabled) if debug_ok:
                    game_room.debug_set_invulnerable(player_id, enabled)
                case DebugBotsMessage(count=count) if debug_ok:
                    game_room.debug_set_bot_count(count)
                case DebugResetMessage() if debug_ok:
                    game_room.debug_reset()
    except WebSocketDisconnect:
        pass
    finally:
        connections.pop(player_id, None)
        admin_ids.discard(player_id)
        game_room.remove_player(player_id)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    # Öffentliche Spieler-Verbindung - nie Admin.
    await _serve_ws(websocket, is_admin=False)


@app.websocket("/admin/ws")
async def admin_websocket_endpoint(websocket: WebSocket) -> None:
    # Admin-Verbindung: Caddy schützt /admin* per basic_auth, daher gilt eine Verbindung
    # hier als authentifiziert - aber nur wenn TRUST_PROXY_ADMIN gesetzt ist (sonst nicht
    # als Admin, damit die Route vor der Caddy-Regel nicht offen ist).
    await _serve_ws(websocket, is_admin=TRUST_PROXY_ADMIN)


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
