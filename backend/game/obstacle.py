from dataclasses import dataclass

from .vector import Vector2


@dataclass
class Obstacle:
    """Statisches, rundes Hindernis (Fels) im Spielfeld. Kopf-Kollision = Tod
    (siehe GameRoom.tick). Position/Radius in Welteinheiten, kind rein optisch."""

    position: Vector2
    radius: float
    kind: str = "rock"
