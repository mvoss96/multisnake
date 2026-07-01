import math
from types import SimpleNamespace

import pytest

from game.snake import Snake
from game.vector import Vector2


@pytest.fixture
def config() -> SimpleNamespace:
    return SimpleNamespace(
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
    )


def make_snake(config: SimpleNamespace, pos: Vector2 | None = None) -> Snake:
    return Snake("id1", "p1", "Test", "#fff", "solid", pos or Vector2(0, 0), 0.0, config)


def test_new_snake_starts_fully_charged_and_not_dashing(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    assert snake.dash_charge == 1.0
    assert snake.dash_time_remaining == 0.0


def test_try_dash_succeeds_when_fully_charged(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    assert snake.try_dash() is True
    assert snake.dash_charge == 0.0
    assert snake.dash_time_remaining == config.DASH_DURATION


def test_try_dash_fails_while_on_cooldown(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    snake.try_dash()
    assert snake.try_dash() is False


def test_move_during_dash_uses_speed_multiplier(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    snake.try_dash()
    dt = 1 / 30
    before = snake.head()
    snake.move(dt, max_turn_rate=math.pi)
    after = snake.head()
    dashed_distance = before.distance_to(after)
    expected = config.SNAKE_SPEED * config.DASH_SPEED_MULTIPLIER * dt
    assert dashed_distance == pytest.approx(expected)


def test_move_without_dash_uses_normal_speed(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    dt = 1 / 30
    before = snake.head()
    snake.move(dt, max_turn_rate=math.pi)
    after = snake.head()
    assert before.distance_to(after) == pytest.approx(config.SNAKE_SPEED * dt)


def test_dash_charge_recharges_over_time_after_cooldown_ends(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    snake.try_dash()
    # Dash duration and recharge are evaluated in separate move() calls: the
    # tick that ends the dash (dash_time_remaining hits 0) does not itself
    # recharge yet - recharge only accrues once a *subsequent* tick starts
    # with dash_time_remaining already at 0.
    snake.move(config.DASH_DURATION + 0.001, max_turn_rate=math.pi)
    assert snake.dash_charge == 0.0
    snake.move(1.0, max_turn_rate=math.pi)
    assert 0.0 < snake.dash_charge < 1.0


def test_dash_charge_fully_recharges_after_enough_time(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    snake.try_dash()
    dt = 1 / 30
    ticks = int((config.DASH_DURATION + config.DASH_RECHARGE_SECONDS) / dt) + 5
    for _ in range(ticks):
        snake.move(dt, max_turn_rate=math.pi)
    assert snake.dash_charge == 1.0
    assert snake.try_dash() is True


def test_grow_increases_target_length_and_score(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    initial_length = snake.target_length
    snake.grow(amount=16.0, score_value=2)
    assert snake.target_length == initial_length + 16.0
    assert snake.score == 2


def test_grow_never_exceeds_max_length(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    snake.grow(amount=10_000.0)
    assert snake.target_length == config.MAX_SNAKE_LENGTH


def test_score_is_scaled_by_score_multiplier_independent_of_growth(
    config: SimpleNamespace,
) -> None:
    scaled_config = SimpleNamespace(**{**vars(config), "SCORE_MULTIPLIER": 8})
    snake = make_snake(scaled_config)
    initial_length = snake.target_length

    snake.grow(amount=16.0, score_value=2)

    assert snake.score == 2 * 8  # Score skaliert, Wachstum bleibt unverändert
    assert snake.target_length == initial_length + 16.0


def test_new_snake_starts_at_the_minimum_radius(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    assert snake.radius == config.SNAKE_RADIUS


def test_grow_increases_radius_toward_the_maximum(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    initial_radius = snake.radius
    snake.grow(amount=100.0)
    assert snake.radius > initial_radius
    assert snake.radius < config.SNAKE_MAX_RADIUS


def test_grow_radius_reaches_maximum_at_max_length(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    snake.grow(amount=10_000.0)
    assert snake.target_length == config.MAX_SNAKE_LENGTH
    assert snake.radius == config.SNAKE_MAX_RADIUS


def test_grow_also_charges_dash_scaled_by_score_value(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    snake.dash_charge = 0.0  # not currently dashing, just depleted
    snake.grow(amount=1.0, score_value=2)
    assert snake.dash_charge == pytest.approx(config.DASH_CHARGE_PER_FOOD * 2)


def test_grow_dash_charge_never_exceeds_one(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    snake.dash_charge = 0.0
    snake.grow(amount=1.0, score_value=100)
    assert snake.dash_charge == 1.0


def test_grow_does_not_charge_dash_while_dashing(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    snake.try_dash()  # dash_charge -> 0.0, dash_time_remaining -> DASH_DURATION
    snake.grow(amount=1.0, score_value=100)
    assert snake.dash_charge == 0.0


def test_trim_keeps_points_within_target_length(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    snake.target_length = 10.0
    dt = 1 / 30
    for _ in range(60):
        snake.move(dt, max_turn_rate=math.pi)
    total = sum(
        snake.points[i].distance_to(snake.points[i + 1]) for i in range(len(snake.points) - 1)
    )
    assert total <= snake.target_length + config.SNAKE_SPEED * dt


def test_set_desired_direction_is_approached_gradually(config: SimpleNamespace) -> None:
    snake = make_snake(config)
    # pi/2 (not pi) avoids the ambiguous exact-180-degree case, where turning
    # left vs. right is a coin flip of the modulo arithmetic.
    snake.set_desired_direction(math.pi / 2)
    snake.move(1 / 30, max_turn_rate=1.0)
    assert 0.0 < snake.direction < math.pi / 2
