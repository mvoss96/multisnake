import math
import random

from .vector import Vector2


class Bot:
    """Einfache Heuristik: Gefahr meiden > nächstes Futter ansteuern > wandern."""

    def __init__(self, config):
        self.config = config
        self._wander_angle = random.uniform(0, 2 * math.pi)
        self._wander_timer = 0

    def decide(self, snake, context):
        board = context["board"]
        foods = context["foods"]
        other_snakes = context["other_snakes"]
        head = snake.head()

        lookahead = Vector2(
            head.x + math.cos(snake.direction) * self.config.BOT_LOOKAHEAD,
            head.y + math.sin(snake.direction) * self.config.BOT_LOOKAHEAD,
        )
        danger = board.is_out_of_bounds(lookahead)
        if not danger:
            for other in other_snakes:
                for point in other.points[::3]:
                    if lookahead.distance_to(point) < snake.radius + other.radius + self.config.BOT_DANGER_MARGIN:
                        danger = True
                        break
                if danger:
                    break

        if danger:
            return snake.direction + self.config.BOT_AVOID_TURN

        nearest_food = None
        nearest_dist = self.config.BOT_SIGHT_RADIUS
        for food in foods:
            dist = head.distance_to(food.position)
            if dist < nearest_dist:
                nearest_food = food
                nearest_dist = dist
        if nearest_food is not None:
            return head.angle_to(nearest_food.position)

        self._wander_timer -= 1
        if self._wander_timer <= 0:
            self._wander_angle = snake.direction + random.uniform(-0.6, 0.6)
            self._wander_timer = self.config.BOT_WANDER_TICKS
        return self._wander_angle
