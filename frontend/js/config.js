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

// Pixel-Art-Raster (nur Themes mit pixelPerfect, siehe themes.js/renderer.js):
// EINE globale Art-Pixel-Größe in Welteinheiten pro Quell-Texel. JEDES gethemete
// Sprite wird mit  quellAuflösung * PIXEL_UNIT  gezeichnet - so hat ein Sprite-
// Pixel überall exakt dieselbe Bildschirmgröße (der Kern des einheitlichen
// Pixel-Looks). renderer.js rastert zusätzlich Kamera/Zoom und Sprite-Positionen
// auf dieses Gitter. 0.6 gewählt, damit der Baum (150px Quellhöhe) wie bisher
// ~90 Welteinheiten hoch bleibt; alle anderen Sprites ziehen auf dieselbe
// Texel-Größe nach.
const PIXEL_UNIT = 0.6;

// Client-Interpolation: Das Rendern läuft in einer requestAnimationFrame-Schleife
// (Display-Refresh) und interpoliert zwischen den letzten zwei Server-States, statt
// nur beim Eintreffen einer State-Nachricht zu zeichnen. Das entkoppelt die sichtbare
// Bildrate vom (auf Mobile ungleichmäßig eintreffenden) 30-Hz-Netz-Takt und versteckt
// Netzwerk-Jitter -> flüssige Bewegung auch bei nur einem Spieler. Die
// Interpolationsdauer wird als geglätteter Mittelwert (EMA) der tatsächlichen
// Ankunftsabstände geführt, passt sich also der realen Tickrate an (auch bei
// serverseitiger Verlangsamung unter Last) statt eine feste 30 Hz anzunehmen.
const INTERP_INITIAL_MS = 1000 / 30; // Startwert = nominale Server-Tickrate
const INTERP_SMOOTHING = 0.2; // EMA-Gewicht neuer Messwerte (0..1)
const INTERP_MIN_MS = 20; // untere/obere Klammer der geglätteten Dauer gegen Ausreißer
const INTERP_MAX_MS = 200;
// Ankunftsabstände darüber gelten als Aussetzer (Tab-Wechsel, Netz-Hänger) und
// fließen NICHT in die EMA ein - sonst würde ein einzelner Hänger die Dauer verzerren.
const INTERP_SAMPLE_MAX_MS = 500;

// Debug-Overlay (Klick/Tap auf den Score, siehe main.js): neben Länge/Breite auch
// Spieleranzahl, FPS und Netz-Stabilität. Die Netz-Stabilität wird qualitativ aus dem
// Ankunfts-Jitter der State-Nachrichten (mittlere absolute Abweichung vom geglätteten
// Tickabstand) abgeleitet; FPS und Jitter laufen als geglättete Mittelwerte (EMA).
const FPS_SMOOTHING = 0.1; // EMA-Gewicht neuer FPS-Messwerte
const NET_JITTER_SMOOTHING = 0.2; // EMA-Gewicht neuer Jitter-Messwerte
const NET_JITTER_OK_MS = 8; // <= stabil
const NET_JITTER_POOR_MS = 20; // <= ok, darüber instabil

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

// Pixel-Theme: gestufte Gold-Füllung fürs Dash-Laden (steigt im Münz-Coin von
// unten auf, siehe .dash-fill in style.css + updateDashMeter in main.js) -
// einheitlich für Desktop-Ring UND Touch-Button, ersetzt den glatten SVG-Bogen
// (eine anti-aliasierte Kurve passt nicht zum harten Pixel-Look). In so viele
// Stufen gerundet, dass die aufsteigende Kante chunky/gepixelt wirkt statt
// glatt zu gleiten.
const DASH_FILL_STEPS = 8;

