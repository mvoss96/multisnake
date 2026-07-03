import random
from types import SimpleNamespace

from game.game_room import GameRoom
from game.protocol import welcome_message
from game.vector import Vector2


def _obstacle_config(test_config: SimpleNamespace, **over: object) -> SimpleNamespace:
    # Größeres Board + aktivierte Hindernisse (die Standard-Test-Config hat
    # OBSTACLE_COUNT=0, damit übrige Tests unberührt bleiben).
    base = {
        **vars(test_config),
        "BOARD_WIDTH": 1000.0,
        "BOARD_HEIGHT": 1000.0,
        "NUM_BOTS": 0,
        "OBSTACLE_COUNT": 6,
        "OBSTACLE_MIN_RADIUS": 20.0,
        "OBSTACLE_MAX_RADIUS": 30.0,
        "OBSTACLE_BORDER_MARGIN": 100.0,
        "OBSTACLE_GAP": 60.0,
        "OBSTACLE_SPAWN_CLEARANCE": 60.0,
    }
    base.update(over)
    return SimpleNamespace(**base)


def test_obstacles_are_in_bounds_and_non_overlapping(test_config: SimpleNamespace) -> None:
    room = GameRoom(_obstacle_config(test_config))
    obs = room.obstacles
    assert len(obs) == 6
    margin = 100.0
    for o in obs:
        assert o.position.x - o.radius >= margin - 1e-6
        assert o.position.x + o.radius <= 1000.0 - margin + 1e-6
        assert o.position.y - o.radius >= margin - 1e-6
        assert o.position.y + o.radius <= 1000.0 - margin + 1e-6
    for i, a in enumerate(obs):
        for b in obs[i + 1 :]:
            assert a.position.distance_to(b.position) >= a.radius + b.radius + 60.0


def test_generation_is_deterministic_for_equal_seed(test_config: SimpleNamespace) -> None:
    cfg = _obstacle_config(test_config)
    room = GameRoom(cfg)
    room._rng = random.Random(7)
    a = room._generate_obstacles()
    room._rng = random.Random(7)
    b = room._generate_obstacles()
    assert [(o.position.x, o.position.y, o.radius) for o in a] == [
        (o.position.x, o.position.y, o.radius) for o in b
    ]


def test_snake_dies_when_head_is_in_obstacle(test_config: SimpleNamespace) -> None:
    room = GameRoom(_obstacle_config(test_config))
    rock = room.obstacles[0]
    player = room.add_human_player("p1")
    assert player.snake is not None
    player.snake.points = [Vector2(rock.position.x, rock.position.y)]
    player.snake.direction = 0.0
    player.snake.desired_direction = 0.0

    events = room.tick(0.016)

    assert player.snake is None  # Mensch-Tod -> Snake entfernt, Game-Over-Event
    assert any(pid == "p1" for pid, _score in events)


def test_invulnerable_snake_survives_obstacle(test_config: SimpleNamespace) -> None:
    room = GameRoom(_obstacle_config(test_config))
    rock = room.obstacles[0]
    player = room.add_human_player("p1")
    assert player.snake is not None
    player.snake.points = [Vector2(rock.position.x, rock.position.y)]
    player.snake.invulnerable = True

    room.tick(0.016)

    assert player.snake is not None
    assert player.snake.alive


def test_invulnerable_snake_is_pushed_out_of_obstacle(test_config: SimpleNamespace) -> None:
    room = GameRoom(_obstacle_config(test_config))
    rock = room.obstacles[0]
    player = room.add_human_player("p1")
    assert player.snake is not None
    snake = player.snake
    snake.invulnerable = True
    # Kopf INNERHALB des Fels (überlappend, aber nicht exakt im Zentrum).
    snake.points = [Vector2(rock.position.x + rock.radius * 0.4, rock.position.y)]
    snake.direction = 0.0
    snake.desired_direction = 0.0

    room.tick(0.016)

    assert player.snake is not None and player.snake.alive
    # Nicht durchgegangen: der Kopf wurde auf die Fels-Oberfläche zurückgeschoben.
    min_d = snake.radius + rock.radius
    assert snake.head().distance_to(rock.position) >= min_d - 1e-6


def test_snake_survives_next_to_obstacle(test_config: SimpleNamespace) -> None:
    room = GameRoom(_obstacle_config(test_config))
    rock = room.obstacles[0]
    player = room.add_human_player("p1")
    assert player.snake is not None
    # Knapp außerhalb des Fels (Kopf-Rand nicht im Fels), Kurs weg vom Fels.
    safe_x = rock.position.x + rock.radius + player.snake.radius + 15
    player.snake.points = [Vector2(safe_x, rock.position.y)]
    player.snake.direction = 0.0
    player.snake.desired_direction = 0.0

    room.tick(0.016)

    assert player.snake is not None
    assert player.snake.alive


def test_spawns_and_food_avoid_obstacles(test_config: SimpleNamespace) -> None:
    room = GameRoom(_obstacle_config(test_config))
    # Futter (beim Init platziert) liegt in keinem Fels.
    for food in room.food_manager.foods.values():
        assert all(food.position.distance_to(o.position) > o.radius for o in room.obstacles)
    # Mehrere Spawns landen nicht im Fels.
    for i in range(8):
        player = room.add_human_player(f"p{i}")
        assert player.snake is not None
        head = player.snake.head()
        assert all(head.distance_to(o.position) > o.radius for o in room.obstacles)


def test_welcome_message_includes_obstacles(test_config: SimpleNamespace) -> None:
    room = GameRoom(_obstacle_config(test_config))
    msg = welcome_message("p1", room.board, room.obstacles)
    assert len(msg.obstacles) == len(room.obstacles)
    assert msg.obstacles[0].kind == "rock"
    assert msg.obstacles[0].radius > 0
