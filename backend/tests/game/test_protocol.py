import pytest
from pydantic import ValidationError

from game.protocol import DebugAuthMessage, DebugBotsMessage, parse_client_message


def test_debug_bots_message_accepts_count_at_upper_bound() -> None:
    msg = DebugBotsMessage(count=50)
    assert msg.count == 50


def test_debug_bots_message_rejects_count_above_upper_bound() -> None:
    with pytest.raises(ValidationError):
        DebugBotsMessage(count=51)


def test_debug_bots_message_rejects_negative_count() -> None:
    with pytest.raises(ValidationError):
        DebugBotsMessage(count=-1)


def test_debug_auth_message_parses() -> None:
    msg = parse_client_message('{"type": "debug_auth", "token": "sekret"}')
    assert isinstance(msg, DebugAuthMessage)
    assert msg.token == "sekret"
