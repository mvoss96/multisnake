import math

TICK_RATE = 30
TICK_DT = 1.0 / TICK_RATE

BOARD_WIDTH = 1500
BOARD_HEIGHT = 1500

NUM_BOTS = 6

SNAKE_START_LENGTH = 10        # Segmente
SEGMENT_SPACING = 8.0          # Distanz-Einheiten pro Segment
SNAKE_SPEED = 90.0             # Einheiten pro Sekunde
SNAKE_RADIUS = 7.0
MAX_TURN_RATE = math.pi * 1.4  # Radiant pro Sekunde
DASH_SPEED_MULTIPLIER = 2.2       # Geschwindigkeitsfaktor während des Dash
DASH_DURATION = 0.9                # Sekunden, die der Dash anhält
DASH_RECHARGE_SECONDS = 6.0       # Sekunden bis der Dash nach Verwendung wieder voll aufgeladen ist

FOOD_COUNT_TARGET = 90
FOOD_RADIUS = 5.0
FOOD_MEDIUM_RADIUS = 7.0
FOOD_BIG_RADIUS = 9.0
FOOD_GROWTH_VALUE = SEGMENT_SPACING * 1.5
MAX_SNAKE_LENGTH = 60 * SEGMENT_SPACING
FOOD_DROP_SAMPLE_STEP = 2
FOOD_MEDIUM_VALUE_MULTIPLIER = 2  # mittlere Futterstücke sind X kleine wert (Wachstum + Score)
FOOD_BIG_VALUE_MULTIPLIER = 5     # große Futterstücke sind X kleine wert (Wachstum + Score)
FOOD_MAX_CONSOLIDATE_GAP = 30.0   # Sterbe-Drops werden nur zusammengelegt, wenn die Lücke dabei klein bleibt
FOOD_MEDIUM_SPAWN_CHANCE = 0.2    # Anteil mittlerer Futterstücke beim unabhängigen Hintergrund-Spawn
FOOD_BIG_SPAWN_CHANCE = 0.04      # Anteil großer Futterstücke beim unabhängigen Hintergrund-Spawn
FOOD_MAGNET_RADIUS = 60.0         # Einheiten, ab wann Futter angezogen wird
FOOD_MAGNET_SPEED = 260.0         # Einheiten pro Sekunde
FOOD_LIFETIME_SECONDS = 25.0      # Futter despawnt, wenn es nicht rechtzeitig gegessen wird

SPIKE_ZONE_DEPTH = 14          # muss zu SPIKE_SIZE im Frontend-Renderer passen

BOT_SIGHT_RADIUS = 350.0
BOT_LOOKAHEAD = 60.0
BOT_DANGER_MARGIN = 10.0
BOT_AVOID_TURN = math.pi / 2
BOT_WANDER_TICKS = 20
