import math
import random
import uuid

from .board import Board
from .bot import Bot, DecisionContext
from .food import Food, FoodManager
from .player import HumanPlayer, Player, PlayerManager
from .protocol import FoodState, SnakeState, StateMessage
from .snake import Snake
from .types import GameConfig
from .vector import Vector2

# Reds (#e94560, #fc5c65) are excluded: reserved for food/spikes in the frontend renderer.
_COLORS = [
    "#0f9b8e",
    "#f7b731",
    "#4b7bec",
    "#a55eea",
    "#26de81",
    "#fd9644",
    "#45aaf2",
    "#2bcbba",
]

# Rein optisch, siehe frontend/js/renderer.js für die jeweilige Zeichenlogik.
_PATTERNS = ["solid", "stripes", "dots"]


class GameRoom:
    def __init__(self, config: GameConfig) -> None:
        self.config = config
        self.board = Board(config.BOARD_WIDTH, config.BOARD_HEIGHT)
        self.food_manager = FoodManager(config)
        self.players = PlayerManager()
        self.tick_count = 0
        self._rng = random.Random()
        self.food_manager.ensure_min_food(self.board)
        self._rebalance_bots()
        self.paused = False

    def _find_safe_spawn_point(self) -> Vector2:
        other_points = [
            point
            for other_player in self.players.all()
            if other_player.snake and other_player.snake.alive
            for point in other_player.snake.points
        ]
        for _ in range(20):
            candidate = self.board.random_point(margin=100)
            if all(candidate.distance_to(p) > 150 for p in other_points):
                return candidate
        return self.board.random_point(margin=100)

    def _color_for(self, player: Player) -> str:
        if player.color is None:
            used = {p.color for p in self.players.all() if p.color}
            available = [c for c in _COLORS if c not in used]
            player.color = self._rng.choice(available or _COLORS)
        return player.color

    def _pattern_for(self, player: Player) -> str:
        if player.pattern is None:
            player.pattern = self._rng.choice(_PATTERNS)
        return player.pattern

    def _spawn_snake_for(self, player: Player) -> Snake:
        pos = self._find_safe_spawn_point()
        direction = self._rng.uniform(0, 2 * math.pi)
        snake = Snake(
            str(uuid.uuid4()),
            player.player_id,
            player.name,
            self._color_for(player),
            self._pattern_for(player),
            pos,
            direction,
            self.config,
        )
        player.snake = snake
        return snake

    def add_human_player(self, player_id: str, name: str = "Player") -> HumanPlayer:
        player = self.players.add_human(player_id, self.players.unique_name(name))
        self._spawn_snake_for(player)
        self._rebalance_bots()
        return player

    def add_ai_players(self, count: int) -> None:
        for _ in range(count):
            player_id = f"bot-{uuid.uuid4()}"
            bot = Bot(self.config)
            name = self.players.unique_name(f"KI{self._rng.randint(1000, 9999)}")
            player = self.players.add_ai(player_id, name, bot)
            self._spawn_snake_for(player)

    def remove_player(self, player_id: str) -> None:
        player = self.players.get(player_id)
        was_human = player is not None and player.player_type == "human"
        self.players.remove(player_id)
        if was_human:
            self._rebalance_bots()

    def _rebalance_bots(self) -> None:
        human_count = len([p for p in self.players.all() if p.player_type == "human"])
        target_bots = max(0, self.config.NUM_BOTS - human_count)
        self._set_bot_count(target_bots)

    def respawn_player(self, player_id: str) -> None:
        player = self.players.get(player_id)
        if player:
            self._spawn_snake_for(player)

    # --- Debug-Steuerung -------------------------------------------------

    def set_paused(self, paused: bool) -> None:
        self.paused = paused

    def debug_teleport(self, player_id: str, x: float, y: float) -> None:
        player = self.players.get(player_id)
        if player and player.snake:
            player.snake.points = [Vector2(x, y)]

    def debug_respawn_at(self, player_id: str, x: float, y: float) -> None:
        player = self.players.get(player_id)
        if not player:
            return
        direction = self._rng.uniform(0, 2 * math.pi)
        snake = Snake(
            str(uuid.uuid4()),
            player.player_id,
            player.name,
            self._color_for(player),
            self._pattern_for(player),
            Vector2(x, y),
            direction,
            self.config,
        )
        player.snake = snake

    def debug_set_invulnerable(self, player_id: str, enabled: bool) -> None:
        player = self.players.get(player_id)
        if player and player.snake:
            player.snake.invulnerable = enabled

    def debug_set_bot_count(self, count: int) -> None:
        self._set_bot_count(count)

    def _set_bot_count(self, count: int) -> None:
        bots = [p for p in self.players.all() if p.player_type == "ai"]
        if count > len(bots):
            self.add_ai_players(count - len(bots))
        elif count < len(bots):
            for player in bots[: len(bots) - count]:
                self.players.remove(player.player_id)

    def _food_radius(self, food: Food) -> float:
        if food.score_value >= self.config.FOOD_BIG_VALUE_MULTIPLIER:
            return self.config.FOOD_BIG_RADIUS
        if food.score_value >= self.config.FOOD_MEDIUM_VALUE_MULTIPLIER:
            return self.config.FOOD_MEDIUM_RADIUS
        return self.config.FOOD_RADIUS

    def _drop_food_from_snake(self, snake: Snake) -> None:
        step = self.config.FOOD_DROP_SAMPLE_STEP
        max_gap = self.config.FOOD_MAX_CONSOLIDATE_GAP
        drop_points = snake.points[::step]
        tiers = [self.config.FOOD_BIG_VALUE_MULTIPLIER, self.config.FOOD_MEDIUM_VALUE_MULTIPLIER, 1]
        tier_weights = {
            self.config.FOOD_BIG_VALUE_MULTIPLIER: 1,
            self.config.FOOD_MEDIUM_VALUE_MULTIPLIER: 2,
            1: 3,
        }

        i = 0
        n = len(drop_points)
        while i < n:
            # A tier is only usable if its merged points stay within max_gap of
            # each other, otherwise it would leave a visible hole in the trail.
            # Among the usable tiers pick randomly (weighted towards smaller ones)
            # so a trail mixes 1er/2er/5er instead of being uniform throughout.
            feasible = [
                tier
                for tier in tiers
                if i + tier <= n
                and (tier == 1 or drop_points[i].distance_to(drop_points[i + tier - 1]) <= max_gap)
            ]
            count = self._rng.choices(feasible, weights=[tier_weights[t] for t in feasible])[0]
            chunk = drop_points[i : i + count]
            mid_point = chunk[len(chunk) // 2]
            self.food_manager.spawn_at(
                mid_point, self.config.FOOD_GROWTH_VALUE * count, score_value=count
            )
            i += count

    def _apply_food_magnet(self, alive_snakes: list[Snake], dt: float) -> None:
        radius = self.config.FOOD_MAGNET_RADIUS
        speed = self.config.FOOD_MAGNET_SPEED
        for food in self.food_manager.foods.values():
            nearest_head = None
            nearest_dist = radius
            for snake in alive_snakes:
                d = snake.head().distance_to(food.position)
                if d < nearest_dist:
                    nearest_dist = d
                    nearest_head = snake.head()
            if nearest_head is None or nearest_dist < 1e-6:
                continue
            pull = min(speed * dt, nearest_dist)
            dx = (nearest_head.x - food.position.x) / nearest_dist
            dy = (nearest_head.y - food.position.y) / nearest_dist
            food.position = Vector2(food.position.x + dx * pull, food.position.y + dy * pull)

    def tick(self, dt: float) -> list[tuple[str, int]]:
        self.tick_count += 1
        self.food_manager.tick(dt)
        all_players = self.players.all()
        alive_snakes = [p.snake for p in all_players if p.snake and p.snake.alive]

        for player in all_players:
            snake = player.snake
            if not snake or not snake.alive:
                continue
            context: DecisionContext = {
                "board": self.board,
                "foods": list(self.food_manager.foods.values()),
                "other_snakes": [s for s in alive_snakes if s.id != snake.id],
            }
            angle = player.get_input_direction(context)
            if angle is not None:
                snake.set_desired_direction(angle)
            snake.move(dt, self.config.MAX_TURN_RATE)

        self._apply_food_magnet(alive_snakes, dt)

        for player in all_players:
            snake = player.snake
            if not snake or not snake.alive:
                continue
            if snake.invulnerable:
                continue
            head = snake.head()
            death_margin = self.config.SPIKE_ZONE_DEPTH + snake.radius
            if self.board.is_out_of_bounds(head, margin=death_margin):
                snake.alive = False
                continue
            for other in alive_snakes:
                if other.id == snake.id:
                    continue
                for point in other.points:
                    if head.distance_to(point) < snake.radius + other.radius:
                        snake.alive = False
                        break
                if not snake.alive:
                    break

        eaten_ids = []
        for player in all_players:
            snake = player.snake
            if not snake or not snake.alive:
                continue
            head = snake.head()
            for food in list(self.food_manager.foods.values()):
                if head.distance_to(food.position) < snake.radius + self._food_radius(food):
                    snake.grow(food.value, score_value=food.score_value)
                    eaten_ids.append(food.id)
        for food_id in eaten_ids:
            self.food_manager.remove(food_id)
        self.food_manager.ensure_min_food(self.board)

        game_over_events: list[tuple[str, int]] = []
        for player in all_players:
            snake = player.snake
            if snake and not snake.alive:
                self._drop_food_from_snake(snake)
                if player.player_type == "ai":
                    self._spawn_snake_for(player)
                else:
                    game_over_events.append((player.player_id, snake.score))
                    player.snake = None

        return game_over_events

    def serialize_state(self) -> StateMessage:
        snakes_data = []
        for player in self.players.all():
            snake = player.snake
            if not snake:
                continue
            snakes_data.append(
                SnakeState(
                    id=snake.id,
                    player_id=player.player_id,
                    name=player.name,
                    color=snake.color,
                    pattern=snake.pattern,
                    radius=snake.radius,
                    score=snake.score,
                    direction=snake.direction,
                    points=[[round(p.x, 1), round(p.y, 1)] for p in snake.points],
                    dash_charge=round(snake.dash_charge, 3),
                    dashing=snake.dash_time_remaining > 0,
                    invulnerable=snake.invulnerable,
                )
            )
        foods_data = [
            FoodState(
                id=food.id,
                x=round(food.position.x, 1),
                y=round(food.position.y, 1),
                value=food.score_value,
                life=round(max(0.0, food.remaining_life / food.max_life), 3),
            )
            for food in self.food_manager.foods.values()
        ]
        return StateMessage(
            tick=self.tick_count,
            snakes=snakes_data,
            food=foods_data,
            paused=self.paused,
        )
