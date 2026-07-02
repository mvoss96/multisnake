// Zentrale Stellschrauben fürs Frontend-Rendering und -Input.
// Gegenstücke im Backend stehen in backend/game/config.py (dort kommentiert, wo Werte
// zusammenpassen müssen, z.B. Futter-Radien oder die Spike-Zonentiefe).

// Weltausschnitt (Einheiten), zwischen dem abhängig vom Radius (Breite) der
// eigenen Schlange interpoliert wird (siehe main.js) - dünne Schlange =
// reingezoomt (MIN), dicke Schlange = rausgezoomt (MAX). Bewusst am Radius statt
// an der Länge festgemacht, auch wenn beide über dieselbe Wachstumsrate
// zusammenhängen - der Radius ist die optisch spürbare "Größe" der Schlange.
const VIEW_WORLD_HEIGHT_MIN = 480;
// Auf Touch-Geräten (kleinerer Bildschirm, aus der Hand gehalten) startet die
// Kamera noch etwas näher dran als auf Desktop.
const VIEW_WORLD_HEIGHT_MIN_MOBILE = 360;
const VIEW_WORLD_HEIGHT_MAX = 1400;
// Spiegelt SNAKE_RADIUS bzw. SNAKE_MAX_RADIUS aus backend/game/config.py -
// Normierung für die Zoom-Interpolation oben.
const SNAKE_RADIUS_MIN = 7.0;
const SNAKE_RADIUS_MAX = 14.0;
// Die Kamera springt nicht direkt auf ihre Ziel-Zoomstufe, sondern nähert sich ihr
// pro State-Update (30 Hz) exponentiell an (siehe main.js) - sonst wirkt jedes
// Wachstums-Tick als spürbarer Zoom-Ruck. Rauszoomen (Schlange wächst) läuft
// bewusst langsamer als Reinzoomen (z.B. nach einem Neustart).
const ZOOM_LERP_FACTOR_OUT = 0.02;
const ZOOM_LERP_FACTOR_IN = 0.08;

// Mobile / Touch
// Mindest-Weltbreite, die auf jedem Viewport sichtbar sein muss (Fairness-Fix
// für schmale/hohe Mobile-Viewports) - siehe worldScale() in renderer.js. Auf
// Hochformat-Handys ist die Bildschirmbreite praktisch immer der limitierende
// Faktor (nicht VIEW_WORLD_HEIGHT_MIN_MOBILE oben) - dieser Wert steuert dort
// also den tatsächlichen Zoom. Bewusst kleiner als früher (mehr Zoom).
const MIN_VISIBLE_WORLD_WIDTH = 420;
// Drosselung für sendDirection()-Aufrufe während des Touch-Ziehens (verhindert
// Netzwerk-Spam bei hochfrequenten pointermove-Events).
const TOUCH_STEER_MIN_INTERVAL_MS = 33; // gleiche Taktung wie RELATIVE_POLL_MS
// Totzone um den Bildschirm-Ursprung, unterhalb derer keine Richtungsänderung
// gesendet wird (verhindert Zittern bei minimalen Fingerbewegungen).
const TOUCH_STEER_DEADZONE_PX = 12;

// Steuerung
const RELATIVE_POLL_MS = 33;
// Turn step per poll must clear the server's MAX_TURN_RATE clamp, otherwise
// the server becomes the limiting factor as intended (matches absolute-mode feel).
const RELATIVE_TURN_STEP = 0.2;

// Spikes
const SPIKE_SPACING = 30;
const SPIKE_SIZE = 14;
const SPIKE_FILL_COLOR = "rgba(255, 70, 70, 0.85)";
const SPIKE_STROKE_COLOR = "rgba(120, 0, 0, 0.9)";
const SPIKE_GLOW_COLOR = "#ff2020";
const SPIKE_GLOW_PERIOD_MS = 1400;
const SPIKE_GLOW_BLUR_MIN = 10;
const SPIKE_GLOW_BLUR_MAX = 24;
const SPIKE_GLOW_PROXIMITY = 45; // Einheiten - erst kurz vor der tödlichen Zone beginnt das Glühen
const SPIKE_CORNER_MARGIN = 9; // Randabstand am Kanten-Anfang/-Ende, frei einstellbar (siehe drawSpikeRow)

