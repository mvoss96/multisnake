import math
from typing import Final

TICK_RATE: Final[int] = 30
TICK_DT: Final[float] = 1.0 / TICK_RATE

BOARD_WIDTH: Final[float] = 1500
BOARD_HEIGHT: Final[float] = 1500

# Ziel-Gesamtpopulation (Bots + Menschen), nicht nur eine einmalige Startanzahl:
# GameRoom._rebalance_bots() haelt die Bot-Anzahl staendig bei max(0, NUM_BOTS - human_count).
NUM_BOTS: Final[int] = 6

SNAKE_START_LENGTH: Final[int] = 10  # Segmente
SEGMENT_SPACING: Final[float] = 8.0  # Distanz-Einheiten pro Segment
SNAKE_SPEED: Final[float] = 90.0  # Einheiten pro Sekunde
SNAKE_RADIUS: Final[float] = 7.0
# Radius UND Länge werden direkt aus dem aktuellen Score berechnet (siehe
# Snake.grow): beide wachsen linear von ihrem Startwert (SNAKE_RADIUS bzw.
# Startlänge) bis zum Maximum (SNAKE_MAX_RADIUS bzw. MAX_SNAKE_LENGTH), sobald
# score / SCORE_AT_MAX_LENGTH die 1.0 erreicht - eine lange Schlange wird so
# auch sichtbar dicker, nicht nur länger, und beides ist exakt am Score
# ablesbar statt an einer separat mitgeführten Wachstumsmenge.
SNAKE_MAX_RADIUS: Final[float] = 14.0
# Radius wächst etwas schneller als die Länge (bezogen auf denselben Score-
# Fortschritt) - eine wachsende Schlange wirkt so früher spürbar dicker statt
# nur länger. 1.0 wäre exakt gleich schnell wie die Länge; Radius erreicht sein
# Maximum bereits bei growth == 1/RADIUS_GROWTH_RATE (siehe Snake.grow) und
# bleibt danach bis SCORE_AT_MAX_LENGTH einfach gedeckelt.
RADIUS_GROWTH_RATE: Final[float] = 1.3
MAX_TURN_RATE: Final[float] = math.pi * 1.4  # Radiant pro Sekunde
DASH_SPEED_MULTIPLIER: Final[float] = 2.2  # Geschwindigkeitsfaktor während des Dash
DASH_DURATION: Final[float] = 1.8  # Sekunden, die der Dash anhält
# Sekunden bis der Dash nach Verwendung wieder voll aufgeladen ist (rein zeitbasiert) -
# als Ausgleich zur zusätzlichen Aufladung durch Futter etwas langsamer als früher.
DASH_RECHARGE_SECONDS: Final[float] = 9.0
# Zusätzliche Aufladung beim Fressen, pro "1er"-Futterstück-Äquivalent (skaliert mit
# score_value der Futterstufe, siehe Snake.grow) - kommt zur zeitbasierten Aufladung
# oben drauf, ersetzt sie nicht. Zählt bewusst nicht während eines laufenden Dashs
# (siehe Snake.grow), sonst liesse sich der Dash durch Futter fast endlos verlängern.
DASH_CHARGE_PER_FOOD: Final[float] = 0.02

FOOD_COUNT_TARGET: Final[int] = 90
FOOD_RADIUS: Final[float] = 5.0
FOOD_MEDIUM_RADIUS: Final[float] = 7.0
FOOD_BIG_RADIUS: Final[float] = 9.0
# Deutlich höher als der bisherige 60er-Wert, damit lange Partien wirklich lang
# aussehen - Frontend zoomt die Kamera passend dazu raus (siehe SnakeState.length,
# VIEW_WORLD_HEIGHT_MIN/MAX in frontend/js/config.js).
MAX_SNAKE_LENGTH: Final[float] = 200 * SEGMENT_SPACING
# Faktor, mit dem score_value beim Fressen den Score erhöht. Da Länge/Radius jetzt
# direkt aus score/SCORE_AT_MAX_LENGTH berechnet werden (siehe SNAKE_MAX_RADIUS-
# Kommentar oben, Snake.grow), bestimmt dieser Faktor zusammen mit SCORE_AT_MAX_LENGTH
# auch das Wachstumstempo (wie viele Futterstücke bis zur Maximallänge nötig sind) -
# bewusst 1, damit ein kleines Futterstück exakt 1 Punkt gibt und der Score direkt
# als Futter-Zähler lesbar bleibt (mittlere/große Stücke skalieren wie gehabt über
# FOOD_MEDIUM_VALUE_MULTIPLIER/FOOD_BIG_VALUE_MULTIPLIER).
SCORE_MULTIPLIER: Final[int] = 1
# Score, bei dem Länge/Radius ihr Maximum erreichen - eine exakte, bewusst gewählte
# Schwelle (statt einer Annäherung wie zuvor).
SCORE_AT_MAX_LENGTH: Final[int] = 1000
FOOD_DROP_SAMPLE_STEP: Final[int] = 2
# Mittlere/große Futterstücke sind X kleine wert (Wachstum + Score)
FOOD_MEDIUM_VALUE_MULTIPLIER: Final[int] = 2
FOOD_BIG_VALUE_MULTIPLIER: Final[int] = 5
# Sterbe-Drops werden nur zusammengelegt, wenn die Lücke dabei klein bleibt
FOOD_MAX_CONSOLIDATE_GAP: Final[float] = 30.0
# Anteil mittlerer/großer Futterstücke beim unabhängigen Hintergrund-Spawn
FOOD_MEDIUM_SPAWN_CHANCE: Final[float] = 0.2
FOOD_BIG_SPAWN_CHANCE: Final[float] = 0.04
FOOD_MAGNET_RADIUS: Final[float] = 60.0  # Einheiten, ab wann Futter angezogen wird
FOOD_MAGNET_SPEED: Final[float] = 260.0  # Einheiten pro Sekunde
# Futter despawnt, wenn es nicht rechtzeitig gegessen wird
FOOD_LIFETIME_SECONDS: Final[float] = 25.0

SPIKE_ZONE_DEPTH: Final[float] = 14  # muss zu SPIKE_SIZE im Frontend-Renderer passen

BOT_SIGHT_RADIUS: Final[float] = 350.0
BOT_LOOKAHEAD: Final[float] = 60.0
BOT_DANGER_MARGIN: Final[float] = 10.0
BOT_AVOID_TURN: Final[float] = math.pi / 2
BOT_WANDER_TICKS: Final[int] = 20
