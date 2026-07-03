import math
import random
import uuid

from .board import Board
from .bot import BOT_SKILLS, SKILL_LABELS, Bot, DecisionContext
from .food import Food, FoodManager
from .obstacle import Obstacle
from .player import AIPlayer, HumanPlayer, Player, PlayerManager
from .protocol import FoodState, SnakeState, StateMessage
from .snake import Snake
from .spatial_grid import SpatialGrid
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
        # Hindernisse zuerst (deterministisch), dann Futter/Bots - beide meiden sie.
        self.obstacles = self._generate_obstacles()
        self.food_manager.ensure_min_food(self.board, self.obstacles)
        self._rebalance_bots()
        self.paused = False

    def _generate_obstacles(self) -> list[Obstacle]:
        # Statische Felsen geseedet platzieren: ganz im Feld (Rand-Abstand), nicht
        # überlappend (Lücke dazwischen). Best-effort: passt nicht alles rein (kleines
        # Board), werden eben weniger - kein Endlosversuch.
        obstacles: list[Obstacle] = []
        margin = self.config.OBSTACLE_BORDER_MARGIN
        gap = self.config.OBSTACLE_GAP
        attempts = 0
        max_attempts = self.config.OBSTACLE_COUNT * 30
        while len(obstacles) < self.config.OBSTACLE_COUNT and attempts < max_attempts:
            attempts += 1
            radius = self._rng.uniform(
                self.config.OBSTACLE_MIN_RADIUS, self.config.OBSTACLE_MAX_RADIUS
            )
            lo_x, hi_x = margin + radius, self.board.width - margin - radius
            lo_y, hi_y = margin + radius, self.board.height - margin - radius
            if lo_x >= hi_x or lo_y >= hi_y:
                break  # Board zu klein für diesen Radius
            pos = Vector2(self._rng.uniform(lo_x, hi_x), self._rng.uniform(lo_y, hi_y))
            if all(pos.distance_to(o.position) > radius + o.radius + gap for o in obstacles):
                obstacles.append(Obstacle(pos, radius))
        return obstacles

    def _find_safe_spawn_point(self) -> Vector2:
        other_points = [
            point
            for other_player in self.players.all()
            if other_player.snake and other_player.snake.alive
            for point in other_player.snake.points
        ]
        clearance = self.config.OBSTACLE_SPAWN_CLEARANCE
        for _ in range(20):
            candidate = self.board.random_point(margin=100)
            if all(candidate.distance_to(p) > 150 for p in other_points) and all(
                candidate.distance_to(o.position) > o.radius + clearance for o in self.obstacles
            ):
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
            # Gemischte Schwierigkeit: Profil pro Bot gewichtet ziehen (self._rng
            # ist in Tests seedbar). Bot bekommt denselben RNG für deterministische Tests.
            skill = self._rng.choices(BOT_SKILLS, weights=self.config.BOT_SKILL_WEIGHTS)[0]
            bot = Bot(self.config, skill, self._rng)
            # Name spiegelt die Schwierigkeit wider (siehe SKILL_LABELS in bot.py).
            name = self.players.unique_name(f"{SKILL_LABELS[skill]}{self._rng.randint(100, 999)}")
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
            self.food_manager.spawn_at(mid_point, score_value=count)
            i += count

    def _apply_food_magnet(self, alive_snakes: list[Snake], dt: float) -> None:
        radius = self.config.FOOD_MAGNET_RADIUS
        speed = self.config.FOOD_MAGNET_SPEED
        # Broad-Phase: Snake-Köpfe ins Grid; pro Food nur die Köpfe im Magnet-Radius
        # abfragen statt aller Snakes. Köpfe bewegen sich hier nicht (nur Food wird
        # bewegt), daher ist die eingefügte Position == aktueller Kopf.
        head_grid: SpatialGrid[Snake] = SpatialGrid(self.config.GRID_CELL_SIZE)
        for s in alive_snakes:
            head_grid.insert(s.head(), s)
        for food in self.food_manager.foods.values():
            nearest_head = None
            nearest_dist = radius
            for _pos, snake in head_grid.query(food.position, radius):
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

    def _collision_survivor(self, a: Snake, b: Snake) -> Snake:
        """Bei einer gegenseitigen Kollision überlebt die 'größere' Snake: höherer
        Score, bei Gleichstand der längere Körper, dann per Zufall - so gewinnt bei
        Kopf-an-Kopf die stärkere, und bei exaktem Gleichstand entscheidet der Zufall
        (statt einer systematischen Bevorzugung)."""
        if a.score != b.score:
            return a if a.score > b.score else b
        if len(a.points) != len(b.points):
            return a if len(a.points) > len(b.points) else b
        return self._rng.choice([a, b])

    def _resolve_snake_collisions(
        self, all_players: list[Player], head_hits: dict[str, set[str]]
    ) -> None:
        """Wertet die gesammelten Kopf-Treffer aus und tötet die betroffenen Snakes -
        mit der Garantie, dass bei einer GEGENSEITIGEN Kollision (A trifft B und B
        trifft A, z.B. Kopf an Kopf) niemals beide sterben: dort überlebt der Gewinner
        aus _collision_survivor, nur der Verlierer stirbt."""
        snakes_by_id = {p.snake.id: p.snake for p in all_players if p.snake}
        to_die = set(head_hits.keys())
        for a_id, hits in head_hits.items():
            for b_id in hits:
                if b_id <= a_id:
                    continue  # jedes ungeordnete Paar nur einmal betrachten
                if a_id not in head_hits.get(b_id, frozenset()):
                    continue  # nicht gegenseitig -> A ist einseitig reingefahren, stirbt
                if a_id in to_die and b_id in to_die:
                    survivor = self._collision_survivor(snakes_by_id[a_id], snakes_by_id[b_id])
                    to_die.discard(survivor.id)
        for sid in to_die:
            snakes_by_id[sid].alive = False

    def tick(self, dt: float) -> list[tuple[str, int]]:
        self.tick_count += 1
        self.food_manager.tick(dt)
        all_players = self.players.all()
        alive_snakes = [p.snake for p in all_players if p.snake and p.snake.alive]

        # foods-Liste einmal bilden und teilen; den teuren AI-Kontext (other_snakes)
        # nur für Bots bauen. Menschen ignorieren den Kontext ohnehin
        # (HumanPlayer.get_input_direction), bekommen also einen geteilten Leer-Kontext.
        foods_list = list(self.food_manager.foods.values())
        human_ctx: DecisionContext = {
            "board": self.board,
            "foods": foods_list,
            "other_snakes": [],
            "obstacles": self.obstacles,
        }
        for player in all_players:
            snake = player.snake
            if not snake or not snake.alive:
                continue
            if isinstance(player, AIPlayer):
                context: DecisionContext = {
                    "board": self.board,
                    "foods": foods_list,
                    "other_snakes": [s for s in alive_snakes if s.id != snake.id],
                    "obstacles": self.obstacles,
                }
                # Bot direkt entscheiden lassen, damit auch die Dash-Absicht ankommt
                # (das Player-Interface get_input_direction liefert nur die Richtung).
                decision = player.bot.decide(snake, context)
                snake.set_desired_direction(decision.direction)
                if decision.dash:
                    snake.try_dash()
            else:
                angle = player.get_input_direction(human_ctx)
                if angle is not None:
                    snake.set_desired_direction(angle)
            snake.move(dt, self.config.MAX_TURN_RATE)

        self._apply_food_magnet(alive_snakes, dt)

        # Broad-Phase für die Snake-vs-Snake-Kollision: alle Körperpunkte der zu
        # Tick-Beginn lebenden Snakes ins Grid. Bewusst aus `alive_snakes` (nicht
        # neu gefiltert), damit eine in diesem Tick bereits gestorbene Snake weiterhin
        # als Hindernis zählt - exakt wie im vorherigen All-Pairs-Loop.
        body_grid: SpatialGrid[Snake] = SpatialGrid(self.config.GRID_CELL_SIZE)
        for s in alive_snakes:
            for p in s.points:
                body_grid.insert(p, s)

        # Snake-vs-Snake-Kollisionen werden erst GESAMMELT (welcher Kopf berührt den
        # Körper welcher fremden Snake) und danach in _resolve_snake_collisions
        # aufgelöst - so kann garantiert werden, dass bei einer gegenseitigen
        # (Kopf-an-Kopf-)Kollision NIE beide sterben. Wand-/Felsen-Tode bleiben sofort.
        head_hits: dict[str, set[str]] = {}
        for player in all_players:
            snake = player.snake
            if not snake or not snake.alive:
                continue
            if snake.invulnerable:
                # Unverwundbar (Debug): stirbt nicht - wird aber an Hindernissen
                # BLOCKIERT statt durchzugehen. Auch der KARTENRAND ist ein Hindernis:
                # der Kopf wird in den sicheren Bereich (genau an die Todeslinie,
                # margin = Spike-Tiefe + Radius) geklemmt, sodass die Schlange am Rand
                # stehen bleibt. Andere Schlangen ignoriert sie weiterhin.
                margin = self.config.SPIKE_ZONE_DEPTH + snake.radius
                h = snake.head()
                cx = min(max(h.x, margin), self.board.width - margin)
                cy = min(max(h.y, margin), self.board.height - margin)
                if cx != h.x or cy != h.y:
                    snake.points[0] = Vector2(cx, cy)
                # Ragt der Kopf in einen Fels, wird er auf dessen Oberfläche zurückgeschoben.
                for o in self.obstacles:
                    h = snake.head()
                    d = h.distance_to(o.position)
                    min_d = snake.radius + o.radius
                    if 0.0 < d < min_d:
                        nx = (h.x - o.position.x) / d
                        ny = (h.y - o.position.y) / d
                        snake.points[0] = Vector2(
                            o.position.x + nx * min_d, o.position.y + ny * min_d
                        )
                continue
            head = snake.head()
            death_margin = self.config.SPIKE_ZONE_DEPTH + snake.radius
            if self.board.is_out_of_bounds(head, margin=death_margin):
                snake.alive = False
                continue
            # Statische Felsen (wenige -> simple Iteration): Kopf im Fels = Tod.
            if any(head.distance_to(o.position) < snake.radius + o.radius for o in self.obstacles):
                snake.alive = False
                continue
            # reach deckt den größtmöglichen other.radius ab, damit das Grid keinen
            # echten Treffer verpasst; der exakte Check bleibt dahinter identisch.
            reach = snake.radius + self.config.SNAKE_MAX_RADIUS
            hits = {
                other.id
                for point, other in body_grid.query(head, reach)
                if other.id != snake.id and head.distance_to(point) < snake.radius + other.radius
            }
            if hits:
                head_hits[snake.id] = hits

        self._resolve_snake_collisions(all_players, head_hits)

        # Broad-Phase: alle Food-Positionen einmal ins Grid, pro Kopf nur nahe Foods.
        # Das Grid wird vor der Schleife gebaut und währenddessen NICHT verändert -
        # das Entfernen passiert erst danach über eaten_ids. Bewusst KEIN Dedup:
        # erreichen zwei Köpfe dasselbe Food im selben Tick, wächst jede Snake
        # (zwei grow()), das idempotente remove() räumt danach einmal auf.
        food_grid: SpatialGrid[Food] = SpatialGrid(self.config.GRID_CELL_SIZE)
        for f in self.food_manager.foods.values():
            food_grid.insert(f.position, f)

        eaten_ids = []
        for player in all_players:
            snake = player.snake
            if not snake or not snake.alive:
                continue
            head = snake.head()
            reach = snake.radius + self.config.FOOD_BIG_RADIUS
            for _pos, food in food_grid.query(head, reach):
                if head.distance_to(food.position) < snake.radius + self._food_radius(food):
                    snake.grow(score_value=food.score_value)
                    eaten_ids.append(food.id)
        for food_id in eaten_ids:
            self.food_manager.remove(food_id)
        self.food_manager.ensure_min_food(self.board, self.obstacles)

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
                    length=round(snake.target_length, 1),
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
