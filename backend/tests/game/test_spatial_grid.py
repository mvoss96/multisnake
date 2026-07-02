from game.spatial_grid import SpatialGrid
from game.vector import Vector2


def test_query_finds_a_point_inside_the_radius() -> None:
    grid: SpatialGrid[str] = SpatialGrid(cell_size=40.0)
    grid.insert(Vector2(10, 10), "a")

    found = list(grid.query(Vector2(12, 12), radius=10.0))

    assert found == [(Vector2(10, 10), "a")]


def test_query_ignores_far_away_points() -> None:
    grid: SpatialGrid[str] = SpatialGrid(cell_size=40.0)
    grid.insert(Vector2(1000, 1000), "far")

    assert list(grid.query(Vector2(0, 0), radius=10.0)) == []


def test_query_radius_larger_than_a_cell_searches_multiple_rings() -> None:
    grid: SpatialGrid[str] = SpatialGrid(cell_size=40.0)
    # ~90 units away -> lies two cells over; a single-ring search would miss it,
    # a radius of 90 (rings = ceil(90/40) = 3) must still find it.
    grid.insert(Vector2(90, 0), "b")

    found = [item for _pos, item in grid.query(Vector2(0, 0), radius=90.0)]

    assert "b" in found


def test_empty_grid_yields_nothing() -> None:
    grid: SpatialGrid[str] = SpatialGrid(cell_size=40.0)
    assert list(grid.query(Vector2(0, 0), radius=100.0)) == []


def test_query_returns_all_items_sharing_a_cell() -> None:
    grid: SpatialGrid[int] = SpatialGrid(cell_size=40.0)
    grid.insert(Vector2(5, 5), 1)
    grid.insert(Vector2(6, 6), 2)

    items = sorted(item for _pos, item in grid.query(Vector2(5, 5), radius=5.0))

    assert items == [1, 2]
