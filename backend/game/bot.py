import math
import random
from dataclasses import dataclass
from typing import Literal, NamedTuple, TypedDict

from .board import Board
from .food import Food
from .obstacle import Obstacle
from .snake import Snake
from .types import BotConfig
from .vector import Vector2

BotSkill = Literal["easy", "medium", "hard"]
BOT_SKILLS: tuple[BotSkill, ...] = ("easy", "medium", "hard")
# Namens-Präfix je Schwierigkeit, damit die Leaderboard-Namen die Stärke zeigen.
SKILL_LABELS: dict[BotSkill, str] = {
    "easy": "Anfänger",
    "medium": "Jäger",
    "hard": "Raubtier",
}


class DecisionContext(TypedDict):
    board: Board
    foods: list[Food]
    other_snakes: list[Snake]
    obstacles: list[Obstacle]


class BotDecision(NamedTuple):
    direction: float
    dash: bool


@dataclass(frozen=True)
class BotProfile:
    """Verhaltensparameter eines Schwierigkeitsgrads. Aus den BOT_*-Konstanten
    (config.py) zusammengesetzt - hier leben nur die Zuordnung Skill -> Werte und
    die beiden Verhaltens-Flags (Dash zum Fliehen/Angreifen)."""

    sight: float
    danger_weight: float
    food_weight: float
    aggression: float
    wander_weight: float
    noise: float
    candidates: int
    react_ticks: int
    use_dash: bool  # Dash zum Fliehen aus Gefahr
    attack_dash: bool  # Dash zusätzlich offensiv zum Abschneiden


def _profile_for(config: BotConfig, skill: BotSkill) -> BotProfile:
    if skill == "easy":
        return BotProfile(
            sight=config.BOT_EASY_SIGHT,
            danger_weight=config.BOT_EASY_DANGER_WEIGHT,
            food_weight=config.BOT_EASY_FOOD_WEIGHT,
            aggression=config.BOT_EASY_AGGRESSION,
            wander_weight=config.BOT_EASY_WANDER_WEIGHT,
            noise=config.BOT_EASY_NOISE,
            candidates=config.BOT_EASY_CANDIDATES,
            react_ticks=config.BOT_EASY_REACT_TICKS,
            use_dash=False,
            attack_dash=False,
        )
    if skill == "hard":
        return BotProfile(
            sight=config.BOT_HARD_SIGHT,
            danger_weight=config.BOT_HARD_DANGER_WEIGHT,
            food_weight=config.BOT_HARD_FOOD_WEIGHT,
            aggression=config.BOT_HARD_AGGRESSION,
            wander_weight=config.BOT_HARD_WANDER_WEIGHT,
            noise=config.BOT_HARD_NOISE,
            candidates=config.BOT_HARD_CANDIDATES,
            react_ticks=config.BOT_HARD_REACT_TICKS,
            use_dash=True,
            attack_dash=True,
        )
    return BotProfile(
        sight=config.BOT_MED_SIGHT,
        danger_weight=config.BOT_MED_DANGER_WEIGHT,
        food_weight=config.BOT_MED_FOOD_WEIGHT,
        aggression=config.BOT_MED_AGGRESSION,
        wander_weight=config.BOT_MED_WANDER_WEIGHT,
        noise=config.BOT_MED_NOISE,
        candidates=config.BOT_MED_CANDIDATES,
        react_ticks=config.BOT_MED_REACT_TICKS,
        use_dash=True,
        attack_dash=False,
    )


