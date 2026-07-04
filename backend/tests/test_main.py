import asyncio
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

import main
from game import config
from game.game_room import GameRoom


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """A fresh, isolated GameRoom + connections dict per test.

    Deliberately NOT using `with TestClient(...)`: that would trigger the
    app's lifespan (starts the real 30Hz game_loop background task), which
    would make these tests slow/non-deterministic. Without lifespan,
    `game_room`/`connections` stay exactly as set here and `broadcast_tick()`
    can be awaited explicitly where a test needs a tick.

    Built with NUM_BOTS=0 (rather than the real config's NUM_BOTS=6):
    GameRoom.__init__ now self-populates bots, and letting 6 real bots tick
    in every test would reintroduce the non-determinism this fixture exists
    to avoid. Tests that need bot-rebalancing behavior build their own
    GameRoom with a non-zero NUM_BOTS override instead of using this fixture.
    """
    zero_bots_config = SimpleNamespace(**{**vars(config), "NUM_BOTS": 0})
    monkeypatch.setattr(main, "game_room", GameRoom(zero_bots_config))
    monkeypatch.setattr(main, "connections", {})
    monkeypatch.setattr(main, "admin_ids", set())
    yield TestClient(main.app)


async def _send_and_settle(ws: WebSocketTestSession, message: dict[str, object]) -> None:
    """`ws.send_*` hands off to a background thread that runs the ASGI app;
    give that thread's event loop a moment to actually process the message
    before the test proceeds to force a tick, otherwise there's a race
    between "message queued" and "message handled"."""
    ws.send_json(message)
    await asyncio.sleep(0.05)


def test_sleep_duration_returns_remaining_time_when_under_budget() -> None:
    assert main.sleep_duration(0.01, 1 / 30) == pytest.approx(1 / 30 - 0.01)


def test_sleep_duration_clamps_to_zero_when_over_budget() -> None:
    # Überlast: der Tick brauchte länger als das Budget -> keine (negative) Pause.
    assert main.sleep_duration(0.05, 1 / 30) == 0.0


def test_sleep_duration_is_zero_at_exact_deadline() -> None:
    assert main.sleep_duration(1 / 30, 1 / 30) == 0.0


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


def _bot_count(room: GameRoom) -> int:
    return len([p for p in room.players.all() if p.player_type == "ai"])


@pytest.mark.asyncio
async def test_sequential_joins_reduce_the_visible_bot_count(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    bots_config = SimpleNamespace(**{**vars(config), "NUM_BOTS": 2})
    monkeypatch.setattr(main, "game_room", GameRoom(bots_config))
    assert _bot_count(main.game_room) == 2

    with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
        ws1.receive_json()  # welcome
        ws2.receive_json()  # welcome
        await _send_and_settle(ws1, {"type": "join", "name": "Alice"})
        await _send_and_settle(ws2, {"type": "join", "name": "Bob"})

        # Checked while both connections are still open — closing the `with`
        # block below disconnects both humans again, which would refill bots.
        assert _bot_count(main.game_room) == 0


def test_disconnect_refills_a_bot(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    bots_config = SimpleNamespace(**{**vars(config), "NUM_BOTS": 1})
    monkeypatch.setattr(main, "game_room", GameRoom(bots_config))
    assert _bot_count(main.game_room) == 1

    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # welcome
        ws.send_json({"type": "join", "name": "Carol"})

    assert _bot_count(main.game_room) == 1


@pytest.mark.asyncio
async def test_debug_pause_is_ignored_when_debug_commands_disabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "DEBUG_COMMANDS_ENABLED", False)
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # welcome
        assert main.game_room.paused is False

        await _send_and_settle(ws, {"type": "debug_pause", "paused": True})
        await main.broadcast_tick()
        state = ws.receive_json()

        assert main.game_room.paused is False
        assert state["paused"] is False


@pytest.mark.asyncio
async def test_debug_bots_is_ignored_when_debug_commands_disabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "DEBUG_COMMANDS_ENABLED", False)
    with client.websocket_connect("/ws") as ws:
        welcome = ws.receive_json()
        player_id = welcome["player_id"]
        await _send_and_settle(ws, {"type": "join", "name": "Judy"})

        await _send_and_settle(ws, {"type": "debug_bots", "count": 5})
        await _send_and_settle(ws, {"type": "debug_teleport", "x": 12.0, "y": 34.0})

        assert _bot_count(main.game_room) == 0
        player = main.game_room.players.get(player_id)
        assert player is not None and player.snake is not None
        assert (player.snake.points[0].x, player.snake.points[0].y) != (12.0, 34.0)


def test_ws_rejects_foreign_origin(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "ALLOWED_WS_ORIGINS", {"http://localhost:8000"})
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": "http://evil.example"}) as ws:
            ws.receive_json()


def test_ws_allows_configured_origin(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "ALLOWED_WS_ORIGINS", {"http://localhost:8000"})
    with client.websocket_connect("/ws", headers={"origin": "http://localhost:8000"}) as ws:
        assert ws.receive_json()["type"] == "welcome"


def test_ws_allows_missing_origin(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # Nicht-Browser-Clients senden keinen Origin und sind kein CSWSH-Vektor.
    monkeypatch.setattr(main, "ALLOWED_WS_ORIGINS", {"http://localhost:8000"})
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "welcome"


def test_ws_rejects_when_connection_cap_reached(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "MAX_WS_CONNECTIONS", 1)
    monkeypatch.setitem(main.connections, "existing", object())
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws") as ws:
            ws.receive_json()


def test_ws_disconnects_on_message_flood(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "WS_MAX_MSGS_PER_SEC", 5)
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # welcome
        # dash erzeugt keine Antwort; alle senden, dann lesen bis der Server trennt.
        with pytest.raises(WebSocketDisconnect):
            for _ in range(50):
                ws.send_text('{"type": "dash"}')
            while True:
                ws.receive_json()


def test_admin_route_sets_cookie_only_when_proxy_trusted(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "TRUST_PROXY_ADMIN", False)
    off = client.get("/admin")
    assert off.status_code == 200
    assert "<canvas" in off.text
    assert off.cookies.get("admin_session") is None  # kein Admin-Cookie wenn nicht vertraut

    monkeypatch.setattr(main, "TRUST_PROXY_ADMIN", True)
    on = client.get("/admin")
    assert on.status_code == 200
    assert on.cookies.get("admin_session")  # Cookie gesetzt (Caddy hat /admin geschützt)


@pytest.mark.asyncio
async def test_admin_cookie_unlocks_debug_over_ws(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Global aus. Das von /admin gesetzte Cookie weist die /ws-Verbindung als Admin aus.
    monkeypatch.setattr(main, "DEBUG_COMMANDS_ENABLED", False)
    monkeypatch.setattr(main, "TRUST_PROXY_ADMIN", True)
    cookie = client.get("/admin").cookies["admin_session"]

    with client.websocket_connect("/ws", headers={"Cookie": f"admin_session={cookie}"}) as ws:
        welcome = ws.receive_json()
        assert welcome["is_admin"] is True

        await _send_and_settle(ws, {"type": "debug_bots", "count": 3})
        assert _bot_count(main.game_room) == 3


@pytest.mark.asyncio
async def test_ws_without_admin_cookie_stays_locked(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "DEBUG_COMMANDS_ENABLED", False)
    monkeypatch.setattr(main, "TRUST_PROXY_ADMIN", True)
    with client.websocket_connect("/ws") as ws:
        welcome = ws.receive_json()
        assert welcome["is_admin"] is False

        await _send_and_settle(ws, {"type": "debug_bots", "count": 3})
        assert _bot_count(main.game_room) == 0
