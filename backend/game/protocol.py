from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from .board import Board
from .obstacle import Obstacle

# --- Eingehende Nachrichten (Client -> Server) ----------------------------


class JoinMessage(BaseModel):
    type: Literal["join"] = "join"
    name: str | None = None


class DirectionMessage(BaseModel):
    type: Literal["direction"] = "direction"
    angle: float


class RestartMessage(BaseModel):
    type: Literal["restart"] = "restart"


class DashMessage(BaseModel):
    type: Literal["dash"] = "dash"


class DebugPauseMessage(BaseModel):
    type: Literal["debug_pause"] = "debug_pause"
    paused: bool = True


class DebugTeleportMessage(BaseModel):
    type: Literal["debug_teleport"] = "debug_teleport"
    x: float
    y: float


class DebugSpawnAtMessage(BaseModel):
    type: Literal["debug_spawn_at"] = "debug_spawn_at"
    x: float
    y: float


class DebugInvulnerableMessage(BaseModel):
    type: Literal["debug_invulnerable"] = "debug_invulnerable"
    enabled: bool = True


class DebugBotsMessage(BaseModel):
    type: Literal["debug_bots"] = "debug_bots"
    count: int = Field(ge=0, le=50)


ClientMessage = Annotated[
    JoinMessage
    | DirectionMessage
    | RestartMessage
    | DashMessage
    | DebugPauseMessage
    | DebugTeleportMessage
    | DebugSpawnAtMessage
    | DebugInvulnerableMessage
    | DebugBotsMessage,
    Field(discriminator="type"),
]

_client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


def parse_client_message(raw: str) -> ClientMessage:
    return _client_message_adapter.validate_json(raw)


# --- Ausgehende Nachrichten (Server -> Client) ----------------------------


class BoardInfo(BaseModel):
    width: float
    height: float


class ObstacleState(BaseModel):
    x: float
    y: float
    radius: float
    kind: str


class WelcomeMessage(BaseModel):
    type: Literal["welcome"] = "welcome"
    player_id: str
    board: BoardInfo
    # Statische Hindernisse (Felsen) - einmalig beim Verbinden mitgesendet, danach
    # unveränderlich; das Frontend speichert und zeichnet sie (kein per-Tick-Broadcast).
    obstacles: list[ObstacleState] = []
    # Ob die debug_*-Befehle serverseitig freigeschaltet sind (ENABLE_DEBUG_COMMANDS,
    # siehe main.py). Nur dann blendet das Frontend die Debug-Konsole ein - auf dem
    # öffentlichen Deployment (Debug aus) gibt es also keine tote/wirkungslose Konsole.
    debug_enabled: bool = False


class GameOverMessage(BaseModel):
    type: Literal["game_over"] = "game_over"
    player_id: str
    score: int


class SnakeState(BaseModel):
    id: str
    player_id: str
    name: str
    color: str
    pattern: str
    radius: float
    length: float
    score: int
    direction: float
    points: list[list[float]]
    dash_charge: float
    dashing: bool
    invulnerable: bool


class FoodState(BaseModel):
    id: str
    x: float
    y: float
    value: int
    life: float


class StateMessage(BaseModel):
    type: Literal["state"] = "state"
    tick: int
    snakes: list[SnakeState]
    food: list[FoodState]
    paused: bool


def welcome_message(
    player_id: str, board: Board, obstacles: list[Obstacle], debug_enabled: bool = False
) -> WelcomeMessage:
    return WelcomeMessage(
        player_id=player_id,
        board=BoardInfo(width=board.width, height=board.height),
        obstacles=[
            ObstacleState(x=o.position.x, y=o.position.y, radius=o.radius, kind=o.kind)
            for o in obstacles
        ],
        debug_enabled=debug_enabled,
    )


def game_over_message(player_id: str, score: int) -> GameOverMessage:
    return GameOverMessage(player_id=player_id, score=score)
