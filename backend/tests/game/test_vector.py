import math

from game.vector import Vector2


def test_distance_to_pythagoras() -> None:
    a = Vector2(0, 0)
    b = Vector2(3, 4)
    assert a.distance_to(b) == 5.0


def test_distance_to_is_symmetric() -> None:
    a = Vector2(1, 2)
    b = Vector2(-3, 5)
    assert a.distance_to(b) == b.distance_to(a)


def test_distance_to_same_point_is_zero() -> None:
    a = Vector2(10, 10)
    assert a.distance_to(a) == 0.0


def test_angle_to_cardinal_directions() -> None:
    origin = Vector2(0, 0)
    assert origin.angle_to(Vector2(1, 0)) == 0.0
    assert origin.angle_to(Vector2(0, 1)) == math.pi / 2
    assert origin.angle_to(Vector2(-1, 0)) == math.pi
    assert origin.angle_to(Vector2(0, -1)) == -math.pi / 2


def test_from_angle_returns_unit_vector() -> None:
    v = Vector2.from_angle(0)
    assert v.x == math.cos(0)
    assert v.y == math.sin(0)
    assert math.isclose(math.hypot(v.x, v.y), 1.0)


def test_from_angle_roundtrips_with_angle_to() -> None:
    origin = Vector2(0, 0)
    angle = math.pi / 3
    heading = Vector2.from_angle(angle)
    assert math.isclose(origin.angle_to(heading), angle)
