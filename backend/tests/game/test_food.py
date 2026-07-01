from types import SimpleNamespace

import pytest

from game.board import Board
from game.food import FoodManager
from game.vector import Vector2


@pytest.fixture
def config() -> SimpleNamespace:
    return SimpleNamespace(
        FOOD_BIG_SPAWN_CHANCE=0.0,
        FOOD_MEDIUM_SPAWN_CHANCE=0.0,
        FOOD_BIG_VALUE_MULTIPLIER=5,
        FOOD_MEDIUM_VALUE_MULTIPLIER=2,
        FOOD_LIFETIME_SECONDS=25.0,
        FOOD_COUNT_TARGET=3,
    )


def test_spawn_at_creates_food_with_full_lifetime(config: SimpleNamespace) -> None:
    manager = FoodManager(config)
    food = manager.spawn_at(Vector2(1, 2), score_value=1)
    assert food.id in manager.foods
    assert food.position == Vector2(1, 2)
    assert food.remaining_life == config.FOOD_LIFETIME_SECONDS
    assert food.max_life == config.FOOD_LIFETIME_SECONDS


def test_spawn_random_defaults_to_small_tier_when_chances_are_zero(
    config: SimpleNamespace,
) -> None:
    manager = FoodManager(config)
    board = Board(width=100, height=100)
    food = manager.spawn_random(board)
    assert food.score_value == 1


def test_spawn_random_always_picks_big_tier_when_chance_is_certain(
    config: SimpleNamespace,
) -> None:
    config.FOOD_BIG_SPAWN_CHANCE = 1.0
    manager = FoodManager(config)
    board = Board(width=100, height=100)
    food = manager.spawn_random(board)
    assert food.score_value == config.FOOD_BIG_VALUE_MULTIPLIER


def test_ensure_min_food_tops_up_to_target(config: SimpleNamespace) -> None:
    manager = FoodManager(config)
    board = Board(width=100, height=100)
    manager.ensure_min_food(board)
    assert len(manager.foods) == config.FOOD_COUNT_TARGET


def test_ensure_min_food_does_not_overshoot_target(config: SimpleNamespace) -> None:
    manager = FoodManager(config)
    board = Board(width=100, height=100)
    manager.ensure_min_food(board)
    manager.ensure_min_food(board)
    assert len(manager.foods) == config.FOOD_COUNT_TARGET


def test_remove_deletes_existing_food(config: SimpleNamespace) -> None:
    manager = FoodManager(config)
    food = manager.spawn_at(Vector2(0, 0))
    manager.remove(food.id)
    assert food.id not in manager.foods


def test_remove_unknown_id_is_a_no_op(config: SimpleNamespace) -> None:
    manager = FoodManager(config)
    manager.remove("does-not-exist")  # should not raise


def test_tick_expires_food_once_lifetime_elapses(config: SimpleNamespace) -> None:
    manager = FoodManager(config)
    food = manager.spawn_at(Vector2(0, 0))
    manager.tick(config.FOOD_LIFETIME_SECONDS - 0.01)
    assert food.id in manager.foods
    manager.tick(0.02)
    assert food.id not in manager.foods


def test_tick_decrements_remaining_life(config: SimpleNamespace) -> None:
    manager = FoodManager(config)
    food = manager.spawn_at(Vector2(0, 0))
    manager.tick(1.0)
    assert food.remaining_life == pytest.approx(config.FOOD_LIFETIME_SECONDS - 1.0)
