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
        RADIUS_GROWTH_RATE=1.0,
        SNAKE_START_LENGTH=10,
        SEGMENT_SPACING=8.0,
        MAX_SNAKE_LENGTH=480.0,
        DASH_DURATION=0.9,
        DASH_SPEED_MULTIPLIER=2.2,
        DASH_RECHARGE_SECONDS=6.0,
        DASH_CHARGE_PER_FOOD=0.1,
        SCORE_MULTIPLIER=1,
        SCORE_AT_MAX_LENGTH=100,
        FOOD_COUNT_TARGET=1,
        FOOD_RADIUS=5.0,
        FOOD_MEDIUM_RADIUS=7.0,
        FOOD_BIG_RADIUS=9.0,
        FOOD_LIFETIME_SECONDS=25.0,
        FOOD_DROP_SAMPLE_STEP=2,
        FOOD_MEDIUM_VALUE_MULTIPLIER=2,
        FOOD_BIG_VALUE_MULTIPLIER=5,
        FOOD_MAX_CONSOLIDATE_GAP=30.0,
        FOOD_MEDIUM_SPAWN_CHANCE=0.2,
        FOOD_BIG_SPAWN_CHANCE=0.04,
        FOOD_MAGNET_RADIUS=60.0,
        FOOD_MAGNET_SPEED=260.0,
        GRID_CELL_SIZE=40.0,
        BOT_FAN_HALF_ANGLE=2.5,
        BOT_RAY_LENGTH=95.0,
        BOT_RAY_SAMPLES=4,
        BOT_DANGER_MARGIN=12.0,
        BOT_BODY_SAMPLE_STEP=4,
        BOT_SELF_SKIP_SEGMENTS=6,
        BOT_WANDER_TICKS=25,
        BOT_WANDER_DRIFT=0.7,
        BOT_FORWARD_BIAS=0.35,
        BOT_ATTACK_RANGE=260.0,
        BOT_ATTACK_LEAD=45.0,
        BOT_DASH_FLEE_DANGER=0.5,
        BOT_DASH_FLEE_MAX=0.9,
        BOT_DASH_ATTACK_RANGE=150.0,
        BOT_DASH_ATTACK_ALIGN=0.4,
        BOT_EASY_SIGHT=240.0,
        BOT_EASY_DANGER_WEIGHT=2.5,
        BOT_EASY_FOOD_WEIGHT=0.8,
        BOT_EASY_AGGRESSION=0.0,
        BOT_EASY_WANDER_WEIGHT=0.6,
        BOT_EASY_NOISE=0.5,
        BOT_EASY_CANDIDATES=7,
        BOT_EASY_REACT_TICKS=6,
        BOT_MED_SIGHT=350.0,
        BOT_MED_DANGER_WEIGHT=4.0,
        BOT_MED_FOOD_WEIGHT=1.0,
        BOT_MED_AGGRESSION=0.5,
        BOT_MED_WANDER_WEIGHT=0.3,
        BOT_MED_NOISE=0.15,
        BOT_MED_CANDIDATES=11,
        BOT_MED_REACT_TICKS=3,
        BOT_HARD_SIGHT=460.0,
        BOT_HARD_DANGER_WEIGHT=6.0,
        BOT_HARD_FOOD_WEIGHT=1.1,
        BOT_HARD_AGGRESSION=1.3,
        BOT_HARD_WANDER_WEIGHT=0.15,
        BOT_HARD_NOISE=0.0,
        BOT_HARD_CANDIDATES=15,
        BOT_HARD_REACT_TICKS=1,
        BOT_SKILL_WEIGHTS=(2, 3, 2),
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
