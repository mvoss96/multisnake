import pytest
from pydantic import ValidationError

from game.protocol import DebugBotsMessage, DirectionMessage, parse_client_message


def test_debug_bots_message_accepts_count_at_upper_bound() -> None:
    msg = DebugBotsMessage(count=50)
    assert msg.count == 50


def test_debug_bots_message_rejects_count_above_upper_bound() -> None:
    with pytest.raises(ValidationError):
        DebugBotsMessage(count=51)


def test_debug_bots_message_rejects_negative_count() -> None:
    with pytest.raises(ValidationError):
        DebugBotsMessage(count=-1)


def test_direction_message_accepts_finite_angle() -> None:
    assert DirectionMessage(angle=1.5).angle == 1.5


@pytest.mark.parametrize(
    "raw",
    [
        '{"type":"direction","angle":NaN}',
        '{"type":"direction","angle":Infinity}',
        '{"type":"direction","angle":-Infinity}',
    ],
)
def test_direction_message_rejects_non_finite_angle(raw: str) -> None:
    # NaN/Infinity würde sonst die Kopf-Koordinaten vergiften und die Sim lahmlegen.
    # json.loads akzeptiert diese Tokens - der Ingest muss sie explizit abweisen.
    with pytest.raises(ValidationError):
        parse_client_message(raw)
