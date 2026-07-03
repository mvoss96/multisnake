from types import SimpleNamespace

import pytest

from game.bot import SKILL_LABELS
from game.game_room import _PATTERNS, GameRoom
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


def test_invulnerable_snake_is_blocked_at_map_edge(
    game_room: GameRoom, test_config: SimpleNamespace, spawn_snake_at: SpawnSnakeAt
) -> None:
    margin = test_config.SPIKE_ZONE_DEPTH + test_config.SNAKE_RADIUS
    # Kopf in der Todeszone (jenseits der Todeslinie), aber unverwundbar.
    player = spawn_snake_at("inv", margin - 30, 200)
    assert player.snake is not None
    player.snake.invulnerable = True

    game_room.tick(0.0)  # dt=0: keine Bewegung, nur die Rand-Klemmung

    assert player.snake is not None and player.snake.alive
    # Nicht durchgegangen/gestorben: der Kopf wurde in den sicheren Bereich geklemmt.
    assert player.snake.head().x >= margin - 1e-6


def test_one_sided_collision_kills_only_the_rammer(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    # blocker's HEAD is far away, but its BODY reaches back to (150, 150); the victim
    # rams that body point. Only the rammer dies, the rammed snake survives.
    victim = spawn_snake_at("victim", 150, 150)
    blocker = spawn_snake_at("blocker", 250, 150)
    assert blocker.snake is not None
    blocker.snake.points.append(Vector2(150, 150))  # tail segment under the victim's head

    game_room.tick(0.0)

    assert victim.snake is None
    assert blocker.snake is not None and blocker.snake.alive


def test_mutual_head_on_collision_never_kills_both(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    # Two heads within the combined radius ram each other (mutual). Exactly one must
    # survive - never both dead, never both alive.
    a = spawn_snake_at("a", 150, 150)
    b = spawn_snake_at("b", 151, 150)

    game_room.tick(0.0)

    alive = [p for p in (a, b) if p.snake is not None and p.snake.alive]
    assert len(alive) == 1


def test_mutual_head_on_collision_spares_the_bigger_snake(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    # On a mutual (head-on) collision the higher-scoring snake survives, the other dies.
    small = spawn_snake_at("small", 150, 150)
    big = spawn_snake_at("big", 151, 150)
    assert small.snake is not None and big.snake is not None
    big.snake.score = 10  # bigger -> wins the head-on

    game_room.tick(0.0)

    assert small.snake is None
    assert big.snake is not None and big.snake.alive


def test_collision_near_miss_just_outside_combined_radius_survives(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    # Heads 15 apart, just past the 14-unit combined radius -> the exact check
    # behind the grid must reject it and leave both snakes alive.
    a = spawn_snake_at("a", 150, 150)
    b = spawn_snake_at("b", 165, 150)

    game_room.tick(0.0)

    assert a.snake is not None and a.snake.alive
    assert b.snake is not None and b.snake.alive


def test_eating_food_grows_snake_and_removes_food(
    game_room: GameRoom, test_config: SimpleNamespace, spawn_snake_at: SpawnSnakeAt
) -> None:
    player = spawn_snake_at("p1", 150, 150)
    food = game_room.food_manager.spawn_at(Vector2(150, 150), score_value=1)

    game_room.tick(0.0)

    assert player.snake is not None
    assert player.snake.score == 1
    assert food.id not in game_room.food_manager.foods


def test_food_just_within_eating_reach_is_eaten(
    game_room: GameRoom, test_config: SimpleNamespace, spawn_snake_at: SpawnSnakeAt
) -> None:
    # threshold = SNAKE_RADIUS + FOOD_RADIUS = 12; food 11 away is inside it.
    player = spawn_snake_at("p1", 150, 150)
    food = game_room.food_manager.spawn_at(Vector2(161, 150), score_value=1)

    game_room.tick(0.0)  # dt=0 so the magnet doesn't move the food first

    assert player.snake is not None and player.snake.score == 1
    assert food.id not in game_room.food_manager.foods


def test_food_just_outside_eating_reach_is_not_eaten(
    game_room: GameRoom, test_config: SimpleNamespace, spawn_snake_at: SpawnSnakeAt
) -> None:
    # 13 away, just past the 12-unit combined radius -> the exact check rejects it.
    player = spawn_snake_at("p1", 150, 150)
    food = game_room.food_manager.spawn_at(Vector2(163, 150), score_value=1)

    game_room.tick(0.0)

    assert player.snake is not None and player.snake.score == 0
    assert food.id in game_room.food_manager.foods


def test_food_magnet_pulls_food_toward_the_nearer_of_two_heads(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    # Both heads within the 60-unit magnet radius; food at x=130 is nearer to the
    # left head (30) than the right one (50), so it must drift left, not right.
    spawn_snake_at("near", 100, 150)
    spawn_snake_at("far", 180, 150)
    food = game_room.food_manager.spawn_at(Vector2(130, 150))

    game_room.tick(1 / 30)

    assert food.position.x < 130


def test_one_food_reached_by_two_heads_grows_both_and_is_removed_once(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    # Heads 18 apart in y (past the 14-unit collision radius, so neither dies);
    # food between them is within eating reach of both (9 < 12 each).
    a = spawn_snake_at("a", 150, 150)
    b = spawn_snake_at("b", 150, 168)
    food = game_room.food_manager.spawn_at(Vector2(150, 159), score_value=1)

    game_room.tick(0.0)

    assert a.snake is not None and a.snake.score == 1
    assert b.snake is not None and b.snake.score == 1
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
    food = game_room.food_manager.spawn_at(Vector2(190, 150))

    distance_before = food.position.distance_to(Vector2(150, 150))
    game_room.tick(1 / 30)
    distance_after = food.position.distance_to(Vector2(150, 150))

    assert distance_after < distance_before


def test_food_outside_magnet_radius_is_unaffected(
    game_room: GameRoom, test_config: SimpleNamespace, spawn_snake_at: SpawnSnakeAt
) -> None:
    spawn_snake_at("p1", 0, 0)
    far_position = Vector2(0 + test_config.FOOD_MAGNET_RADIUS + 50, 0)
    food = game_room.food_manager.spawn_at(far_position)

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
    assert state.type == "state"
    assert len(state.snakes) == 1
    assert len(state.food) >= 1


def _bot_count(room: GameRoom) -> int:
    return len([p for p in room.players.all() if p.player_type == "ai"])


def _config_with_num_bots(test_config: SimpleNamespace, num_bots: int) -> SimpleNamespace:
    return SimpleNamespace(**{**vars(test_config), "NUM_BOTS": num_bots})


def test_fresh_game_room_fills_with_bots_up_to_num_bots(test_config: SimpleNamespace) -> None:
    room = GameRoom(_config_with_num_bots(test_config, 3))
    assert _bot_count(room) == 3


def test_joining_human_displaces_exactly_one_bot(test_config: SimpleNamespace) -> None:
    room = GameRoom(_config_with_num_bots(test_config, 3))
    room.add_human_player("p1")
    assert _bot_count(room) == 2


def test_enough_humans_drive_bot_count_to_zero_not_negative(
    test_config: SimpleNamespace,
) -> None:
    room = GameRoom(_config_with_num_bots(test_config, 3))
    for i in range(5):
        room.add_human_player(f"p{i}")
    assert _bot_count(room) == 0
    assert len([p for p in room.players.all() if p.player_type == "human"]) == 5


def test_removing_a_human_refills_a_bot_even_after_prior_exhaustion(
    test_config: SimpleNamespace,
) -> None:
    room = GameRoom(_config_with_num_bots(test_config, 2))
    room.add_human_player("p1")
    room.add_human_player("p2")  # bot count hits 0
    room.remove_player("p2")
    assert _bot_count(room) == 1  # refilled

    room.add_human_player("p3")  # bot count hits 0 again
    room.remove_player("p3")
    room.remove_player("p1")
    # No latch/memory of the earlier exhaustion: rebalances back to the full NUM_BOTS.
    assert _bot_count(room) == 2


def test_debug_set_bot_count_does_not_trigger_rebalance(test_config: SimpleNamespace) -> None:
    room = GameRoom(_config_with_num_bots(test_config, 3))
    room.debug_set_bot_count(1)
    assert _bot_count(room) == 1


def test_joining_with_a_taken_human_name_gets_suffixed(game_room: GameRoom) -> None:
    game_room.add_human_player("p1", "Alice")
    player2 = game_room.add_human_player("p2", "Alice")
    assert player2.name == "Alice (2)"


def test_joining_with_a_name_matching_an_existing_bot_gets_suffixed(
    test_config: SimpleNamespace,
) -> None:
    room = GameRoom(_config_with_num_bots(test_config, 1))
    bot_name = next(p.name for p in room.players.all() if p.player_type == "ai")
    player = room.add_human_player("p1", bot_name)
    assert player.name == f"{bot_name} (2)"


def test_bot_generated_name_colliding_with_a_human_gets_suffixed(
    game_room: GameRoom, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Skill und Zufallszahl fest vorgeben, damit der generierte Bot-Name bekannt ist.
    monkeypatch.setattr(game_room._rng, "choices", lambda *a, **k: ["hard"])
    monkeypatch.setattr(game_room._rng, "randint", lambda a, b: 421)
    taken = f"{SKILL_LABELS['hard']}421"
    game_room.add_human_player("p1", taken)
    game_room.add_ai_players(1)
    bot = next(p for p in game_room.players.all() if p.player_type == "ai")
    assert bot.name == f"{taken} (2)"


def test_color_persists_across_human_respawn(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    player = spawn_snake_at("p1", 100, 100)
    assert player.snake is not None
    original_color = player.snake.color

    game_room.respawn_player("p1")

    assert player.snake is not None
    assert player.snake.color == original_color


def test_color_persists_across_bot_auto_respawn(game_room: GameRoom) -> None:
    game_room.add_ai_players(1)
    bot_player = next(p for p in game_room.players.all() if p.player_type == "ai")
    assert bot_player.snake is not None
    original_color = bot_player.snake.color
    bot_player.snake.points = [Vector2(-100, -100)]  # force out-of-bounds death

    game_room.tick(0.0)

    assert bot_player.snake is not None
    assert bot_player.snake.color == original_color


def test_color_persists_through_debug_respawn_at(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    player = spawn_snake_at("p1", 100, 100)
    assert player.snake is not None
    original_color = player.snake.color

    game_room.debug_respawn_at("p1", 50, 60)

    assert player.snake is not None
    assert player.snake.color == original_color


def test_dead_but_connected_human_keeps_color_reserved(
    test_config: SimpleNamespace,
) -> None:
    room = GameRoom(_config_with_num_bots(test_config, 0))
    margin = test_config.SPIKE_ZONE_DEPTH + test_config.SNAKE_RADIUS
    player = room.add_human_player("p1")
    assert player.snake is not None
    dead_color = player.snake.color
    player.snake.points = [Vector2(margin - 1, 150)]

    room.tick(0.0)
    assert player.snake is None  # game-over: snake cleared, player still connected

    player2 = room.add_human_player("p2")
    assert player2.snake is not None
    assert player2.snake.color != dead_color


def test_debug_set_bot_count_removal_frees_name_and_color_for_reuse(
    test_config: SimpleNamespace,
) -> None:
    room = GameRoom(_config_with_num_bots(test_config, 1))
    bot = next(p for p in room.players.all() if p.player_type == "ai")
    bot_name, bot_color = bot.name, bot.color

    room.debug_set_bot_count(0)

    assert room.players.unique_name(bot_name) == bot_name  # no longer taken
    assert all(p.color != bot_color for p in room.players.all())  # no longer reserved


def test_pattern_is_chosen_from_the_valid_set(game_room: GameRoom) -> None:
    player = game_room.add_human_player("p1")
    assert player.snake is not None
    assert player.snake.pattern in _PATTERNS


def test_pattern_persists_across_human_respawn(
    game_room: GameRoom, spawn_snake_at: SpawnSnakeAt
) -> None:
    player = spawn_snake_at("p1", 100, 100)
    assert player.snake is not None
    original_pattern = player.snake.pattern

    game_room.respawn_player("p1")

    assert player.snake is not None
    assert player.snake.pattern == original_pattern


def test_pattern_persists_across_bot_auto_respawn(game_room: GameRoom) -> None:
    game_room.add_ai_players(1)
    bot_player = next(p for p in game_room.players.all() if p.player_type == "ai")
    assert bot_player.snake is not None
    original_pattern = bot_player.snake.pattern
    bot_player.snake.points = [Vector2(-100, -100)]  # force out-of-bounds death

    game_room.tick(0.0)

    assert bot_player.snake is not None
    assert bot_player.snake.pattern == original_pattern
