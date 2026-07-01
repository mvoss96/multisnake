"""Shared structural types.

`config.py` is used throughout the codebase as a plain module passed around
as an object (e.g. `Snake.__init__(self, ..., config)`). `GameConfig` types
that usage pattern via a `Protocol` instead of `types.ModuleType`, so mypy can
check which attributes each consumer actually relies on without requiring
`config.py` to become a class/dataclass. Grows incrementally as more modules
are typed - each consumer only needs the attributes it reads.
"""

from typing import Protocol


class GameConfig(Protocol):
    FOOD_BIG_SPAWN_CHANCE: float
    FOOD_MEDIUM_SPAWN_CHANCE: float
    FOOD_BIG_VALUE_MULTIPLIER: int
    FOOD_MEDIUM_VALUE_MULTIPLIER: int
    FOOD_GROWTH_VALUE: float
    FOOD_LIFETIME_SECONDS: float
    FOOD_COUNT_TARGET: int
