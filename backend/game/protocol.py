import json


def welcome_message(player_id, board):
    return {
        "type": "welcome",
        "player_id": player_id,
        "board": {"width": board.width, "height": board.height},
    }


def game_over_message(player_id, score):
    return {"type": "game_over", "player_id": player_id, "score": score}


def parse_client_message(raw):
    return json.loads(raw)
