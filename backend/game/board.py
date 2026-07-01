import random

from .vector import Vector2


class Board:
    def __init__(self, width, height):
        self.width = width
        self.height = height

    def is_out_of_bounds(self, pos, margin=0):
        return (
            pos.x < margin
            or pos.x > self.width - margin
            or pos.y < margin
            or pos.y > self.height - margin
        )

    def random_point(self, margin=0):
        return Vector2(
            random.uniform(margin, self.width - margin),
            random.uniform(margin, self.height - margin),
        )
