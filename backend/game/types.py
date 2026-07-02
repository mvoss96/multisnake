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
    FOOD_LIFETIME_SECONDS: float
    FOOD_COUNT_TARGET: int


class SnakeConfig(Protocol):
    SNAKE_SPEED: float
    SNAKE_RADIUS: float
    SNAKE_MAX_RADIUS: float
    RADIUS_GROWTH_RATE: float
    SNAKE_START_LENGTH: int
    SEGMENT_SPACING: float
    MAX_SNAKE_LENGTH: float
    DASH_DURATION: float
    DASH_SPEED_MULTIPLIER: float
    DASH_RECHARGE_SECONDS: float
    DASH_CHARGE_PER_FOOD: float
    SCORE_MULTIPLIER: int
    SCORE_AT_MAX_LENGTH: int


class BotConfig(Protocol):
    # Gemeinsame Fächer-/Gefahr-/Aggressions-/Dash-Bausteine (siehe game/bot.py).
    BOT_FAN_HALF_ANGLE: float
    BOT_RAY_LENGTH: float
    BOT_RAY_SAMPLES: int
    BOT_DANGER_MARGIN: float
    BOT_BODY_SAMPLE_STEP: int
    BOT_SELF_SKIP_SEGMENTS: int
    BOT_WANDER_TICKS: int
    BOT_WANDER_DRIFT: float
    BOT_FORWARD_BIAS: float
    BOT_ATTACK_RANGE: float
    BOT_ATTACK_LEAD: float
    BOT_DASH_FLEE_DANGER: float
    BOT_DASH_FLEE_MAX: float
    BOT_DASH_ATTACK_RANGE: float
    BOT_DASH_ATTACK_ALIGN: float
    SPIKE_ZONE_DEPTH: float
    # Schwierigkeits-Profile.
    BOT_EASY_SIGHT: float
    BOT_EASY_DANGER_WEIGHT: float
    BOT_EASY_FOOD_WEIGHT: float
    BOT_EASY_AGGRESSION: float
    BOT_EASY_WANDER_WEIGHT: float
    BOT_EASY_NOISE: float
    BOT_EASY_CANDIDATES: int
    BOT_EASY_REACT_TICKS: int
    BOT_MED_SIGHT: float
    BOT_MED_DANGER_WEIGHT: float
    BOT_MED_FOOD_WEIGHT: float
    BOT_MED_AGGRESSION: float
    BOT_MED_WANDER_WEIGHT: float
    BOT_MED_NOISE: float
    BOT_MED_CANDIDATES: int
    BOT_MED_REACT_TICKS: int
    BOT_HARD_SIGHT: float
    BOT_HARD_DANGER_WEIGHT: float
    BOT_HARD_FOOD_WEIGHT: float
    BOT_HARD_AGGRESSION: float
    BOT_HARD_WANDER_WEIGHT: float
    BOT_HARD_NOISE: float
    BOT_HARD_CANDIDATES: int
    BOT_HARD_REACT_TICKS: int


class GameConfig(FoodConfig, SnakeConfig, BotConfig, Protocol):
    """Union of every module's config needs, plus attributes only GameRoom itself reads."""

    BOARD_WIDTH: float
    BOARD_HEIGHT: float
    MAX_TURN_RATE: float
    NUM_BOTS: int
    SPIKE_ZONE_DEPTH: float
    # Auswahlgewichte (easy, medium, hard) für die Bot-Profile - nur GameRoom liest sie.
    BOT_SKILL_WEIGHTS: tuple[int, int, int]
    FOOD_RADIUS: float
    FOOD_MEDIUM_RADIUS: float
    FOOD_BIG_RADIUS: float
    FOOD_DROP_SAMPLE_STEP: int
    FOOD_MAX_CONSOLIDATE_GAP: float
    FOOD_MAGNET_RADIUS: float
    FOOD_MAGNET_SPEED: float
    GRID_CELL_SIZE: float
    OBSTACLE_COUNT: int
    OBSTACLE_MIN_RADIUS: float
    OBSTACLE_MAX_RADIUS: float
    OBSTACLE_BORDER_MARGIN: float
    OBSTACLE_GAP: float
    OBSTACLE_SPAWN_CLEARANCE: float