class Bot:
    """Kandidaten-Bewertung: bewertet pro Entscheidung einen Fächer von
    Richtungen nach  score = wünschbarkeit (Futter/Aggression/Wandern)
    - danger_weight * gefahr  und wählt die beste. So wird nie stur in Gefahr
    gedreht, und bei Gefahr rundum die am wenigsten tödliche Richtung genommen.
    Nutzt den Dash zum Fliehen (mittel/schwer) und Angreifen (schwer)."""

    def __init__(
        self,
        config: BotConfig,
        skill: BotSkill = "medium",
        rng: random.Random | None = None,
    ) -> None:
        self.config = config
        self.skill = skill
        self.profile = _profile_for(config, skill)
        # Eigener RNG (nicht das globale random-Modul), damit Tests seeden können.
        self._rng = rng if rng is not None else random.Random()
        self._wander_angle = self._rng.uniform(0, 2 * math.pi)
        self._wander_timer = 0
        # Reaktionsträgheit: leichte/mittlere Bots entscheiden nur alle N Ticks neu
        # (billiger und menschlicher) und halten dazwischen die letzte Entscheidung.
        self._react_timer = 0
        self._last_decision = BotDecision(self._wander_angle, False)

    def decide(self, snake: Snake, context: DecisionContext) -> BotDecision:
        self._react_timer -= 1
        if self._react_timer > 0:
            return self._last_decision
        self._react_timer = self.profile.react_ticks

        board = context["board"]
        head = snake.head()

        # Wander-Zielwinkel langsam driften lassen (organische Grundbewegung ohne Ziel).
        self._wander_timer -= 1
        if self._wander_timer <= 0:
            drift = self._rng.uniform(-self.config.BOT_WANDER_DRIFT, self.config.BOT_WANDER_DRIFT)
            self._wander_angle = snake.direction + drift
            self._wander_timer = self.config.BOT_WANDER_TICKS

        obstacles = self._nearby_obstacles(snake, context)
        food_dir = self._food_direction(head, context["foods"])
        attack = self._attack_target(snake, context["other_snakes"])

        best_angle = snake.direction
        best_score = -math.inf
        best_danger = 1.0
        n = self.profile.candidates
        for i in range(n):
            frac = 0.0 if n == 1 else (i / (n - 1)) * 2 - 1  # -1..1 über den Fächer
            angle = snake.direction + frac * self.config.BOT_FAN_HALF_ANGLE
            danger = self._danger_cost(head, angle, snake.radius, board, obstacles)
            desire = self.config.BOT_FORWARD_BIAS * math.cos(angle - snake.direction)
            desire += self.profile.wander_weight * math.cos(angle - self._wander_angle)
            if food_dir is not None:
                desire += self.profile.food_weight * math.cos(angle - food_dir)
            if attack is not None:
                desire += self.profile.aggression * math.cos(angle - attack[0])
            score = desire - self.profile.danger_weight * danger
            if self.profile.noise > 0:
                score += self._rng.uniform(-self.profile.noise, self.profile.noise)
            if score > best_score:
                best_score = score
                best_angle = angle
                best_danger = danger

        dash = self._should_dash(snake, best_angle, best_danger, attack)
        self._last_decision = BotDecision(best_angle, dash)
        return self._last_decision

    # --- Hilfsmethoden ---------------------------------------------------

    def _nearby_obstacles(
        self, snake: Snake, context: DecisionContext
    ) -> list[tuple[Vector2, float]]:
        """Nur die für den Gefahr-Check wirklich relevanten Körperpunkte
        (fremde + eigene) im Umkreis eines Strahllängen-Radius um den Kopf.
        Grob abgetastet (BOT_BODY_SAMPLE_STEP) und distanzgecullt -> kleine Liste."""
        head = snake.head()
        step = self.config.BOT_BODY_SAMPLE_STEP
        near = self.config.BOT_RAY_LENGTH + self.config.BOT_DANGER_MARGIN
        obstacles: list[tuple[Vector2, float]] = []
        for other in context["other_snakes"]:
            orad = other.radius
            reach = near + snake.radius + orad
            for point in other.points[::step]:
                if head.distance_to(point) <= reach:
                    obstacles.append((point, orad))
        # Eigener Körper: die vordersten Segmente überspringen (nie erreichbar).
        reach = near + 2 * snake.radius
        for point in snake.points[self.config.BOT_SELF_SKIP_SEGMENTS :: step]:
            if head.distance_to(point) <= reach:
                obstacles.append((point, snake.radius))
        # Statische Felsen wie fremde Körper behandeln (Kopf-Kollision = Tod).
        for obs in context["obstacles"]:
            if head.distance_to(obs.position) <= near + snake.radius + obs.radius:
                obstacles.append((obs.position, obs.radius))
        return obstacles

    def _danger_cost(
        self,
        head: Vector2,
        angle: float,
        my_radius: float,
        board: Board,
        obstacles: list[tuple[Vector2, float]],
    ) -> float:
        """Todesnähe entlang der Richtung als Wert in [0, 1] (1 = quasi tödlich).
        Sampelt mehrere Punkte auf dem Strahl; nähere Samples zählen stärker."""
        direction = Vector2.from_angle(angle)
        ray_len = self.config.BOT_RAY_LENGTH
        samples = self.config.BOT_RAY_SAMPLES
        margin = self.config.BOT_DANGER_MARGIN
        wall_margin = self.config.SPIKE_ZONE_DEPTH + my_radius
        worst = 0.0
        for s in range(1, samples + 1):
            t = s / samples
            weight = 1.0 - 0.4 * (s - 1) / samples  # vordere Samples etwas wichtiger
            point = Vector2(head.x + direction.x * ray_len * t, head.y + direction.y * ray_len * t)
            if board.is_out_of_bounds(point, margin=wall_margin):
                worst = max(worst, weight)
                continue
            for obstacle, orad in obstacles:
                safe = my_radius + orad + margin
                dist = point.distance_to(obstacle)
                if dist < safe:
                    worst = max(worst, ((safe - dist) / safe) * weight)
        return worst

    def _food_direction(self, head: Vector2, foods: list[Food]) -> float | None:
        """Richtung zum wertträchtigsten erreichbaren Futter (score_value / Abstand),
        sodass große Stücke ein moderater Umweg wert sein können."""
        best: Food | None = None
        best_score = 0.0
        for food in foods:
            dist = head.distance_to(food.position)
            if dist > self.profile.sight or dist < 1e-6:
                continue
            score = food.score_value / dist
            if score > best_score:
                best_score = score
                best = food
        return head.angle_to(best.position) if best is not None else None

    def _attack_target(self, snake: Snake, others: list[Snake]) -> tuple[float, float] | None:
        """Für aggressive Profile: Richtung auf einen Abfangpunkt VOR dem Kopf der
        nächsten Gegner-Schlange (Cut-off) plus deren Abstand. None sonst."""
        if self.profile.aggression <= 0:
            return None
        head = snake.head()
        best: Snake | None = None
        best_dist = self.config.BOT_ATTACK_RANGE
        for other in others:
            dist = head.distance_to(other.head())
            if dist < best_dist:
                best_dist = dist
                best = other
        if best is None:
            return None
        lead = self.config.BOT_ATTACK_LEAD
        target_head = best.head()
        intercept = Vector2(
            target_head.x + math.cos(best.direction) * lead,
            target_head.y + math.sin(best.direction) * lead,
        )
        return head.angle_to(intercept), best_dist

    def _should_dash(
        self,
        snake: Snake,
        best_angle: float,
        best_danger: float,
        attack: tuple[float, float] | None,
    ) -> bool:
        if not self.profile.use_dash or snake.dash_charge < 1.0:
            return False
        # Flucht: sicherste Richtung ist noch spürbar gefährlich (eingekesselt/verfolgt),
        # aber kein quasi-sicherer Wand-Treffer direkt voraus.
        if self.config.BOT_DASH_FLEE_DANGER <= best_danger < self.config.BOT_DASH_FLEE_MAX:
            return True
        # Angriff (nur HARD): nah am Ziel und Kurs zeigt auf den Abfangpunkt.
        if self.profile.attack_dash and attack is not None:
            intercept_dir, dist = attack
            error = abs((best_angle - intercept_dir + math.pi) % (2 * math.pi) - math.pi)
            if (
                dist <= self.config.BOT_DASH_ATTACK_RANGE
                and error <= self.config.BOT_DASH_ATTACK_ALIGN
            ):
                return True
        return False
