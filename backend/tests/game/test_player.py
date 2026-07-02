from game.board import Board
from game.bot import Bot, DecisionContext
from game.player import AIPlayer, HumanPlayer, PlayerManager


def _empty_context() -> DecisionContext:
    return DecisionContext(board=Board(width=100, height=100), foods=[], other_snakes=[])


def test_human_player_set_direction_is_returned_via_get_input_direction() -> None:
    player = HumanPlayer("p1", "Alice")
    assert player.get_input_direction(_empty_context()) is None
    player.set_direction(1.23)
    assert player.get_input_direction(_empty_context()) == 1.23


def test_human_player_defaults() -> None:
    player = HumanPlayer("p1")
    assert player.player_type == "human"
    assert player.name == "Player"
    assert player.snake is None


def test_ai_player_defaults() -> None:
    bot = Bot(config=_FakeBotConfig())
    player = AIPlayer("bot1", "KI1234", bot)
    assert player.player_type == "ai"
    assert player.bot is bot


def test_player_manager_add_and_get_human() -> None:
    manager = PlayerManager()
    player = manager.add_human("p1", "Alice")
    assert manager.get("p1") is player
    assert player in manager.all()


def test_player_manager_add_and_get_ai() -> None:
    manager = PlayerManager()
    bot = Bot(config=_FakeBotConfig())
    player = manager.add_ai("bot1", "KI1234", bot)
    assert manager.get("bot1") is player


def test_player_manager_remove() -> None:
    manager = PlayerManager()
    manager.add_human("p1")
    manager.remove("p1")
    assert manager.get("p1") is None


def test_player_manager_remove_unknown_is_a_no_op() -> None:
    manager = PlayerManager()
    manager.remove("does-not-exist")  # should not raise


def test_player_manager_get_unknown_returns_none() -> None:
    manager = PlayerManager()
    assert manager.get("does-not-exist") is None


def test_player_manager_all_returns_every_player() -> None:
    manager = PlayerManager()
    human = manager.add_human("p1")
    bot_player = manager.add_ai("bot1", "KI1234", Bot(config=_FakeBotConfig()))
    assert set(manager.all()) == {human, bot_player}


def test_unique_name_returns_name_unchanged_when_no_collision() -> None:
    manager = PlayerManager()
    manager.add_human("p1", "Bob")
    assert manager.unique_name("Alice") == "Alice"


def test_unique_name_appends_suffix_on_single_collision() -> None:
    manager = PlayerManager()
    manager.add_human("p1", "Alice")
    assert manager.unique_name("Alice") == "Alice (2)"


def test_unique_name_increments_suffix_until_free() -> None:
    manager = PlayerManager()
    manager.add_human("p1", "Alice")
    manager.add_human("p2", "Alice (2)")
    assert manager.unique_name("Alice") == "Alice (3)"


class _FakeBotConfig:
    BOT_FAN_HALF_ANGLE = 2.5
    BOT_RAY_LENGTH = 95.0
    BOT_RAY_SAMPLES = 4
    BOT_DANGER_MARGIN = 12.0
    BOT_BODY_SAMPLE_STEP = 4
    BOT_SELF_SKIP_SEGMENTS = 6
    BOT_WANDER_TICKS = 25
    BOT_WANDER_DRIFT = 0.7
    BOT_FORWARD_BIAS = 0.35
    BOT_ATTACK_RANGE = 260.0
    BOT_ATTACK_LEAD = 45.0
    BOT_DASH_FLEE_DANGER = 0.5
    BOT_DASH_FLEE_MAX = 0.9
    BOT_DASH_ATTACK_RANGE = 150.0
    BOT_DASH_ATTACK_ALIGN = 0.4
    SPIKE_ZONE_DEPTH = 14.0
    BOT_EASY_SIGHT = 240.0
    BOT_EASY_DANGER_WEIGHT = 2.5
    BOT_EASY_FOOD_WEIGHT = 0.8
    BOT_EASY_AGGRESSION = 0.0
    BOT_EASY_WANDER_WEIGHT = 0.6
    BOT_EASY_NOISE = 0.5
    BOT_EASY_CANDIDATES = 7
    BOT_EASY_REACT_TICKS = 6
    BOT_MED_SIGHT = 350.0
    BOT_MED_DANGER_WEIGHT = 4.0
    BOT_MED_FOOD_WEIGHT = 1.0
    BOT_MED_AGGRESSION = 0.5
    BOT_MED_WANDER_WEIGHT = 0.3
    BOT_MED_NOISE = 0.15
    BOT_MED_CANDIDATES = 11
    BOT_MED_REACT_TICKS = 3
    BOT_HARD_SIGHT = 460.0
    BOT_HARD_DANGER_WEIGHT = 6.0
    BOT_HARD_FOOD_WEIGHT = 1.1
    BOT_HARD_AGGRESSION = 1.3
    BOT_HARD_WANDER_WEIGHT = 0.15
    BOT_HARD_NOISE = 0.0
    BOT_HARD_CANDIDATES = 15
    BOT_HARD_REACT_TICKS = 1
