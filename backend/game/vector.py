import math
from dataclasses import dataclass


@dataclass
class Vector2:
    x: float
    y: float

    def distance_to(self, other):
        return math.hypot(self.x - other.x, self.y - other.y)

    def angle_to(self, other):
        return math.atan2(other.y - self.y, other.x - self.x)

    @staticmethod
    def from_angle(angle):
        return Vector2(math.cos(angle), math.sin(angle))
