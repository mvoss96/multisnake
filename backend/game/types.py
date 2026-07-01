"""Shared structural types.

`config.py` is used throughout the codebase as a plain module passed around
as an object (e.g. `Snake.__init__(self, ..., config)`). These `Protocol`s
type that usage pattern instead of `types.ModuleType`, so mypy can check
which attributes each consumer actually relies on without requiring
`config.py` to become a class/dataclass. Split per consumer (rather than one
big protocol) so a minimal fake config in a test only needs to satisfy the
attributes that particular module actually reads.
"""

from typing import Protocol


class FoodConfig(Protocol):
    FOOD_BIG_SPAWN_CHANCE: float
    FOOD_MEDIUM_SPAWN_CHANCE: float
    FOOD_BIG_VALUE_MULTIPLIER: int
    FOOD_MEDIUM_VALUE_MULTIPLIER: int
    FOOD_GROWTH_VALUE: float
    FOOD_LIFETIME_SECONDS: float
    FOOD_COUNT_TARGET: int


class SnakeConfig(Protocol):
    SNAKE_SPEED: float
    SNAKE_RADIUS: float
    SNAKE_START_LENGTH: int
    SEGMENT_SPACING: float
    MAX_SNAKE_LENGTH: float
    DASH_DURATION: float
    DASH_SPEED_MULTIPLIER: float
    DASH_RECHARGE_SECONDS: float
    DASH_CHARGE_PER_FOOD: float


class BotConfig(Protocol):
    BOT_LOOKAHEAD: float
    BOT_DANGER_MARGIN: float
    BOT_AVOID_TURN: float
    BOT_SIGHT_RADIUS: float
    BOT_WANDER_TICKS: int


class GameConfig(FoodConfig, SnakeConfig, BotConfig, Protocol):
    """Union of every module's config needs, plus attributes only GameRoom itself reads."""

    BOARD_WIDTH: float
    BOARD_HEIGHT: float
    MAX_TURN_RATE: float
    NUM_BOTS: int
    SPIKE_ZONE_DEPTH: float
    FOOD_RADIUS: float
    FOOD_MEDIUM_RADIUS: float
    FOOD_BIG_RADIUS: float
    FOOD_DROP_SAMPLE_STEP: int
    FOOD_MAX_CONSOLIDATE_GAP: float
    FOOD_MAGNET_RADIUS: float
    FOOD_MAGNET_SPEED: float
