import math

from .types import SnakeConfig
from .vector import Vector2


class Snake:
    def __init__(
        self,
        snake_id: str,
        player_id: str,
        name: str,
        color: str,
        pattern: str,
        start_pos: Vector2,
        start_direction: float,
        config: SnakeConfig,
    ) -> None:
        self.id = snake_id
        self.player_id = player_id
        self.name = name
        self.color = color
        self.pattern = pattern
        self.direction = start_direction
        self.desired_direction = start_direction
        self.speed = config.SNAKE_SPEED
        self.radius = config.SNAKE_RADIUS
        self.alive = True
        self.points: list[Vector2] = [start_pos]
        self.target_length = config.SNAKE_START_LENGTH * config.SEGMENT_SPACING
        self.max_length = config.MAX_SNAKE_LENGTH
        self._min_length = self.target_length
        self._min_radius = config.SNAKE_RADIUS
        self._max_radius = config.SNAKE_MAX_RADIUS
        self.score = 0
        self.config = config
        self.dash_charge = 1.0  # 0..1, bei 1.0 einsatzbereit
        self.dash_time_remaining = 0.0
        self.invulnerable = False  # Debug: ignoriert Rand-/Kollisionstod

    def head(self) -> Vector2:
        return self.points[0]

    def set_desired_direction(self, angle: float) -> None:
        self.desired_direction = angle

    def try_dash(self) -> bool:
        if self.dash_charge >= 1.0 and self.dash_time_remaining <= 0:
            self.dash_time_remaining = self.config.DASH_DURATION
            self.dash_charge = 0.0
            return True
        return False

    def move(self, dt: float, max_turn_rate: float) -> None:
        diff = (self.desired_direction - self.direction + math.pi) % (2 * math.pi) - math.pi
        max_delta = max_turn_rate * dt
        if diff > max_delta:
            diff = max_delta
        elif diff < -max_delta:
            diff = -max_delta
        self.direction += diff

        if self.dash_time_remaining > 0:
            self.dash_time_remaining = max(0.0, self.dash_time_remaining - dt)
            current_speed = self.speed * self.config.DASH_SPEED_MULTIPLIER
        else:
            current_speed = self.speed
            if self.dash_charge < 1.0:
                recharge = dt / self.config.DASH_RECHARGE_SECONDS
                self.dash_charge = min(1.0, self.dash_charge + recharge)

        heading = Vector2.from_angle(self.direction)
        head = self.head()
        new_head = Vector2(
            head.x + heading.x * current_speed * dt,
            head.y + heading.y * current_speed * dt,
        )
        self.points.insert(0, new_head)
        self._trim()

    def _trim(self) -> None:
        total = 0.0
        cutoff_index = None
        for i in range(1, len(self.points)):
            total += self.points[i - 1].distance_to(self.points[i])
            if total >= self.target_length:
                cutoff_index = i
                break
        if cutoff_index is not None:
            del self.points[cutoff_index + 1 :]

    def grow(self, amount: float, score_value: int = 1) -> None:
        self.target_length = min(self.target_length + amount, self.max_length)
        self.score += score_value

        # Radius wächst linear mit der Länge mit - eine lange Schlange wird so
        # auch sichtbar dicker, nicht nur länger (wirkt sich über self.radius
        # auch auf Kollisions-/Futter-Reichweite aus, nicht nur die Optik).
        length_span = self.max_length - self._min_length
        growth = (self.target_length - self._min_length) / length_span if length_span > 0 else 1.0
        growth = min(1.0, max(0.0, growth))
        self.radius = self._min_radius + (self._max_radius - self._min_radius) * growth

        if self.dash_time_remaining <= 0:  # kein Aufladen durch Futter während des Dashs
            charge_gain = self.config.DASH_CHARGE_PER_FOOD * score_value
            self.dash_charge = min(1.0, self.dash_charge + charge_gain)