// Deko-Bäume an Kartenrändern (nur Themes mit borderSprite-Rolle, siehe
// themes.js/renderer.js) - rein optisch, keine Kollision. Der Stammfuß sitzt auf
// der oberen Weltkante (y=0), die Krone ragt nach oben aus dem Feld. Bäume werden
// dicht an dicht gereiht und leicht in der Höhe versetzt für eine Wald-Silhouette.
// Baumgröße kommt jetzt aus der Sprite-Quellauflösung * PIXEL_UNIT (siehe
// spriteWorldSize in renderer.js), nicht mehr aus einer festen Höhe - so teilt
// sich der Baum dieselbe Texel-Größe wie alle anderen Sprites.
const TREE_SPACING = 62; // horizontaler Abstand der Stämme
// Kleiner seitlicher (entlang des Rands) Versatz je Baum als Bruchteil des
// Abstands - lockert die perfekt-lineale Reihe minimal auf, OHNE die Höhe zu
// verändern (alle Bäume stehen bewusst auf exakt derselben Höhe). Die
// Überlappungsrichtung wird nicht über Höhen-/Tiefen-Jitter variiert (das
// setzte die Bäume sichtbar unterschiedlich hoch), sondern nur über eine
// zufällige Zeichenreihenfolge (siehe drawBorderTrees).
const TREE_ALONG_JITTER_FACTOR = 0.15;
// Stammfuß nicht exakt auf der Tile-Kante, sondern etwas ins Feld versetzt -
// so stehen die Bäume auf dem Gras und die überlappenden Kronen verdecken die
// sonst sichtbare harte Bodenkante zwischen den Bäumen.
const TREE_FOOT_INSET = 26;
// Sicherheitsmarge zusätzlich zum rechnerisch nötigen Boden-Überhang (siehe
// treeOverhang() in renderer.js, das die Kronen-Maximalausdehnung aus
// TREE_HEIGHT/Sprite-Seitenverhältnis/TREE_FOOT_INSET herleitet) - ein reiner
// Festwert hier wäre bei jeder Anpassung der Baum-Konstanten erneut falsch
// (siehe Bug: bei 32px sichtbare Bodenkante links).
const TREE_OVERHANG_MARGIN = 6;
// Der Boden-Überhang selbst hat eine feste (wenn auch korrekt berechnete)
// Außenkante zum schwarzen Canvas-Hintergrund. Ohne Weichzeichnung ist das eine
// harte Linie am Rand der Waldkante - genau das "diese eine Linie"-Problem. Ein
// linearer Alpha-Verlauf blendet den Boden ins Dunkel über: von
// START_FACTOR*Overhang (noch voll sichtbare Textur) bis END_FACTOR*Overhang
// (voll deckend schwarz). END_FACTOR MUSS GENAU 1.0 sein: der Verlauf muss
// exakt an der Fill-Außenkante (= Overhang) voll deckend werden. Ist er
// kleiner (früherer Bug: 0.94), bleibt zwischen END*Overhang und der Fill-Kante
// ein schmaler, NICHT weichgezeichneter Streifen voller Textur übrig, der hart
// ins Schwarze schneidet - das ist die sichtbare Linie. Größer als 1.0 wäre
// unnötig (malt nur Schwarz auf bereits schwarzen Hintergrund).
const BORDER_FADE_START_FACTOR = 0.3;
const BORDER_FADE_END_FACTOR = 1.0;
// Weicher elliptischer Bodenschatten am Stammfuß (Licht von oben) - erdet die
// Bäume auf dem Waldboden, orientiert am Mockup. Radialer Verlauf mit dunklem
// Kern (Mid-Stop im Verlauf) für weiche, aber klar sichtbare Kante.
const TREE_SHADOW_ALPHA = 0.6;
const TREE_SHADOW_WIDTH_FACTOR = 0.66; // Schattenradius relativ zur Baumbreite
const TREE_SHADOW_FLATNESS = 0.52; // Höhe/Breite der Schatten-Ellipse
const TREE_SHADOW_DROP = 10; // Welteinheiten unter den Stammfuß versetzt

// Hindernisse (statische Felsen; Position/Radius kommen vom Server in der
// welcome-Nachricht). Sprite etwas größer als die Kollisionsscheibe zeichnen,
// damit der Fels solide über seinen Hitbox-Rand ragt. Vektor-Fallback (Klassik-
// Theme) = gefüllter grauer Kreis mit Kontur.
const ROCK_SPRITE_SCALE = 1.18;
const ROCK_FILL_COLOR = "#6b6b74";
const ROCK_STROKE_COLOR = "#33333c";

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
// Pixel-Theme: Futter-Sprites werden - wie alle gethemeten Sprites - mit
// quellAuflösung * PIXEL_UNIT gezeichnet (siehe spriteWorldSize in renderer.js).
// Die Stufengröße (Erdbeere < Gem < Trank) steckt damit in der nativen
// Auflösung der PNGs, nicht mehr in einem Skalenfaktor hier.
// Gethemete Futter-Sprites (nur die Sprite-Variante, nicht die Klassik-Kreise)
// schweben sanft auf und ab, damit sie sich von der gekachelten Bodentextur
// abheben. Rein kosmetisch - nur der Zeichen-Offset, food.x/food.y (und damit
// die Server-Kollision) bleiben unberührt. Jedes Stück schwebt entkoppelt
// (Phase aus hashUnit(food.id)), sonst wippt alles im Gleichtakt.
const FOOD_BOB_PERIOD_MS = 1600; // Dauer eines vollen Auf-/Ab-Zyklus
// Schwebehöhe relativ zum Futter-Radius: das Sprite steht immer mindestens
// BASE_LIFT über dem echten Bodenpunkt und wippt zusätzlich um AMPLITUDE.
const FOOD_BOB_BASE_LIFT_FACTOR = 0.4;
const FOOD_BOB_AMPLITUDE_FACTOR = 0.55;
// Kontakt-Schatten am echten Bodenpunkt (food.y) - eine flache dunkle Ellipse,
// die das schwebende Sprite optisch vom Boden abhebt. Sie schrumpft und
// verblasst leicht, je höher das Sprite gerade schwebt (Distanz zum Boden).
const FOOD_SHADOW_ALPHA = 0.28;
const FOOD_SHADOW_WIDTH_FACTOR = 0.45; // Ellipsen-Breite relativ zur Sprite-Breite
const FOOD_SHADOW_FLATNESS = 0.4; // Ellipsen-Höhe relativ zu ihrer Breite
const FOOD_SHADOW_LIFT_SHRINK = 0.25; // max. Schrumpfen am höchsten Punkt
const FOOD_SHADOW_LIFT_FADE = 0.35; // max. zusätzliche Transparenz am höchsten Punkt

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
// Prozedurale Schuppen-/Segment-Textur (nur Themes mit snakeScales=true, siehe
// themes.js) - dichte, quer über den Körper laufende dunkle Rillen erzeugen den
// geschuppten Pixel-Look aus dem Mockup, farbecht (halbtransparentes Schwarz
// statt eingefärbter Linien, funktioniert also auf jeder Spielerfarbe). Zusätzlich
// eine dickere Kontur als bei der glatten Default-Schlange.
const SNAKE_SCALE_POINT_INTERVAL = 2; // Punkte zwischen zwei Segment-Rillen (klein = dicht)
const SNAKE_SCALE_COLOR = "rgba(0, 0, 0, 0.22)";
const SNAKE_SCALE_WIDTH = 2;
const SNAKE_SCALE_OUTLINE_WIDTH = 4.5; // dickere Kontur im geschuppten Modus (sonst SNAKE_OUTLINE_WIDTH)
