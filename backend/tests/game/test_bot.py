import math
from types import SimpleNamespace

from game.board import Board
from game.bot import Bot, DecisionContext
from game.food import Food
from game.snake import Snake
from game.vector import Vector2


def bot_config() -> SimpleNamespace:
    return SimpleNamespace(
        BOT_LOOKAHEAD=60.0,
        BOT_DANGER_MARGIN=10.0,
        BOT_AVOID_TURN=math.pi / 2,
        BOT_SIGHT_RADIUS=350.0,
        BOT_WANDER_TICKS=20,
    )


def snake_config() -> SimpleNamespace:
    return SimpleNamespace(
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
    )


def make_snake(pos: Vector2, direction: float = 0.0) -> Snake:
    return Snake("id1", "p1", "Test", "#fff", "solid", pos, direction, snake_config())


def test_avoids_danger_when_lookahead_is_out_of_bounds() -> None:
    bot = Bot(bot_config())
    board = Board(width=100, height=100)
    # Heading straight into the right wall from near the edge.
    snake = make_snake(Vector2(95, 50), direction=0.0)
    context = DecisionContext(board=board, foods=[], other_snakes=[])

    result = bot.decide(snake, context)

    assert result == snake.direction + bot_config().BOT_AVOID_TURN


def test_avoids_danger_when_another_snake_is_ahead() -> None:
    bot = Bot(bot_config())
    board = Board(width=1000, height=1000)
    snake = make_snake(Vector2(500, 500), direction=0.0)
    other = make_snake(Vector2(560, 500))  # sits right in the lookahead path
    context = DecisionContext(board=board, foods=[], other_snakes=[other])

    result = bot.decide(snake, context)

    assert result == snake.direction + bot_config().BOT_AVOID_TURN


def test_seeks_nearest_food_within_sight_when_no_danger() -> None:
    bot = Bot(bot_config())
    board = Board(width=1000, height=1000)
    snake = make_snake(Vector2(500, 500))
    near_food = Food(id="near", position=Vector2(520, 500))
    far_food = Food(id="far", position=Vector2(800, 500))
    context = DecisionContext(board=board, foods=[far_food, near_food], other_snakes=[])

    result = bot.decide(snake, context)

    assert result == snake.head().angle_to(near_food.position)


def test_ignores_food_outside_sight_radius() -> None:
    bot = Bot(bot_config())
    board = Board(width=2000, height=2000)
    snake = make_snake(Vector2(1000, 1000))
    far_food = Food(id="far", position=Vector2(1000 + 351, 1000))
    context = DecisionContext(board=board, foods=[far_food], other_snakes=[])

    result = bot.decide(snake, context)

    # No food in range and no danger -> falls back to the wander branch,
    # which starts out equal to the bot's initial random wander angle.
    assert result == bot._wander_angle


def test_wander_angle_is_stable_until_timer_expires() -> None:
    bot = Bot(bot_config())
    board = Board(width=2000, height=2000)
    snake = make_snake(Vector2(1000, 1000))
    context = DecisionContext(board=board, foods=[], other_snakes=[])

    first = bot.decide(snake, context)
    second = bot.decide(snake, context)

    assert first == second
