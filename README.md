# multiSnake

Multiplayer-Snake (slither.io-Stil): ein menschlicher Spieler gegen mehrere KI-Bots.
Backend läuft lokal (FastAPI + WebSocket), UI im Browser (Canvas + Vanilla JS).

## Setup & Start

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Dann im Browser öffnen: http://localhost:8000/

## Steuerung

Pfeiltasten oder WASD. Nach Game Over: "Neu starten"-Button.

## Konfiguration

Spielfeldgröße, Anzahl Bots, Geschwindigkeit etc. in `backend/game/config.py`.