// Futter
const FOOD_BLINK_PERIOD_MS = 900;
const FOOD_BLINK_MIN_ALPHA = 0.55;
// Despawn-Countdown: food.life (1 = frisch, 0 = abgelaufen) startet bei
// FOOD_DEFAULT_ALPHA (leichte Grundtransparenz). Ab FOOD_FADE_START_LIFE nimmt die
// Transparenz zunehmend zu, bis FOOD_FADE_MIN_ALPHA bei Ablauf erreicht ist.
// Unter FOOD_BLINK_START_LIFE beginnt es zusätzlich kurz vor dem Verschwinden zu blinken.
const FOOD_DEFAULT_ALPHA = 0.85;
const FOOD_FADE_START_LIFE = 0.5;
const FOOD_FADE_MIN_ALPHA = 0.1;
const FOOD_BLINK_START_LIFE = 0.2;
// Radien nach food.value gestaffelt (muss zu den Wert-Stufen in config.py passen).
const FOOD_RADIUS = 5;
const FOOD_MEDIUM_RADIUS = 7;
const FOOD_BIG_RADIUS = 9;
// Pixel-Theme: Futter-Sprites (Münze/Edelstein/Trank) werden deutlich größer
// als der Vektor-Kreis-Radius gezeichnet, damit sie auch neben der dicken
// Schlange gut erkennbar sind (das Sprite hat rundum transparenten Rand, die
// eigentliche Grafik ist also kleiner als die gezeichnete Box). Höhe = Radius *
// diesem Faktor, Breite folgt dem Seitenverhältnis des jeweiligen Sprites.
const FOOD_SPRITE_SCALE = 4.6;

// Schlangen
// Snakes bekommen eine dunkle Outline, damit sie sich vom bunten Futter abheben.
const SNAKE_OUTLINE_COLOR = "#05050a";
const SNAKE_OUTLINE_WIDTH = 2.5;
const SNAKE_DASH_GLOW_COLOR = "#8fd9ff";
const SNAKE_DASH_GLOW_BLUR = 16;
// Verjüngung zum Schwanzende hin (Breite des letzten Segments relativ zum Kopf)
// und Anzahl der Teilstücke, in die der Körper dafür zerlegt wird - mehr
// Segmente wirken glatter, kosten aber mehr Stroke-Aufrufe pro Schlange/Frame.
const SNAKE_TAIL_TAPER_FACTOR = 0.35;
const SNAKE_TAPER_SEGMENTS = 12;
// Dezenter heller Glanzstreifen mittig auf dem Körper (Tuben-Look statt flacher Fläche).
const SNAKE_SHINE_WIDTH_FACTOR = 0.35; // relativ zur jeweiligen Körperbreite
const SNAKE_SHINE_ALPHA = 0.25;
// Augen: Versatz relativ zum Schlangenradius, in Blickrichtung positioniert.
const SNAKE_EYE_FORWARD_OFFSET = 0.4;
const SNAKE_EYE_SIDE_OFFSET = 0.55;
const SNAKE_EYE_RADIUS_FACTOR = 0.32;
const SNAKE_PUPIL_RADIUS_FACTOR = 0.16;
// Muster (server-zugewiesen und pro Spieler stabil, siehe GameRoom._PATTERNS im
// Backend - "solid" braucht keine Zusatzzeichnung, hier nicht gelistet).
const SNAKE_PATTERN_POINT_INTERVAL = 4; // Punkte zwischen zwei Muster-Markierungen
const SNAKE_STRIPE_COLOR = "rgba(0, 0, 0, 0.35)";
const SNAKE_STRIPE_WIDTH = 2;
const SNAKE_DOT_COLOR = "rgba(255, 255, 255, 0.55)";
const SNAKE_DOT_RADIUS_FACTOR = 0.4; // relativ zum lokalen Körperradius am jeweiligen Punkt
