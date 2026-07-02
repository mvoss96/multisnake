import math
import random
from types import SimpleNamespace

from game.board import Board
from game.bot import Bot, DecisionContext
from game.food import Food
from game.obstacle import Obstacle
from game.snake import Snake
from game.vector import Vector2


def bot_config() -> SimpleNamespace:
    # Testwerte, nicht die Produktionswerte: med/hard sind hier bewusst rauschfrei
    # (noise=0, wander_weight=0) und reagieren jeden Tick (react=1), damit
    # Entscheidungen deterministisch und gut prüfbar sind. easy behält Rauschen
    # für den Imperfektions-Test.
    return SimpleNamespace(
        BOT_FAN_HALF_ANGLE=2.5,
        BOT_RAY_LENGTH=95.0,
        BOT_RAY_SAMPLES=4,
        BOT_DANGER_MARGIN=12.0,
        BOT_BODY_SAMPLE_STEP=2,
        BOT_SELF_SKIP_SEGMENTS=3,
        BOT_WANDER_TICKS=20,
        BOT_WANDER_DRIFT=0.6,
        BOT_FORWARD_BIAS=0.35,
        BOT_ATTACK_RANGE=260.0,
        BOT_ATTACK_LEAD=45.0,
        BOT_DASH_FLEE_DANGER=0.5,
        BOT_DASH_FLEE_MAX=0.9,
        BOT_DASH_ATTACK_RANGE=150.0,
        BOT_DASH_ATTACK_ALIGN=0.4,
        SPIKE_ZONE_DEPTH=14.0,
        BOT_EASY_SIGHT=240.0,
        BOT_EASY_DANGER_WEIGHT=2.5,
        BOT_EASY_FOOD_WEIGHT=0.8,
        BOT_EASY_AGGRESSION=0.0,
        BOT_EASY_WANDER_WEIGHT=0.6,
        BOT_EASY_NOISE=0.5,
        BOT_EASY_CANDIDATES=7,
        BOT_EASY_REACT_TICKS=1,
        BOT_MED_SIGHT=350.0,
        BOT_MED_DANGER_WEIGHT=4.0,
        BOT_MED_FOOD_WEIGHT=1.0,
        BOT_MED_AGGRESSION=0.5,
        BOT_MED_WANDER_WEIGHT=0.0,
        BOT_MED_NOISE=0.0,
        BOT_MED_CANDIDATES=11,
        BOT_MED_REACT_TICKS=1,
        BOT_HARD_SIGHT=460.0,
        BOT_HARD_DANGER_WEIGHT=6.0,
        BOT_HARD_FOOD_WEIGHT=1.1,
        BOT_HARD_AGGRESSION=1.3,
        BOT_HARD_WANDER_WEIGHT=0.0,
        BOT_HARD_NOISE=0.0,
        BOT_HARD_CANDIDATES=15,
        BOT_HARD_REACT_TICKS=1,
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


def make_bot(skill: str = "hard", seed: int = 0) -> Bot:
    return Bot(bot_config(), skill, random.Random(seed))  # type: ignore[arg-type]


def _ray_point(head: Vector2, angle: float, length: float) -> Vector2:
    return Vector2(head.x + math.cos(angle) * length, head.y + math.sin(angle) * length)


def test_steers_away_from_wall_instead_of_into_it() -> None:
    cfg = bot_config()
    bot = make_bot("hard")
    board = Board(width=1000, height=1000)
    # Kopf dicht an der rechten Wand, Kurs geradewegs hinein.
    snake = make_snake(Vector2(975, 500), direction=0.0)
    context = DecisionContext(board=board, foods=[], other_snakes=[], obstacles=[])

    result = bot.decide(snake, context)

    wall_margin = cfg.SPIKE_ZONE_DEPTH + snake.radius
    # Geradeaus wäre tödlich, die gewählte Richtung bleibt im Feld.
    assert board.is_out_of_bounds(
        _ray_point(snake.head(), 0.0, cfg.BOT_RAY_LENGTH), margin=wall_margin
    )
    chosen = _ray_point(snake.head(), result.direction, cfg.BOT_RAY_LENGTH)
    assert not board.is_out_of_bounds(chosen, margin=wall_margin)
    assert result.direction != snake.direction


def test_steers_around_snake_ahead() -> None:
    cfg = bot_config()
    bot = make_bot("hard")
    board = Board(width=1000, height=1000)
    snake = make_snake(Vector2(500, 500), direction=0.0)
    other = make_snake(Vector2(560, 500))
    other.points = [Vector2(560, 500)]  # sitzt direkt im geraden Kurs
    context = DecisionContext(board=board, foods=[], other_snakes=[other], obstacles=[])

    result = bot.decide(snake, context)

    # Die gewählte Richtung hält Abstand zur fremden Körperzelle.
    chosen = _ray_point(snake.head(), result.direction, cfg.BOT_RAY_LENGTH)
    safe = snake.radius + other.radius + cfg.BOT_DANGER_MARGIN
    assert chosen.distance_to(Vector2(560, 500)) >= safe
    assert result.direction != snake.direction


def test_avoids_own_body_ahead() -> None:
    cfg = bot_config()
    bot = make_bot("hard")
    board = Board(width=1000, height=1000)
    snake = make_snake(Vector2(500, 500), direction=0.0)
    # Enge Windung: ein hinteres Segment liegt direkt voraus (jenseits der
    # übersprungenen Hals-Segmente), geradeaus liefe der Bot hinein.
    snake.points = [Vector2(500, 500)] + [Vector2(505, 500)] * 4 + [Vector2(555, 500)]
    context = DecisionContext(board=board, foods=[], other_snakes=[], obstacles=[])

    result = bot.decide(snake, context)

    chosen = _ray_point(snake.head(), result.direction, cfg.BOT_RAY_LENGTH)
    assert chosen.distance_to(Vector2(555, 500)) >= snake.radius
    assert result.direction != 0.0


def test_prefers_higher_value_food_over_nearer_low_value() -> None:
    bot = make_bot("hard")
    board = Board(width=2000, height=2000)
    # Kurs zeigt zum billigen Stück; das wertvolle liegt quer dazu, aber näher
    # gewichtet (value/dist). Der Bot soll trotzdem zum wertvollen steuern.
    snake = make_snake(Vector2(1000, 1000), direction=math.pi / 2)
    cheap = Food(id="cheap", position=Vector2(1000, 1100), score_value=1)  # Richtung +y
    rich = Food(id="rich", position=Vector2(1120, 1000), score_value=5)  # Richtung +x
    context = DecisionContext(board=board, foods=[cheap, rich], other_snakes=[], obstacles=[])

    result = bot.decide(snake, context)

    # +x-Komponente überwiegt +y -> Kurs zum wertvollen Stück, nicht zum billigen.
    assert math.cos(result.direction) > math.sin(result.direction)


def test_dash_flee_when_boxed_in_with_charge() -> None:
    bot = make_bot("medium")
    snake = make_snake(Vector2(500, 500))
    snake.dash_charge = 1.0
    # Gefahr im Fluchtbereich [0.5, 0.9) -> flüchten.
    assert bot._should_dash(snake, best_angle=0.0, best_danger=0.6, attack=None) is True
    # Über der Obergrenze (quasi-sichere Wand direkt voraus) -> kein Dash.
    assert bot._should_dash(snake, best_angle=0.0, best_danger=0.95, attack=None) is False
    # Ohne volle Ladung kein Dash.
    snake.dash_charge = 0.5
    assert bot._should_dash(snake, best_angle=0.0, best_danger=0.6, attack=None) is False


def test_easy_bot_never_dashes() -> None:
    bot = make_bot("easy")
    snake = make_snake(Vector2(500, 500))
    snake.dash_charge = 1.0
    assert bot._should_dash(snake, best_angle=0.0, best_danger=0.7, attack=None) is False


def test_hard_bot_targets_and_dashes_at_prey() -> None:
    bot = make_bot("hard")
    snake = make_snake(Vector2(500, 500))
    snake.dash_charge = 1.0
    prey = make_snake(Vector2(560, 500), direction=0.0)

    attack = bot._attack_target(snake, [prey])
    assert attack is not None
    intercept_dir, dist = attack
    assert dist == snake.head().distance_to(prey.head())
    # Abfangpunkt liegt vor dem Beute-Kopf (in +x), Richtung entsprechend ~0.
    assert abs(intercept_dir) < 0.2
    # Ausgerichtet und in Reichweite -> Angriffs-Dash.
    assert bot._should_dash(snake, best_angle=intercept_dir, best_danger=0.1, attack=attack) is True


def test_medium_bot_does_not_attack_dash() -> None:
    bot = make_bot("medium")
    snake = make_snake(Vector2(500, 500))
    snake.dash_charge = 1.0
    # Medium hat kein aggression-Ziel und dasht nicht offensiv (Gefahr unter Fluchtschwelle).
    assert bot._attack_target(snake, [make_snake(Vector2(560, 500))]) is not None
    assert bot._should_dash(snake, best_angle=0.0, best_danger=0.1, attack=(0.0, 60.0)) is False


def test_easy_bot_has_no_attack_target() -> None:
    bot = make_bot("easy")
    snake = make_snake(Vector2(500, 500))
    assert bot._attack_target(snake, [make_snake(Vector2(560, 500))]) is None


def test_decisions_are_deterministic_for_equal_seed() -> None:
    board = Board(width=1000, height=1000)
    context = DecisionContext(
        board=board,
        foods=[Food(id="f", position=Vector2(600, 540))],
        other_snakes=[],
        obstacles=[],
    )

    a = make_bot("easy", seed=42)
    b = make_bot("easy", seed=42)
    first = a.decide(make_snake(Vector2(500, 500)), context)
    second = b.decide(make_snake(Vector2(500, 500)), context)

    assert first == second


def test_steers_around_obstacle_ahead() -> None:
    cfg = bot_config()
    bot = make_bot("hard")
    board = Board(width=1000, height=1000)
    snake = make_snake(Vector2(500, 500), direction=0.0)
    rock = Obstacle(Vector2(560, 500), radius=25)  # direkt im geraden Kurs
    context = DecisionContext(board=board, foods=[], other_snakes=[], obstacles=[rock])

    result = bot.decide(snake, context)

    chosen = _ray_point(snake.head(), result.direction, cfg.BOT_RAY_LENGTH)
    safe = snake.radius + rock.radius + cfg.BOT_DANGER_MARGIN
    assert chosen.distance_to(rock.position) >= safe
    assert result.direction != snake.direction
