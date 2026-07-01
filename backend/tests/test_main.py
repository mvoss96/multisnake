import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

import main
from game import config
from game.game_room import GameRoom


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """A fresh, isolated GameRoom + connections dict per test.

    Deliberately NOT using `with TestClient(...)`: that would trigger the
    app's lifespan (adds NUM_BOTS bots and starts the real 30Hz game_loop
    background task), which would make these tests slow/non-deterministic.
    Without lifespan, `game_room`/`connections` stay exactly as set here and
    `broadcast_tick()` can be awaited explicitly where a test needs a tick.
    """
    monkeypatch.setattr(main, "game_room", GameRoom(config))
    monkeypatch.setattr(main, "connections", {})
    yield TestClient(main.app)


async def _send_and_settle(ws: WebSocketTestSession, message: dict[str, object]) -> None:
    """`ws.send_*` hands off to a background thread that runs the ASGI app;
    give that thread's event loop a moment to actually process the message
    before the test proceeds to force a tick, otherwise there's a race
    between "message queued" and "message handled"."""
    ws.send_json(message)
    await asyncio.sleep(0.05)


@pytest.mark.asyncio
async def test_join_then_tick_includes_my_snake_in_state(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        welcome = ws.receive_json()
        player_id = welcome["player_id"]

        await _send_and_settle(ws, {"type": "join", "name": "Alice"})
        await main.broadcast_tick()
        state = ws.receive_json()

        assert state["type"] == "state"
        matching = [s for s in state["snakes"] if s["player_id"] == player_id]
        assert len(matching) == 1
        assert matching[0]["name"] == "Alice"


def test_connect_receives_a_welcome_message(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "welcome"
        assert "player_id" in msg
        assert msg["board"] == {"width": config.BOARD_WIDTH, "height": config.BOARD_HEIGHT}


@pytest.mark.asyncio
async def test_invalid_json_does_not_crash_the_connection(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # welcome
        ws.send_text("this is not json")
        await asyncio.sleep(0.05)

        # The connection should still be alive and processing further messages.
        await _send_and_settle(ws, {"type": "join", "name": "Bob"})
        await main.broadcast_tick()
        state = ws.receive_json()
        assert any(s["name"] == "Bob" for s in state["snakes"])


@pytest.mark.asyncio
async def test_unknown_message_type_is_ignored(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # welcome
        ws.send_text('{"type": "does_not_exist"}')
        await asyncio.sleep(0.05)

        await _send_and_settle(ws, {"type": "join", "name": "Carol"})
        await main.broadcast_tick()
        state = ws.receive_json()
        assert any(s["name"] == "Carol" for s in state["snakes"])


@pytest.mark.asyncio
async def test_debug_pause_toggles_game_room_paused(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # welcome
        assert main.game_room.paused is False

        await _send_and_settle(ws, {"type": "debug_pause", "paused": True})
        await main.broadcast_tick()
        state = ws.receive_json()

        assert main.game_room.paused is True
        assert state["paused"] is True


def test_disconnect_removes_the_player(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        welcome = ws.receive_json()
        player_id = welcome["player_id"]
        ws.send_json({"type": "join", "name": "Dave"})

    assert main.game_room.players.get(player_id) is None
    assert player_id not in main.connections


@pytest.mark.asyncio
async def test_direction_message_sets_the_players_direction(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        welcome = ws.receive_json()
        player_id = welcome["player_id"]
        await _send_and_settle(ws, {"type": "join", "name": "Erin"})

        await _send_and_settle(ws, {"type": "direction", "angle": 1.5})
        # The player's desired direction is only applied to the snake once
        # GameRoom.tick() reads it via get_input_direction().
        await main.broadcast_tick()
        ws.receive_json()  # consume the resulting state broadcast

        player = main.game_room.players.get(player_id)
        assert player is not None and player.snake is not None
        assert player.snake.desired_direction == 1.5


@pytest.mark.asyncio
async def test_dash_message_triggers_a_dash(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        welcome = ws.receive_json()
        player_id = welcome["player_id"]
        await _send_and_settle(ws, {"type": "join", "name": "Frank"})

        await _send_and_settle(ws, {"type": "dash"})

        player = main.game_room.players.get(player_id)
        assert player is not None and player.snake is not None
        assert player.snake.dash_charge == 0.0


@pytest.mark.asyncio
async def test_restart_message_respawns_the_player(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        welcome = ws.receive_json()
        player_id = welcome["player_id"]
        await _send_and_settle(ws, {"type": "join", "name": "Grace"})
        player = main.game_room.players.get(player_id)
        assert player is not None and player.snake is not None
        old_snake_id = player.snake.id

        await _send_and_settle(ws, {"type": "restart"})

        assert player.snake is not None
        assert player.snake.id != old_snake_id


@pytest.mark.asyncio
async def test_debug_teleport_and_invulnerable_and_bots(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        welcome = ws.receive_json()
        player_id = welcome["player_id"]
        await _send_and_settle(ws, {"type": "join", "name": "Heidi"})

        await _send_and_settle(ws, {"type": "debug_teleport", "x": 12.0, "y": 34.0})
        await _send_and_settle(ws, {"type": "debug_invulnerable", "enabled": True})
        await _send_and_settle(ws, {"type": "debug_bots", "count": 2})

        player = main.game_room.players.get(player_id)
        assert player is not None and player.snake is not None
        assert (player.snake.points[0].x, player.snake.points[0].y) == (12.0, 34.0)
        assert player.snake.invulnerable is True
        assert len([p for p in main.game_room.players.all() if p.player_type == "ai"]) == 2


@pytest.mark.asyncio
async def test_debug_spawn_at_places_a_fresh_snake(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        welcome = ws.receive_json()
        player_id = welcome["player_id"]
        await _send_and_settle(ws, {"type": "join", "name": "Ivan"})

        await _send_and_settle(ws, {"type": "debug_spawn_at", "x": 7.0, "y": 8.0})

        player = main.game_room.players.get(player_id)
        assert player is not None and player.snake is not None
        assert (player.snake.points[0].x, player.snake.points[0].y) == (7.0, 8.0)
