# multiSnake

Multiplayer-Snake mit kontinuierlicher (nicht rasterbasierter) Bewegung: ein
menschlicher Spieler gegen mehrere KI-Bots auf einem gemeinsamen Feld, die Kamera
folgt der eigenen Schlange und zoomt beim Wachsen heraus. Backend: FastAPI +
WebSocket (Python 3.12). Frontend: Vanilla JS + HTML5-Canvas, ohne Build-Step.

**Live:** https://snake.marcusvoss.de

## Features

- **KI-Bots mit gemischter Schwierigkeit** (Anfänger / Jäger / Raubtier): weichen
  Wänden, Spikes und einander aus, sammeln Futter wertgewichtet, schneiden andere
  Schlangen ab und setzen den Dash offensiv/zur Flucht ein.
- **Dash** – kurzer Geschwindigkeitsschub, lädt zeit- und futterbasiert wieder auf.
- **Zwei Designs** umschaltbar: „Klassisch" (Vektor) und „Pixel-Art" (Sprites,
  einheitliches Pixel-Raster, Wald-Kulisse, Holz-UI).
- **Touch-/Mobile-Steuerung** (halten & ziehen + Dash-Button) und responsives Layout.
- **Futter-Stufen** (Erdbeere/Gem/Trank) mit unterschiedlichem Wert, Leaderboard.

## Setup & Start

Benötigt [uv](https://docs.astral.sh/uv/) (`brew install uv`) — verwaltet
Python-Version, venv und Dependencies automatisch.

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Dann im Browser öffnen: http://localhost:8000/ (derselbe Prozess liefert die
WebSocket-API **und** das statische Frontend).

## Steuerung

- **Tastatur:** Pfeiltasten oder WASD. **Maus/Touch:** gedrückt halten & ziehen.
- **Dash:** Umschalt-Taste (Desktop) bzw. der Dash-Button unten rechts (Touch).
- **Steuermodus** (absolut zum Bildschirm ↔ relativ zur Schlange): **Tab**.
- **Design** wählbar im Namens-Modal und im Game-Over-Screen.

## Entwicklung

Aus `backend/` (siehe `CLAUDE.md` für Details):

```bash
uv run pytest            # Tests
uv run ruff check .      # Linting
uv run ruff format --check .
uv run mypy .            # Typprüfung (strict)
```

## Konfiguration

- **Gameplay** (Feldgröße, Bot-Anzahl/-Profile, Geschwindigkeit, Dash, Futter):
  `backend/game/config.py`.
- **Visuals/Input** (Zoom, Pixel-Raster, Farben, Steuerung): `frontend/js/config.js`.
