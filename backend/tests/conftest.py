from types import SimpleNamespace
from typing import Protocol

import pytest

from game.game_room import GameRoom
from game.player import HumanPlayer
from game.vector import Vector2


class SpawnSnakeAt(Protocol):
    def __call__(
        self, player_id: str, x: float, y: float, direction: float = 0.0
    ) -> HumanPlayer: ...


@pytest.fixture
def test_config() -> SimpleNamespace:
    """Small, deterministic-friendly config so tests don't depend on production tuning values."""
    return SimpleNamespace(
        BOARD_WIDTH=300.0,
        BOARD_HEIGHT=300.0,
        MAX_TURN_RATE=4.4,
        NUM_BOTS=0,
        SPIKE_ZONE_DEPTH=14.0,
        SNAKE_SPEED=90.0,
        SNAKE_RADIUS=7.0,
        SNAKE_MAX_RADIUS=14.0,
        SNAKE_START_LENGTH=10,
        SEGMENT_SPACING=8.0,
        MAX_SNAKE_LENGTH=480.0,
        DASH_DURATION=0.9,
        DASH_SPEED_MULTIPLIER=2.2,
        DASH_RECHARGE_SECONDS=6.0,
        DASH_CHARGE_PER_FOOD=0.1,
        SCORE_MULTIPLIER=1,
        FOOD_COUNT_TARGET=1,
        FOOD_RADIUS=5.0,
        FOOD_MEDIUM_RADIUS=7.0,
        FOOD_BIG_RADIUS=9.0,
        FOOD_GROWTH_VALUE=12.0,
        FOOD_LIFETIME_SECONDS=25.0,
        FOOD_DROP_SAMPLE_STEP=2,
        FOOD_MEDIUM_VALUE_MULTIPLIER=2,
        FOOD_BIG_VALUE_MULTIPLIER=5,
        FOOD_MAX_CONSOLIDATE_GAP=30.0,
        FOOD_MEDIUM_SPAWN_CHANCE=0.2,
        FOOD_BIG_SPAWN_CHANCE=0.04,
        FOOD_MAGNET_RADIUS=60.0,
        FOOD_MAGNET_SPEED=260.0,
        BOT_SIGHT_RADIUS=350.0,
        BOT_LOOKAHEAD=60.0,
        BOT_DANGER_MARGIN=10.0,
        BOT_AVOID_TURN=1.57,
        BOT_WANDER_TICKS=20,
    )


@pytest.fixture
def game_room(test_config: SimpleNamespace) -> GameRoom:
    return GameRoom(test_config)


@pytest.fixture
def spawn_snake_at(game_room: GameRoom) -> SpawnSnakeAt:
    """Add a human player and place their snake at an exact position/heading,
    bypassing the randomized `_find_safe_spawn_point`."""

    def _spawn(player_id: str, x: float, y: float, direction: float = 0.0) -> HumanPlayer:
        player = game_room.add_human_player(player_id)
        assert player.snake is not None
        player.snake.points = [Vector2(x, y)]
        player.snake.direction = direction
        player.snake.desired_direction = direction
        return player

    return _spawn
