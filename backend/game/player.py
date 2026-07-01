class Player:
    def __init__(self, player_id, player_type, name):
        self.player_id = player_id
        self.player_type = player_type
        self.name = name
        self.snake = None

    def get_input_direction(self, context):
        raise NotImplementedError


class HumanPlayer(Player):
    def __init__(self, player_id, name="Player"):
        super().__init__(player_id, "human", name)
        self._direction = None

    def set_direction(self, angle):
        self._direction = angle

    def get_input_direction(self, context):
        return self._direction


class AIPlayer(Player):
    def __init__(self, player_id, name, bot):
        super().__init__(player_id, "ai", name)
        self.bot = bot

    def get_input_direction(self, context):
        return self.bot.decide(self.snake, context)


class PlayerManager:
    def __init__(self):
        self.players = {}

    def add_human(self, player_id, name="Player"):
        player = HumanPlayer(player_id, name)
        self.players[player_id] = player
        return player

    def add_ai(self, player_id, name, bot):
        player = AIPlayer(player_id, name, bot)
        self.players[player_id] = player
        return player

    def remove(self, player_id):
        self.players.pop(player_id, None)

    def get(self, player_id):
        return self.players.get(player_id)

    def all(self):
        return list(self.players.values())
