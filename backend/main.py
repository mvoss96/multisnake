import asyncio
import hashlib
import hmac
import os
import secrets
import time
import traceback
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

# Admin-Zugang für die /admin-Debug-Konsole: Die Authentifizierung (Passwort) macht der
# Reverse-Proxy Caddy per basic_auth auf der /admin-SEITE. Die App prüft kein Passwort;
# sie setzt beim Ausliefern von /admin ein SIGNIERTES Cookie und wertet es später am
# /ws-Handshake aus (Cookies werden - anders als Basic-Auth - zuverlässig beim
# WebSocket-Handshake mitgesendet). Das Cookie wird NUR gesetzt, wenn TRUST_PROXY_ADMIN
# gesetzt ist (Sicherheits-Schalter: solange aus, gibt es keinen Admin - so wird nicht
# versehentlich jeder /admin-Besucher Admin, bevor Caddy /admin schützt). Signiert wird
# mit einem Prozess-Geheimnis (oder ADMIN_COOKIE_SECRET, falls gesetzt, damit Cookies
# einen Neustart überleben); fälschen ist ohne das Geheimnis nicht möglich.
TRUST_PROXY_ADMIN = os.environ.get("TRUST_PROXY_ADMIN", "false").lower() == "true"
_ADMIN_SECRET = os.environ.get("ADMIN_COOKIE_SECRET", "") or secrets.token_hex(32)
# player_ids der pro-Verbindung als Admin erkannten Clients.
admin_ids: set[str] = set()

# CSWSH-Schutz: WS-Handshakes nur von erlaubten Origins akzeptieren. Browser senden
# immer einen Origin-Header, sodass eine fremde Seite (z.B. evil.com) den Handshake nicht
# durchbekommt und keine fremde Session steuern kann. Nicht-Browser-Clients (curl/native)
# ohne Origin sind kein CSRF-Vektor und werden durchgelassen. Kommagetrennt per env;
# auf dem VPS auf die echte Domain (https://snake.marcusvoss.de) setzen.
ALLOWED_WS_ORIGINS = {
    o.strip()
    for o in os.environ.get(
        "ALLOWED_WS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000"
    ).split(",")
    if o.strip()
}

# Obergrenze gleichzeitiger WS-Verbindungen (jede spawnt eine Schlange) - simpler Schutz
# gegen Verbindungs-Fluten. <=0 => unbegrenzt.
MAX_WS_CONNECTIONS = int(os.environ.get("MAX_WS_CONNECTIONS", "100"))

# Nachrichten-Ratenlimit je Verbindung (Nachrichten pro Sekunde). Legitime Eingaben
# (Richtung/Dash) liegen weit darunter; ein Flood-Loop wird getrennt. <=0 => aus.
WS_MAX_MSGS_PER_SEC = int(os.environ.get("WS_MAX_MSGS_PER_SEC", "250"))


def _origin_allowed(origin: str | None) -> bool:
    # Kein Origin (Nicht-Browser-Client) ist kein CSWSH-Vektor -> erlaubt.
    return origin is None or origin in ALLOWED_WS_ORIGINS


def _admin_cookie_value() -> str:
    return hmac.new(_ADMIN_SECRET.encode(), b"multisnake-admin", hashlib.sha256).hexdigest()


def _valid_admin_cookie(value: str | None) -> bool:
    if not TRUST_PROXY_ADMIN or not value:
        return False
    return secrets.compare_digest(value, _admin_cookie_value())


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
        # Ein Fehler in EINEM Tick (z.B. durch vergiftete Entity-Daten) darf niemals die
        # Loop-Task beenden - sonst tickt der Raum für ALLE Spieler nie wieder (DoS bis
        # Prozess-Neustart). Fehler loggen und weiter ticken.
        try:
            await broadcast_tick()
        except Exception:
            traceback.print_exc()
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


# /admin liefert dieselbe SPA wie / - Caddy schützt den Pfad per basic_auth. Wird die
# Seite ausgeliefert, war die Caddy-Auth also erfolgreich: dann (und nur bei
# TRUST_PROXY_ADMIN) setzt die App das signierte Admin-Cookie, mit dem sich die spätere
# /ws-Verbindung als Admin ausweist. Muss VOR dem StaticFiles-Mount stehen.
@app.get("/admin")
async def admin_page(request: Request) -> FileResponse:
    resp = FileResponse(str(FRONTEND_DIR / "index.html"))
    if TRUST_PROXY_ADMIN:
        # Secure nur hinter TLS (Caddy setzt X-Forwarded-Proto=https); lokal über http
        # bliebe das Cookie sonst ungesendet.
        https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
        resp.set_cookie(
            "admin_session",
            _admin_cookie_value(),
            max_age=86400,
            httponly=True,
            secure=https,
            samesite="strict",
            path="/",
        )
    return resp


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    # Vor dem accept: fremde Origins (CSWSH) und Verbindungs-Fluten abweisen.
    if not _origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008)  # Policy Violation
        return
    if 0 < MAX_WS_CONNECTIONS <= len(connections):
        await websocket.close(code=1013)  # Try Again Later
        return
    await websocket.accept()
    player_id = str(uuid.uuid4())
    connections[player_id] = websocket
    # Admin, wenn die Verbindung das signierte Cookie von /admin mitbringt.
    is_admin = _valid_admin_cookie(websocket.cookies.get("admin_session"))
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

    window_start = time.monotonic()
    msgs_in_window = 0
    try:
        while True:
            raw = await websocket.receive_text()
            # Ratenlimit je Verbindung: mehr als WS_MAX_MSGS_PER_SEC Nachrichten/Sekunde
            # gilt als Flut -> Verbindung trennen (kein globales Rate-Limit vorhanden).
            now = time.monotonic()
            if now - window_start >= 1.0:
                window_start = now
                msgs_in_window = 0
            msgs_in_window += 1
            if 0 < WS_MAX_MSGS_PER_SEC < msgs_in_window:
                break
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


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
