# multiSnake

Multiplayer-Snake (slither.io-Stil): ein menschlicher Spieler gegen mehrere KI-Bots.
Backend läuft lokal (FastAPI + WebSocket), UI im Browser (Canvas + Vanilla JS).

## Setup & Start

Benötigt [uv](https://docs.astral.sh/uv/) (`brew install uv`) — verwaltet Python-Version, venv und Dependencies automatisch.

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Dann im Browser öffnen: http://localhost:8000/

## Steuerung

Pfeiltasten oder WASD. Nach Game Over: "Neu starten"-Button.

## Konfiguration

Spielfeldgröße, Anzahl Bots, Geschwindigkeit etc. in `backend/game/config.py`.
