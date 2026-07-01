import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from game import config
from game.game_room import GameRoom
from game.player import HumanPlayer
from game.protocol import (
    DashMessage,
    DebugBotsMessage,
    DebugInvulnerableMessage,
    DebugPauseMessage,
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

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


async def broadcast_tick() -> None:
    game_over_events = [] if game_room.paused else game_room.tick(config.TICK_DT)
    state = game_room.serialize_state().model_dump()

    stale = []
    for player_id, ws in list(connections.items()):
        try:
            await ws.send_json(state)
        except Exception:
            stale.append(player_id)
    for player_id in stale:
        connections.pop(player_id, None)
        game_room.remove_player(player_id)

    for player_id, score in game_over_events:
        target_ws = connections.get(player_id)
        if target_ws:
            try:
                await target_ws.send_json(game_over_message(player_id, score).model_dump())
            except Exception:
                pass


async def game_loop() -> None:
    while True:
        await asyncio.sleep(config.TICK_DT)
        await broadcast_tick()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    asyncio.create_task(game_loop())
    yield


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    player_id = str(uuid.uuid4())
    connections[player_id] = websocket
    await websocket.send_json(welcome_message(player_id, game_room.board).model_dump())

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
                case DebugPauseMessage(paused=paused):
                    game_room.set_paused(paused)
                case DebugTeleportMessage(x=x, y=y):
                    game_room.debug_teleport(player_id, x, y)
                case DebugSpawnAtMessage(x=x, y=y):
                    game_room.debug_respawn_at(player_id, x, y)
                case DebugInvulnerableMessage(enabled=enabled):
                    game_room.debug_set_invulnerable(player_id, enabled)
                case DebugBotsMessage(count=count):
                    game_room.debug_set_bot_count(count)
    except WebSocketDisconnect:
        pass
    finally:
        connections.pop(player_id, None)
        game_room.remove_player(player_id)


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
