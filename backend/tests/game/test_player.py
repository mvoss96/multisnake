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
    BOT_LOOKAHEAD = 60.0
    BOT_DANGER_MARGIN = 10.0
    BOT_AVOID_TURN = 1.57
    BOT_SIGHT_RADIUS = 350.0
    BOT_WANDER_TICKS = 20
