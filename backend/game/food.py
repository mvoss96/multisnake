import random
import uuid
from dataclasses import dataclass

from .board import Board
from .types import FoodConfig
from .vector import Vector2


@dataclass
class Food:
    id: str
    position: Vector2
    score_value: int = 1
    remaining_life: float = 0.0
    max_life: float = 1.0


class FoodManager:
    def __init__(self, config: FoodConfig) -> None:
        self.config = config
        self.foods: dict[str, Food] = {}

    def spawn_random(self, board: Board) -> Food:
        pos = board.random_point(margin=20)
        roll = random.random()
        if roll < self.config.FOOD_BIG_SPAWN_CHANCE:
            score_value = self.config.FOOD_BIG_VALUE_MULTIPLIER
        elif roll < self.config.FOOD_BIG_SPAWN_CHANCE + self.config.FOOD_MEDIUM_SPAWN_CHANCE:
            score_value = self.config.FOOD_MEDIUM_VALUE_MULTIPLIER
        else:
            score_value = 1
        return self.spawn_at(pos, score_value)

    def spawn_at(self, position: Vector2, score_value: int = 1) -> Food:
        life = self.config.FOOD_LIFETIME_SECONDS
        food = Food(
            id=str(uuid.uuid4()),
            position=position,
            score_value=score_value,
            remaining_life=life,
            max_life=life,
        )
        self.foods[food.id] = food
        return food

    def ensure_min_food(self, board: Board) -> None:
        while len(self.foods) < self.config.FOOD_COUNT_TARGET:
            self.spawn_random(board)

    def remove(self, food_id: str) -> None:
        self.foods.pop(food_id, None)

    def tick(self, dt: float) -> None:
        expired = []
        for food in self.foods.values():
            food.remaining_life -= dt
            if food.remaining_life <= 0:
                expired.append(food.id)
        for food_id in expired:
            self.foods.pop(food_id, None)
