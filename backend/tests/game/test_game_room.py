from types import SimpleNamespace

from game.game_room import GameRoom
from game.vector import Vector2

from ..conftest import SpawnSnakeAt


def test_add_human_player_spawns_a_snake(game_room: GameRoom) -> None:
    player = game_room.add_human_player("p1", "Alice")
    assert player.snake is not None
    assert player.snake.alive


def test_add_ai_players_spawns_the_requested_count(game_room: GameRoom) -> None:
    game_room.add_ai_players(3)
    bots = [p for p in game_room.players.all() if p.player_type == "ai"]
    assert len(bots) == 3
    assert all(p.snake is not None for p in bots)


def test_remove_player(game_room: GameRoom, spawn_snake_at: SpawnSnakeAt) -> None:
    spawn_snake_at("p1", 100, 100)
    game_room.remove_player("p1")
    assert game_room.players.get("p1") is None


def test_respawn_player_creates_a_fresh_snake(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    player = spawn_snake_at("p1", 100, 100)
    old_snake_id = player.snake.id  # type: ignore[union-attr]
    game_room.respawn_player("p1")
    assert player.snake is not None
    assert player.snake.id != old_snake_id


def test_debug_teleport_moves_snake_to_exact_position(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    spawn_snake_at("p1", 50, 50)
    game_room.debug_teleport("p1", 10, 20)
    player = game_room.players.get("p1")
    assert player is not None and player.snake is not None
    assert player.snake.points == [Vector2(10, 20)]


def test_debug_set_invulnerable_prevents_boundary_death(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    player = spawn_snake_at("p1", 0, 150, direction=0.0)
    game_room.debug_set_invulnerable("p1", True)
    game_room.tick(1 / 30)
    assert player.snake is not None
    assert player.snake.alive


def test_debug_set_bot_count_adds_and_removes_bots(game_room: GameRoom) -> None:
    game_room.debug_set_bot_count(3)
    assert len([p for p in game_room.players.all() if p.player_type == "ai"]) == 3
    game_room.debug_set_bot_count(1)
    assert len([p for p in game_room.players.all() if p.player_type == "ai"]) == 1


def test_spike_zone_death_margin_exact_boundary(
    game_room: GameRoom, test_config: SimpleNamespace, spawn_snake_at: SpawnSnakeAt
) -> None:
    margin = test_config.SPIKE_ZONE_DEPTH + test_config.SNAKE_RADIUS

    # Far apart in y so the two snakes don't also trigger snake-vs-snake collision.
    alive_player = spawn_snake_at("alive", margin + 1, 50)
    dead_player = spawn_snake_at("dead", margin - 1, 250)

    game_room.tick(0.0)  # dt=0 so movement doesn't shift the test positions

    assert alive_player.snake is not None and alive_player.snake.alive
    # A dead human player's snake is cleared entirely, not left "dead but attached".
    assert dead_player.snake is None


def test_snake_vs_snake_collision_kills_the_colliding_snake(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    victim = spawn_snake_at("victim", 150, 150)
    blocker = spawn_snake_at("blocker", 151, 150)  # well within collision radius

    game_room.tick(0.0)

    assert victim.snake is None
    assert blocker.snake is None


def test_eating_food_grows_snake_and_removes_food(
    game_room: GameRoom, test_config: SimpleNamespace, spawn_snake_at: SpawnSnakeAt
) -> None:
    player = spawn_snake_at("p1", 150, 150)
    food = game_room.food_manager.spawn_at(Vector2(150, 150), value=20.0, score_value=1)

    game_room.tick(0.0)

    assert player.snake is not None
    assert player.snake.score == 1
    assert food.id not in game_room.food_manager.foods


def test_ensure_min_food_refills_after_despawn(
    game_room: GameRoom, test_config: SimpleNamespace
) -> None:
    food = next(iter(game_room.food_manager.foods.values()))
    game_room.tick(food.remaining_life + 1.0)
    assert len(game_room.food_manager.foods) == test_config.FOOD_COUNT_TARGET


def test_food_magnet_pulls_food_toward_nearest_snake(
    game_room: GameRoom, test_config: SimpleNamespace, spawn_snake_at: SpawnSnakeAt
) -> None:
    spawn_snake_at("p1", 150, 150)
    food = game_room.food_manager.spawn_at(Vector2(190, 150), value=1.0)

    distance_before = food.position.distance_to(Vector2(150, 150))
    game_room.tick(1 / 30)
    distance_after = food.position.distance_to(Vector2(150, 150))

    assert distance_after < distance_before


def test_food_outside_magnet_radius_is_unaffected(
    game_room: GameRoom, test_config: SimpleNamespace, spawn_snake_at: SpawnSnakeAt
) -> None:
    spawn_snake_at("p1", 0, 0)
    far_position = Vector2(0 + test_config.FOOD_MAGNET_RADIUS + 50, 0)
    food = game_room.food_manager.spawn_at(far_position, value=1.0)

    game_room.tick(1 / 30)

    assert food.position == far_position


def test_death_drop_consolidation_respects_max_gap(
    game_room: GameRoom, test_config: SimpleNamespace
) -> None:
    player = game_room.add_human_player("p1")
    assert player.snake is not None
    snake = player.snake
    snake.points = [Vector2(i * 3, 0) for i in range(150)]
    before_ids = set(game_room.food_manager.foods)

    game_room._drop_food_from_snake(snake)

    dropped = [f for fid, f in game_room.food_manager.foods.items() if fid not in before_ids]
    assert len(dropped) > 0
    dropped_sorted = sorted(dropped, key=lambda f: f.position.x)
    for a, b in zip(dropped_sorted, dropped_sorted[1:], strict=False):
        assert a.position.distance_to(b.position) <= test_config.FOOD_MAX_CONSOLIDATE_GAP

    # The trail should mix tiers rather than being uniform throughout.
    tiers_seen = {f.score_value for f in dropped}
    assert len(tiers_seen) > 1


def test_dead_human_player_generates_a_game_over_event_and_clears_snake(
    game_room: GameRoom, test_config: SimpleNamespace
) -> None:
    margin = test_config.SPIKE_ZONE_DEPTH + test_config.SNAKE_RADIUS
    player = game_room.add_human_player("p1")
    assert player.snake is not None
    player.snake.points = [Vector2(margin - 1, 150)]
    player.snake.score = 7

    events = game_room.tick(0.0)

    assert ("p1", 7) in events
    assert player.snake is None


def test_dead_ai_player_respawns_instead_of_ending_the_game(game_room: GameRoom) -> None:
    game_room.add_ai_players(1)
    bot_player = next(p for p in game_room.players.all() if p.player_type == "ai")
    assert bot_player.snake is not None
    old_snake_id = bot_player.snake.id
    bot_player.snake.points = [Vector2(-100, -100)]  # force out-of-bounds death

    events = game_room.tick(0.0)

    assert events == []
    assert bot_player.snake is not None
    assert bot_player.snake.id != old_snake_id


def test_serialize_state_contains_snakes_and_food(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    spawn_snake_at("p1", 150, 150)
    state = game_room.serialize_state()
    assert state["type"] == "state"
    assert len(state["snakes"]) == 1  # type: ignore[arg-type]
    assert len(state["food"]) >= 1  # type: ignore[arg-type]
