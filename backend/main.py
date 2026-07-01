import asyncio
import uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from game import config
from game.game_room import GameRoom
from game.protocol import game_over_message, parse_client_message, welcome_message

app = FastAPI()

game_room = GameRoom(config)
connections = {}  # player_id -> WebSocket

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    player_id = str(uuid.uuid4())
    connections[player_id] = websocket
    await websocket.send_json(welcome_message(player_id, game_room.board))

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = parse_client_message(raw)
            except ValueError:
                continue
            msg_type = msg.get("type")
            if msg_type == "join":
                if game_room.players.get(player_id) is None:
                    name = (msg.get("name") or "").strip()[:20] or "Spieler"
                    game_room.add_human_player(player_id, name=name)
            elif msg_type == "direction":
                player = game_room.players.get(player_id)
                if player:
                    angle = msg.get("angle")
                    if isinstance(angle, (int, float)):
                        player.set_direction(float(angle))
            elif msg_type == "restart":
                game_room.respawn_player(player_id)
            elif msg_type == "dash":
                player = game_room.players.get(player_id)
                if player and player.snake:
                    player.snake.try_dash()
            elif msg_type == "debug_pause":
                game_room.set_paused(bool(msg.get("paused", True)))
            elif msg_type == "debug_teleport":
                x, y = msg.get("x"), msg.get("y")
                if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                    game_room.debug_teleport(player_id, float(x), float(y))
            elif msg_type == "debug_spawn_at":
                x, y = msg.get("x"), msg.get("y")
                if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                    game_room.debug_respawn_at(player_id, float(x), float(y))
            elif msg_type == "debug_invulnerable":
                game_room.debug_set_invulnerable(player_id, bool(msg.get("enabled", True)))
            elif msg_type == "debug_bots":
                count = msg.get("count")
                if isinstance(count, int) and count >= 0:
                    game_room.debug_set_bot_count(count)
    except WebSocketDisconnect:
        pass
    finally:
        connections.pop(player_id, None)
        game_room.remove_player(player_id)


async def game_loop():
    while True:
        await asyncio.sleep(config.TICK_DT)
        game_over_events = [] if game_room.paused else game_room.tick(config.TICK_DT)
        state = game_room.serialize_state()

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
            ws = connections.get(player_id)
            if ws:
                try:
                    await ws.send_json(game_over_message(player_id, score))
                except Exception:
                    pass


@app.on_event("startup")
async def on_startup():
    game_room.add_ai_players(config.NUM_BOTS)
    asyncio.create_task(game_loop())


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
