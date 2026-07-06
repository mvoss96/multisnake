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

// Classic-Theme: dynamischer Hintergrund (Aurora-Farbwolken + driftendes Sternenfeld,
// siehe drawDynamicBackground in renderer.js). Nur Themes mit dynamicBg (themes.js).
// Der Hintergrund ist bewusst KOMPLETT von der Kamera/Schlange entkoppelt und bewegt
// sich rein eigenständig: die Sterne driften stetig (überwiegend horizontal) über den
// Bildschirm, die Aurora wandert über ihren eigenen AURORA_DRIFT. Die Schlangenbewegung
// verschiebt den Hintergrund NICHT (das wirkte, als klebte er an der Schlange).
const AURORA_BG_BASE = "#03030a"; // fast schwarzes Blau als Basis (dunkel, damit das Leuchten trägt)
const AURORA_BLOB_COLORS = ["70,90,220", "140,70,210", "40,165,175"]; // rgb je Farbwolke
const AURORA_ALPHA = 0.18; // Deckkraft der Farbwolken (dezent, dunkler gehalten)
const AURORA_RADIUS_FACTOR = 0.62; // Wolken-Radius relativ zur größeren Canvas-Kante
const AURORA_DRIFT = 0.1; // Wander-Amplitude (Bruchteil der Canvas-Größe)
const STAR_LAYERS = [
  { count: 90, parallax: 0.04, alpha: 0.32, size: 1 }, // ferne Ebene (langsam)
  { count: 45, parallax: 0.1, alpha: 0.6, size: 2 }, // nahe Ebene (schneller)
];
// Eigenständige Drift des Sternenfelds (unabhängig von der Kamera/Schlange): überwiegend
// horizontal, stetig und gut sichtbar. Welt-Einheiten pro ms; skaliert pro Ebene mit
// deren parallax (nahe Ebene driftet schneller = Tiefe), also driften die Ebenen
// unterschiedlich schnell und erzeugen so den Parallax-Effekt ganz ohne Kamera.
const STAR_AUTO_DRIFT_X = 0.14;
const STAR_AUTO_DRIFT_Y = 0.025;
// Alles AUSSERHALB des Spielfelds (dynamicBg-Themes) wird abgedunkelt, damit das
// eigentliche Feld sich klar abhebt (siehe drawOutOfBoundsShade in renderer.js).
// Kräftiges, fast deckendes Schwarz - der Aurora-Grund bleibt nur innerhalb des
// Boards voll sichtbar, draußen fast schwarz.
const WORLD_OOB_SHADE = "rgba(0, 0, 0, 0.82)";

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

// Dev-Overlay (Klick/Tap auf die Platz-Anzeige #hud-status, siehe main.js): neben Platz
// auch Score, Länge/Breite, Spieleranzahl, FPS und Netz-Stabilität. Die Netz-Stabilität
// wird qualitativ aus dem Ankunfts-Jitter der State-Nachrichten (mittlere absolute
// Abweichung vom geglätteten Tickabstand) abgeleitet; FPS und Jitter laufen als EMA.
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
const ROCK_SPRITE_SCALE = 1.15; // nur Klassik (auf Durchmesser skaliert)
// Pixel-Theme: FESTER Integer-Faktor - jedes Art-Pixel des Fels-Sprites = so viele
// Texel. Kein radius-abhängiges Skalieren -> alle Felsen exakt gleich groß und
// pixelperfekt (native ~46px * 3 * PIXEL_UNIT ≈ 83 Welt ≈ Durchmesser bei Radius 40).
const ROCK_PIXEL_SCALE = 3;
const ROCK_FILL_COLOR = "#6b6b74";
const ROCK_STROKE_COLOR = "#2a2a30";
const ROCK_HIGHLIGHT_COLOR = "#9a9aa6";

