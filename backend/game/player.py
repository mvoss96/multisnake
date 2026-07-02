from .bot import Bot, DecisionContext
from .snake import Snake


class Player:
    def __init__(self, player_id: str, player_type: str, name: str) -> None:
        self.player_id = player_id
        self.player_type = player_type
        self.name = name
        self.snake: Snake | None = None
        self.color: str | None = None
        self.pattern: str | None = None

    def get_input_direction(self, context: DecisionContext) -> float | None:
        raise NotImplementedError


class HumanPlayer(Player):
    def __init__(self, player_id: str, name: str = "Player") -> None:
        super().__init__(player_id, "human", name)
        self._direction: float | None = None

    def set_direction(self, angle: float) -> None:
        self._direction = angle

    def get_input_direction(self, context: DecisionContext) -> float | None:
        return self._direction


class AIPlayer(Player):
    def __init__(self, player_id: str, name: str, bot: Bot) -> None:
        super().__init__(player_id, "ai", name)
        self.bot = bot

    def get_input_direction(self, context: DecisionContext) -> float | None:
        # Player-Interface (Richtung); die Dash-Absicht der Entscheidung wird davon
        # nicht transportiert - GameRoom.tick() ruft bot.decide() direkt auf und
        # löst den Dash über snake.try_dash() aus (siehe game_room.py).
        assert self.snake is not None
        return self.bot.decide(self.snake, context).direction


class PlayerManager:
    def __init__(self) -> None:
        self.players: dict[str, Player] = {}

    def add_human(self, player_id: str, name: str = "Player") -> HumanPlayer:
        player = HumanPlayer(player_id, name)
        self.players[player_id] = player
        return player

    def add_ai(self, player_id: str, name: str, bot: Bot) -> AIPlayer:
        player = AIPlayer(player_id, name, bot)
        self.players[player_id] = player
        return player

    def remove(self, player_id: str) -> None:
        self.players.pop(player_id, None)

    def get(self, player_id: str) -> Player | None:
        return self.players.get(player_id)

    def all(self) -> list[Player]:
        return list(self.players.values())

    def unique_name(self, name: str) -> str:
        existing = {p.name for p in self.players.values()}
        if name not in existing:
            return name
        n = 2
        while f"{name} ({n})" in existing:
            n += 1
        return f"{name} ({n})"
