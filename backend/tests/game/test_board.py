from game.board import Board
from game.vector import Vector2


def test_center_is_in_bounds() -> None:
    board = Board(width=100, height=100)
    assert not board.is_out_of_bounds(Vector2(50, 50))


def test_negative_or_beyond_dimension_is_out_of_bounds() -> None:
    board = Board(width=100, height=100)
    assert board.is_out_of_bounds(Vector2(-1, 50))
    assert board.is_out_of_bounds(Vector2(50, -1))
    assert board.is_out_of_bounds(Vector2(101, 50))
    assert board.is_out_of_bounds(Vector2(50, 101))


def test_exact_edge_without_margin_is_in_bounds() -> None:
    board = Board(width=100, height=100)
    assert not board.is_out_of_bounds(Vector2(0, 0))
    assert not board.is_out_of_bounds(Vector2(100, 100))


def test_margin_shrinks_the_safe_zone() -> None:
    board = Board(width=100, height=100)
    # Just inside the margin boundary -> safe
    assert not board.is_out_of_bounds(Vector2(10, 50), margin=10)
    # Just inside the margin from the edge -> unsafe (matches "<" not "<=")
    assert board.is_out_of_bounds(Vector2(9.999, 50), margin=10)
    assert board.is_out_of_bounds(Vector2(50, 9.999), margin=10)
    assert board.is_out_of_bounds(Vector2(90.001, 50), margin=10)


def test_random_point_respects_margin() -> None:
    board = Board(width=200, height=150)
    for _ in range(200):
        point = board.random_point(margin=20)
        assert 20 <= point.x <= 180
        assert 20 <= point.y <= 130
