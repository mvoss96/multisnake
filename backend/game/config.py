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

# --- Hindernisse (statische Felsen im Inneren) ----------------------------
# Beim Raum-Start einmalig geseedet platziert (deterministisch über GameRoom._rng),
# runde Felsen: Kopf-Kollision = Tod (wie Rand/Spikes). Rein Backend-Wahrheit; das
# Frontend bekommt sie einmal in der welcome-Nachricht und zeichnet sie.
# Vorerst deaktiviert (0). Die gesamte Hindernis-Logik bleibt erhalten - zum
# Reaktivieren einfach wieder eine Anzahl > 0 setzen (z.B. 5).
OBSTACLE_COUNT: Final[int] = 0
# Min == Max: alle Felsen gleich groß (das Pixel-Sprite wird mit festem Integer-
# Faktor gezeichnet, siehe ROCK_PIXEL_SCALE im Frontend - pixelperfekt, kein Skalieren).
OBSTACLE_MIN_RADIUS: Final[float] = 40.0
OBSTACLE_MAX_RADIUS: Final[float] = 40.0
# Abstand des Fels-Randes zur Board-Kante (jenseits der Spikes) bei der Platzierung.
OBSTACLE_BORDER_MARGIN: Final[float] = 120.0
# Mindest-Lücke (Rand-zu-Rand) zwischen zwei Felsen beim Spawnen - großzügig,
# damit die (wenigen) Felsen gut übers Feld verteilt sind und Schlangen durchpassen.
OBSTACLE_GAP: Final[float] = 180.0
# Freiraum um einen Fels, in dem KEINE Schlange/kein Futter spawnen darf.
OBSTACLE_SPAWN_CLEARANCE: Final[float] = 70.0

# Zellgröße des Spatial-Grids (Broad-Phase für Kollision/Food, siehe game/spatial_grid.py).
# Rein Tuning der Kandidatenmenge/Geschwindigkeit - die Korrektheit ist unabhängig davon,
# solange query() mit dem echten Interaktionsradius aufgerufen wird. Sinnvoll gewählt >=
# typischer Interaktionsabstand (Kollision ~28, Food-Fressen ~23, Magnet 60).
GRID_CELL_SIZE: Final[float] = 40.0

# --- Bot-KI ---------------------------------------------------------------
# Die KI bewertet pro Entscheidung einen Fächer von Kandidaten-Richtungen und
# wählt die beste über  score = wünschbarkeit - gefahr  (siehe game/bot.py).
# Die folgenden Konstanten sind die gemeinsamen Bausteine; die drei
# Schwierigkeits-Profile (BOT_EASY_*/BOT_MED_*/BOT_HARD_*) skalieren sie.

# Halbe Breite des Richtungsfächers um die aktuelle Fahrtrichtung (Radiant).
# Bewusst < pi, damit kein 180°-Wendemanöver in den eigenen Hals kandidiert wird.
BOT_FAN_HALF_ANGLE: Final[float] = 2.5
# Länge der Gefahr-Abtaststrahlen (Einheiten) und Anzahl Sample-Punkte je Strahl.
BOT_RAY_LENGTH: Final[float] = 95.0
BOT_RAY_SAMPLES: Final[int] = 4
# Sicherheitszuschlag auf die Summe der Kollisionsradien beim Gefahr-Sampling.
BOT_DANGER_MARGIN: Final[float] = 12.0
# Nur jeder N-te Körperpunkt fremder/eigener Schlangen wird als Hindernis
# abgetastet (Broad-Phase-Ersatz - hält den Gefahr-Check billig).
BOT_BODY_SAMPLE_STEP: Final[int] = 4
# Die vordersten eigenen Segmente werden beim Selbst-Ausweichen übersprungen -
# der eigene Hals ist nie erreichbar (MAX_TURN_RATE) und würde sonst Dauergefahr melden.
BOT_SELF_SKIP_SEGMENTS: Final[int] = 6
# Ticks, bis der Wander-Zielwinkel neu driftet, und maximale Drift pro Neuwahl (rad).
BOT_WANDER_TICKS: Final[int] = 25
BOT_WANDER_DRIFT: Final[float] = 0.7
# Leichte Vorliebe, den aktuellen Kurs zu halten (dämpft Zittern zwischen Kandidaten).
BOT_FORWARD_BIAS: Final[float] = 0.35
# Aggression: max. Kopf-Abstand für ein Angriffsziel und Vorhalt vor dem
# Ziel-Kopf, auf den der Abfang-Cut-off zielt (Einheiten).
BOT_ATTACK_RANGE: Final[float] = 260.0
BOT_ATTACK_LEAD: Final[float] = 45.0
# Dash-Flucht: gewählte (sicherste) Richtung hat Gefahr-Kosten im Bereich
# [FLEE_DANGER, FLEE_MAX] -> beschleunigen, um zu entkommen. Die Obergrenze
# verhindert einen Dash in eine quasi-sichere Wand direkt voraus.
BOT_DASH_FLEE_DANGER: Final[float] = 0.5
BOT_DASH_FLEE_MAX: Final[float] = 0.9
# Dash-Angriff (nur HARD): Ziel-Kopf innerhalb dieser Reichweite und der
# gewählte Kurs innerhalb dieses Winkelfehlers zum Abfangpunkt (rad).
BOT_DASH_ATTACK_RANGE: Final[float] = 150.0
BOT_DASH_ATTACK_ALIGN: Final[float] = 0.4

# Profil-Presets. Pro Profil: Sichtweite, Gefahr-Gewicht (Vorsicht), Futter-Gewicht,
# Aggression, Wander-Gewicht, Ziel-Rauschen (Imperfektion), Kandidatenzahl (Auflösung),
# Reaktionsintervall (nur alle N Ticks neu entscheiden).
BOT_EASY_SIGHT: Final[float] = 240.0
BOT_EASY_DANGER_WEIGHT: Final[float] = 2.5
BOT_EASY_FOOD_WEIGHT: Final[float] = 0.8
BOT_EASY_AGGRESSION: Final[float] = 0.0
BOT_EASY_WANDER_WEIGHT: Final[float] = 0.6
BOT_EASY_NOISE: Final[float] = 0.5
BOT_EASY_CANDIDATES: Final[int] = 7
BOT_EASY_REACT_TICKS: Final[int] = 6

BOT_MED_SIGHT: Final[float] = 350.0
BOT_MED_DANGER_WEIGHT: Final[float] = 4.0
BOT_MED_FOOD_WEIGHT: Final[float] = 1.0
BOT_MED_AGGRESSION: Final[float] = 0.5
BOT_MED_WANDER_WEIGHT: Final[float] = 0.3
BOT_MED_NOISE: Final[float] = 0.15
BOT_MED_CANDIDATES: Final[int] = 11
BOT_MED_REACT_TICKS: Final[int] = 3

BOT_HARD_SIGHT: Final[float] = 460.0
BOT_HARD_DANGER_WEIGHT: Final[float] = 6.0
BOT_HARD_FOOD_WEIGHT: Final[float] = 1.1
BOT_HARD_AGGRESSION: Final[float] = 1.3
BOT_HARD_WANDER_WEIGHT: Final[float] = 0.15
BOT_HARD_NOISE: Final[float] = 0.0
BOT_HARD_CANDIDATES: Final[int] = 15
BOT_HARD_REACT_TICKS: Final[int] = 1

# Auswahlgewichte (easy, medium, hard), mit denen ein neuer Bot sein Profil zieht.
BOT_SKILL_WEIGHTS: Final[tuple[int, int, int]] = (2, 3, 2)