// Spikes
const SPIKE_SPACING = 30;
const SPIKE_SIZE = 14;
const SPIKE_FILL_COLOR = "rgba(255, 70, 70, 0.85)";
const SPIKE_STROKE_COLOR = "rgba(120, 0, 0, 0.9)";
const SPIKE_GLOW_COLOR = "#ff2020";
const SPIKE_GLOW_PERIOD_MS = 1400;
const SPIKE_GLOW_BLUR_MIN = 10;
const SPIKE_GLOW_BLUR_MAX = 24;
// Gefahren-Radius (Einheiten): ab dieser Nähe beginnt das rote Warn-Glühen ALLER
// tödlichen Hindernisse - Spikes/Ränder, Baum-Ränder UND Steine (siehe
// drawBoundary/drawObstacles in renderer.js). Bewusst großzügig, damit man die
// Todeszone rechtzeitig sieht.
const SPIKE_GLOW_PROXIMITY = 130;
// Warn-Glühen an Baum-Rändern (die keine Spikes tragen): ein WEICHER roter Verlauf,
// der an der Todeskante am kräftigsten ist und über DANGER_EDGE_BAND Welteinheiten
// ins Feld ausfädelt (kein harter Strich). ALPHA = Deckkraft direkt an der Kante bei
// maximaler Nähe.
const DANGER_EDGE_BAND = 70; // wie weit das Glühen senkrecht ins Feld reicht
// Das Glühen erfasst nicht die ganze Kante, sondern nur den Bereich NAHE der eigenen
// Schlange: ein Fleck, zentriert auf die Projektion des Spielers auf die Kante, der
// ENTLANG der Kante über DANGER_EDGE_REACH ausfädelt.
const DANGER_EDGE_REACH = 190;
const DANGER_EDGE_ALPHA = 0.85;
const DANGER_EDGE_RGB = "255, 30, 30";
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
// "Dash bereit"-Signal an der EIGENEN Schlange: ein pulsierender Gold-Schein rund um den
// Körper (Gold wie der bereite HUD-Ring). Blur pulsiert zwischen MIN und MAX; PULSE_MS ist
// die Dauer einer vollen Puls-Periode.
const SNAKE_DASH_READY_GLOW_COLOR = "#ffd700";
const SNAKE_DASH_READY_GLOW_BLUR_MIN = 3;
const SNAKE_DASH_READY_GLOW_BLUR_MAX = 12;
const SNAKE_DASH_READY_PULSE_MS = 900;
// Verjüngung zum Schwanzende hin (Breite des letzten Segments relativ zum Kopf)
// und Anzahl der Teilstücke, in die der Körper dafür zerlegt wird - mehr
// Segmente wirken glatter, kosten aber mehr Stroke-Aufrufe pro Schlange/Frame.
const SNAKE_TAIL_TAPER_FACTOR = 0.35;
const SNAKE_TAPER_SEGMENTS = 12;

// Todesanimation der EIGENEN Schlange: statt sofort "Game Over" LÖST sich der Körper
// von hinten nach vorn (Schwanz -> Kopf) in leuchtende Kugeln auf, die kurz aufpoppen
// und AN ORT UND STELLE liegen bleiben und am Ende sanft ausfaden - darunter liegt dann
// das echte Futter, das das Backend beim Tod ohnehin fallen lässt (die Schlange "wird"
// also zum liegenbleibenden Futter). Erst danach erscheint der Ergebnis-Screen (main.js
// verzögert das Overlay um DEATH_ANIM_MS). Rein clientseitig.
const DEATH_ANIM_MS = 1100; // Gesamtdauer der Animation
// Farb-Palette der Kugeln (nimmt das liegenbleibende Futter optisch vorweg).
const DEATH_ORB_COLORS = ["#ff6b6b", "#c07bff", "#5aa0ff", "#ffd166"];
const DEATH_ORB_RADIUS_FACTOR = 0.6; // Kugelgröße relativ zur lokalen Körperbreite
const DEATH_ORB_POP_MS = 150; // Dauer des Aufpopp-Impulses je Kugel (dann Einpendeln)
// Ab dieser Fraktion (0..1) faden die Kugeln aus - spät gesetzt, damit sie bis fast
// zum Ende hell bleiben und dann sauber ans echte Futter übergeben (das während der
// Animation ausgeblendet ist, siehe isInDeathZone in renderer.js).
const DEATH_ORB_FADE_START = 0.88;
// Wie stark die Auflöse-Front der Zeit vorauseilt, damit auch der Kopf klar vor Schluss
// verschwindet (>1 = Front erreicht den Kopf früher als t=1).
const DEATH_DISSOLVE_LEAD = 1.15;
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
