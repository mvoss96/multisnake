// Sprites werden pro Dateiname genau einmal geladen und zwischengespeichert
// (siehe frontend/assets/sprites/) - einfaches Preloading ohne Promise-Chain:
// Image-Objekte laden asynchron im Hintergrund, spriteReady() prüft .complete
// und der Aufrufer fällt bis dahin (bzw. wenn das aktive Theme die Rolle gar
// nicht themt) auf die Vektor-Darstellung zurück. Kein Build-Step nötig (CLAUDE.md).
const spriteCache = {};

function loadSprite(name) {
  if (!spriteCache[name]) {
    const img = new Image();
    img.src = `assets/sprites/${name}.png`;
    spriteCache[name] = img;
  }
  return spriteCache[name];
}

function spriteReady(img) {
  return !!img && img.complete && img.naturalWidth > 0;
}

// Rolle -> Sprite-Dateiname je Futter-Wertstufe (siehe THEMES.sprites in
// themes.js): Münze = 1, Edelstein = 2, Trank = 5. Ein zum Wert passender
// Sprite verrät damit direkt den Wert (siehe FOOD_*_VALUE_MULTIPLIER im Backend).
function foodSpriteRole(value) {
  if (value >= 5) return "foodTier3";
  if (value >= 2) return "foodTier2";
  return "foodTier1";
}

function foodRadius(value) {
  if (value >= 5) return FOOD_BIG_RADIUS;
  if (value >= 2) return FOOD_MEDIUM_RADIUS;
  return FOOD_RADIUS;
}

// Stabiler Pseudo-Zufallswert [0,1) pro Futter-ID - für eine feste, aber bunte Farbe je Stück.
function hashUnit(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 1000) / 1000;
}

function foodColor(food) {
  const hue = Math.floor(hashUnit(food.id) * 360);
  const lightness = food.value >= 5 ? 65 : food.value >= 2 ? 60 : 55;
  return `hsl(${hue}, 80%, ${lightness}%)`;
}

function createRenderer(canvas, initialThemeId) {
  const ctx = canvas.getContext("2d");
  // Canvas glättet drawImage()-Aufrufe standardmäßig - bei jedem Kameraschwenk
  // landen Sprites auf leicht unterschiedlichen Subpixel-Positionen, was durch
  // die Glättung als sichtbares "Flimmern" auffällt. Aus (harte Pixelkanten,
  // kein erneutes Weichzeichnen pro Frame) - passt zudem zum Pixel-Art-Look.
  ctx.imageSmoothingEnabled = false;
  let board = { width: 0, height: 0 };
  // Aktives Theme, umschaltbar zur Laufzeit (Design-Wahl im Namens-Modal,
  // siehe main.js) - alles Themebare geht über theme.sprites (siehe themes.js).
  let theme = getTheme(initialThemeId);
  // Canvas-Pattern pro Board-Tile-Sprite gecacht (createPattern ist teuer, das
  // Ergebnis theme-/sprite-stabil) - beim Theme-Wechsel greift automatisch der
  // Eintrag des neuen Sprites bzw. gar keiner (Default-Fläche).
  const patternCache = {};

  function setTheme(themeId) {
    theme = getTheme(themeId);
  }

  // Geladenes Sprite-Image für eine Theme-Rolle, oder null wenn das aktive
  // Theme diese Rolle nicht themt bzw. das Bild noch nicht geladen ist. Der
  // Aufrufer zeichnet bei null die Default-Vektor-Variante - das ist der Kern
  // von "jedes Theme themt nur, was es nennt, alles andere bleibt Default".
  function themedSprite(role) {
    const name = theme.sprites[role];
    if (!name) return null;
    const img = loadSprite(name);
    return spriteReady(img) ? img : null;
  }

  // Zeichengröße eines Sprites in Welteinheiten: Quellauflösung * PIXEL_UNIT.
  // Damit hat ein Sprite-Pixel bei JEDEM Sprite exakt dieselbe Größe (der Kern
  // des einheitlichen Pixel-Rasters). Sprites gibt es nur in gethemeten (Pixel-)
  // Themes, daher braucht das keine Theme-Abfrage.
  function spriteWorldSize(sprite) {
    return { w: sprite.naturalWidth * PIXEL_UNIT, h: sprite.naturalHeight * PIXEL_UNIT };
  }

  // Rastet einen Weltwert aufs Art-Pixel-Gitter (nur pixelPerfect-Themes) - so
  // sitzen alle Sprites auf demselben Texel-Gitter. Im Klassik-Theme unverändert.
  function snap(v) {
    return theme.pixelPerfect ? Math.round(v / PIXEL_UNIT) * PIXEL_UNIT : v;
  }

  function setBoard(width, height) {
    board = { width, height };
  }

  // Dynamischer Hintergrund fürs Classic-Theme (theme.dynamicBg): weiche Aurora-
  // Farbwolken + zwei Parallax-Sternenebenen. In Screen-Space gezeichnet (vor der
  // Welt-Transform); die Kamera verschiebt Wolken/Sterne leicht -> Tiefe/Weite.
  const auroraBlobs = AURORA_BLOB_COLORS.map((color, i) => ({
    color,
    cx: [0.25, 0.72, 0.5][i % 3],
    cy: [0.3, 0.35, 0.72][i % 3],
    phase: i * 2.1,
    period: 2600 + i * 900,
  }));
  let bgStars = null;
  function makeStars() {
    return STAR_LAYERS.map((cfg) => ({
      ...cfg,
      list: Array.from({ length: cfg.count }, () => ({
        x: Math.random(),
        y: Math.random(),
        tw: Math.random() * Math.PI * 2,
      })),
    }));
  }
  // Der Hintergrund ist KOMPLETT von der Kamera/Schlange entkoppelt (die Kamera fließt
  // hier bewusst NICHT ein): die Sterne driften rein über die Zeit stetig über den
  // Bildschirm (pro Ebene über layer.parallax unterschiedlich schnell = Tiefe), die
  // Aurora über ihren eigenen cos/sin-Drift. Schlangenbewegung verschiebt nichts davon.
  function drawDynamicBackground() {
    const W = canvas.width;
    const H = canvas.height;
    const t = performance.now();
    ctx.fillStyle = AURORA_BG_BASE;
    ctx.fillRect(0, 0, W, H);
    const R = Math.max(W, H) * AURORA_RADIUS_FACTOR;
    for (const b of auroraBlobs) {
      const bx = b.cx * W + Math.cos(t / b.period + b.phase) * W * AURORA_DRIFT;
      const by = b.cy * H + Math.sin(t / (b.period * 0.8) + b.phase) * H * AURORA_DRIFT;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, R);
      g.addColorStop(0, `rgba(${b.color}, ${AURORA_ALPHA})`);
      g.addColorStop(1, `rgba(${b.color}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (!bgStars) bgStars = makeStars();
    const starDriftX = t * STAR_AUTO_DRIFT_X;
    const starDriftY = t * STAR_AUTO_DRIFT_Y;
    for (const layer of bgStars) {
      for (const s of layer.list) {
        const sx = (((s.x * W - starDriftX * layer.parallax) % W) + W) % W;
        const sy = (((s.y * H - starDriftY * layer.parallax) % H) + H) % H;
        const tw = 0.6 + 0.4 * Math.sin(t / 700 + s.tw);
        ctx.fillStyle = `rgba(210, 220, 255, ${layer.alpha * tw})`;
        ctx.fillRect(sx, sy, layer.size, layer.size);
      }
    }
  }

  // Bereich AUSSERHALB des Spielfelds abdunkeln (nur dynamicBg-Themes): ein fast
  // deckendes Schwarz über alles, mit dem Board-Rechteck als "Loch" (even-odd) -
  // so bleibt der Aurora-Grund nur im Feld voll sichtbar, außenrum wird es fast
  // schwarz und das Spielfeld hebt sich klar ab. Wird in Welt-Koordinaten
  // gezeichnet (nach dem Kamera-Transform); die Außenkante deckt den ganzen
  // sichtbaren Ausschnitt (aus Kamera + Zoom hergeleitet) plus Reserve ab.
  function drawOutOfBoundsShade(camera, scale) {
    const halfW = canvas.width / (2 * scale);
    const halfH = canvas.height / (2 * scale);
    const pad = Math.max(halfW, halfH); // großzügige Reserve gegen Ränder beim Schwenk
    const left = camera.x - halfW - pad;
    const top = camera.y - halfH - pad;
    const w = 2 * (halfW + pad);
    const h = 2 * (halfH + pad);
    ctx.beginPath();
    ctx.rect(left, top, w, h); // äußeres Rechteck = sichtbarer Ausschnitt
    ctx.rect(0, 0, board.width, board.height); // inneres = Board (gegenläufig -> Loch)
    ctx.fillStyle = WORLD_OOB_SHADE;
    ctx.fill("evenodd");
  }

  // Statische Hindernisse (Felsen), einmalig aus der welcome-Nachricht gesetzt
  // (siehe main.js). Liste von { x, y, radius, kind }.
  let obstacles = [];
  function setObstacles(list) {
    obstacles = list || [];
  }

  // Felsen zeichnen: gethemetes Sprite (Pixel-Theme) aufs Texel-Raster gerastert,
  // sonst ein plastischer Vektor-Fels (Klassik) - klar als Hindernis erkennbar.
  function drawObstacles(camera) {
    const glowPhase = (performance.now() % SPIKE_GLOW_PERIOD_MS) / SPIKE_GLOW_PERIOD_MS;
    const pulse = 0.5 + 0.5 * Math.sin(glowPhase * Math.PI * 2);
    const sprite = themedSprite("rock");
    for (const o of obstacles) {
      // Steine sind tödlich -> rotes Warn-Glühen (Sprite-Schatten in Rot), wenn der
      // Spieler (Kamera ~ eigener Kopf) innerhalb des Gefahren-Radius ist.
      const dist = Math.max(0, Math.hypot(camera.x - o.x, camera.y - o.y) - o.radius);
      const proximity = Math.max(0, 1 - dist / SPIKE_GLOW_PROXIMITY);
      if (proximity > 0) {
        ctx.shadowColor = SPIKE_GLOW_COLOR;
        ctx.shadowBlur = proximity * (SPIKE_GLOW_BLUR_MIN + (SPIKE_GLOW_BLUR_MAX - SPIKE_GLOW_BLUR_MIN) * pulse);
      } else {
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
      }
      if (!sprite) {
        drawVectorRock(o.x, o.y, o.radius);
        continue;
      }
      const nw = sprite.naturalWidth;
      const nh = sprite.naturalHeight;
      let w, h;
      if (theme.pixelPerfect) {
        // Pixelperfekt & einheitlich: FESTER Integer-Faktor (nicht radius-abhängig)
        // -> jedes Art-Pixel = ROCK_PIXEL_SCALE Texel, alle Felsen exakt gleich groß,
        // aufs Gitter gesnappt; imageSmoothing=false = harte Kanten, kein Skalieren.
        w = nw * ROCK_PIXEL_SCALE * PIXEL_UNIT;
        h = nh * ROCK_PIXEL_SCALE * PIXEL_UNIT;
      } else {
        // Klassik (kein Pixel-Raster): Sprite schlicht auf den Durchmesser skalieren.
        const d = 2 * o.radius * ROCK_SPRITE_SCALE;
        const m = Math.max(nw, nh);
        w = d * (nw / m);
        h = d * (nh / m);
      }
      ctx.drawImage(sprite, snap(o.x - w / 2), snap(o.y - h / 2), w, h);
    }
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  // Plastischer Fels für Vektor-Themes: Bodenschatten (erdet ihn), dunkle Kontur
  // + heller Reflex oben-links -> liest sich als solider Brocken, nicht als Blob.
  function drawVectorRock(x, y, r) {
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.6, r * 0.95, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = ROCK_FILL_COLOR;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ROCK_STROKE_COLOR;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.34, r * 0.4, r * 0.28, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = ROCK_HIGHLIGHT_COLOR;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function resizeToWindow() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  // viewWorldHeight ist nicht mehr konstant - main.js interpoliert sie anhand der
  // eigenen Schlangenlänge zwischen VIEW_WORLD_HEIGHT_MIN/MAX (siehe config.js) und
  // reicht sie pro Frame durch, damit die Kamera beim Wachsen rauszoomt.
  // Auf schmalen Hochformat-Viewports (Handys) wäre die Höhen-Skalierung allein zu
  // weit reingezoomt in der Breite (man sieht seitlich kaum etwas) - die
  // Mindest-Weltbreite MIN_VISIBLE_WORLD_WIDTH verhindert das. Anders als ein
  // klassisches Letterboxing wird dabei aber nicht mit schwarzen Balken auf die
  // Ziel-Vertikal-FOV zurückgeschnitten (füllte den Bildschirm nicht mehr aus,
  // sah auf Mobile wie ein kleiner Ausschnitt aus) - stattdessen zeigt der Canvas
  // in diesem Fall einfach mehr Welt in der Höhe als viewWorldHeight (voller
  // Bildschirm ausgenutzt, keine Balken).
  function worldScale(viewWorldHeight) {
    const heightScale = canvas.height / viewWorldHeight;
    const widthScale = canvas.width / MIN_VISIBLE_WORLD_WIDTH;
    return Math.min(heightScale, widthScale);
  }

  // Das Muster beginnt mit einem festen Rand (SPIKE_CORNER_MARGIN) statt
  // direkt mit einem Spike, damit jede Ecke symmetrisch in einer Lücke liegt.
  // Die Spike-Zwischenräume werden minimal angepasst (statt starr bei
  // SPIKE_SPACING zu bleiben), damit SPIKE_CORNER_MARGIN frei wählbar ist und
  // trotzdem exakt aufgeht - der Unterschied ist bei wenigen Prozent nicht
  // sichtbar, wirkt aber nicht mehr in 15er-Sprüngen gequantelt.
  function drawSpikeRow(x1, y1, x2, y2, normalX, normalY) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    const dirX = dx / length;
    const dirY = dy / length;
    const spikeWidth = SPIKE_SPACING * 0.8;
    const margin = SPIKE_CORNER_MARGIN;
    const count = Math.max(1, Math.round((length - 2 * margin) / SPIKE_SPACING));
    const step = count > 1 ? (length - 2 * margin - spikeWidth) / (count - 1) : 0;

    const spikeSprite = themedSprite("spike");
    // Sprite zeigt per Default nach oben (negative lokale Y-Achse) - dieser Winkel
    // dreht ihn so, dass die Spitze in Richtung der jeweiligen Rand-Normalen zeigt.
    const angle = Math.atan2(normalX, -normalY);
    // Größe aus der Quellauflösung * PIXEL_UNIT (einheitliches Texel-Raster).
    const spriteSize = spikeSprite ? spriteWorldSize(spikeSprite) : { w: 0, h: 0 };
    const spriteW = spriteSize.w;
    const spriteH = spriteSize.h;

    if (!spikeSprite) {
      ctx.fillStyle = SPIKE_FILL_COLOR;
      ctx.strokeStyle = SPIKE_STROKE_COLOR;
      ctx.lineWidth = 1;
    }

    for (let i = 0; i < count; i++) {
      const offset = margin + step * i;
      const baseX1 = x1 + dirX * offset;
      const baseY1 = y1 + dirY * offset;
      const baseX2 = baseX1 + dirX * spikeWidth;
      const baseY2 = baseY1 + dirY * spikeWidth;
      const midX = (baseX1 + baseX2) / 2;
      const midY = (baseY1 + baseY2) / 2;

      if (spikeSprite) {
        ctx.save();
        ctx.translate(snap(midX), snap(midY));
        ctx.rotate(angle);
        // Basis (breites Ende) liegt am Rand (lokal y=0), Spitze ragt ins Feld (lokal y=-spriteH).
        ctx.drawImage(spikeSprite, -spriteW / 2, -spriteH, spriteW, spriteH);
        ctx.restore();
      } else {
        const tipX = midX + normalX * SPIKE_SIZE;
        const tipY = midY + normalY * SPIKE_SIZE;
        ctx.beginPath();
        ctx.moveTo(baseX1, baseY1);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(baseX2, baseY2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // Ränder, an denen die borderSprite-Deko steht (leer, wenn das Theme keine
  // borderSprite-Rolle themt). Default ["top"], wenn borderEdges fehlt.
  function borderEdges() {
    if (!themedSprite("borderSprite")) return [];
    return theme.borderEdges || ["top"];
  }

  // Wie weit das Boden-Tile über einen Baum-Rand hinausragen muss, damit die
  // Kronen nirgends über die harte Kante des Fülls hinausragen (sonst wird die
  // Fläche dahinter als sichtbare gerade Kante sichtbar - siehe Bug bei einem
  // festen 32px-Wert). Rechnerisch aus der tatsächlichen Sprite-Geometrie
  // hergeleitet statt geschätzt, damit das bei jeder TREE_*-Anpassung stimmt.
  function treeOverhang() {
    const tree = themedSprite("borderSprite");
    if (!tree) return 0;
    const { w: wMax, h: hMax } = spriteWorldSize(tree);
    return Math.max(hMax, wMax) - TREE_FOOT_INSET + TREE_OVERHANG_MARGIN;
  }

  // Der Boden-Überhang (treeOverhang()) hat selbst wieder eine feste
  // Außenkante zum schwarzen Canvas-Hintergrund - bei starkem Rauszoomen
  // (hoher Score) nimmt diese auf dem Bildschirm mehr Raum ein und die harte
  // Linie fällt erneut auf. Ein weicher Verlauf (Waldboden verschwindet im
  // Dunkel statt hart aufzuhören) behebt das bei jeder Zoomstufe. Wird direkt
  // auf den bereits gefüllten Überhang gemalt, vor den Bäumen (die darüber
  // gezeichnet werden und so "aus dem Nebel auftauchen").
  function drawEdgeFade(edge, overhang) {
    const start = overhang * BORDER_FADE_START_FACTOR;
    const end = overhang * BORDER_FADE_END_FACTOR;
    const bg = "5, 5, 8"; // muss zur Canvas-Hintergrundfarbe (#050508) passen
    let grad;
    if (edge === "top") {
      grad = ctx.createLinearGradient(0, -start, 0, -end);
    } else if (edge === "bottom") {
      grad = ctx.createLinearGradient(0, board.height + start, 0, board.height + end);
    } else if (edge === "left") {
      grad = ctx.createLinearGradient(-start, 0, -end, 0);
    } else {
      grad = ctx.createLinearGradient(board.width + start, 0, board.width + end, 0);
    }
    grad.addColorStop(0, `rgba(${bg}, 0)`);
    grad.addColorStop(1, `rgba(${bg}, 1)`);
    ctx.fillStyle = grad;
    // Breit genug über den Rand hinaus, damit auch die Ecken (wo zwei
    // Überhänge sich treffen) vollständig abgedeckt sind.
    const pad = end + TREE_SPACING;
    if (edge === "top") {
      ctx.fillRect(-pad, -end, board.width + pad * 2, end - start);
    } else if (edge === "bottom") {
      ctx.fillRect(-pad, board.height + start, board.width + pad * 2, end - start);
    } else if (edge === "left") {
      ctx.fillRect(-end, -pad, end - start, board.height + pad * 2);
    } else {
      ctx.fillRect(board.width + start, -pad, end - start, board.height + pad * 2);
    }
  }

  // Aufrechte Deko-Bäume entlang eines Kartenrands (nur Themes mit borderSprite):
  // die Stämme stehen etwas ins Feld versetzt (TREE_FOOT_INSET) auf dem Boden,
  // die Krone ragt nach oben. Rein optisch (keine Kollision). Leichter Höhen-/
  // Tiefen-Versatz je Baum + Zeichnen von hinten nach vorn (nach Stammfuß-y)
  // ergibt eine unregelmäßige Wald-Silhouette statt gleichförmiger Schindeln.
  // Die Bäume bleiben an jedem Rand aufrecht (nicht gedreht) - so wirkt es an
  // allen Seiten wie eine natürliche Waldkante.
  // Rotes Warn-Glühen an ALLEN tödlichen Kanten (Baum- wie Spike-Ränder). Wird VOR
  // Bäumen UND Spikes gezeichnet, sodass die (später gezeichneten) Bäume/Spikes
  // darüber liegen; es startet an der Board-Kante (y/x=0) und fädelt über
  // DANGER_EDGE_BAND ins Feld aus - so quillt das Rot hinter dem Rand-Deko hervor und
  // läuft ins Feld aus. Intensität steigt mit der Nähe (Puls). Ersetzt das frühere
  // Eigenglühen der Spikes.
  function drawEdgeDangerGlow(camera) {
    const glowPhase = (performance.now() % SPIKE_GLOW_PERIOD_MS) / SPIKE_GLOW_PERIOD_MS;
    const pulse = 0.5 + 0.5 * Math.sin(glowPhase * Math.PI * 2);
    // Ein lokaler, elliptischer Glüh-Fleck, zentriert auf die Projektion des Spielers
    // (Kamera ~ eigener Kopf) auf die Kante. horizontal = Kante verläuft entlang x
    // (oben/unten); perpSign = Richtung ins Feld (+/-). Halbachsen: entlang der Kante
    // DANGER_EDGE_REACH, senkrecht ins Feld DANGER_EDGE_BAND. Über ein anisotropes
    // scale() wird ein Einheits-Radialverlauf zur passenden Ellipse. distance =
    // senkrechter Abstand des Spielers zur Kante (steuert die Gesamt-Deckkraft).
    function spot(centerX, centerY, horizontal, perpSign, alongPos, distance) {
      const proximity = Math.max(0, 1 - distance / SPIKE_GLOW_PROXIMITY);
      if (proximity <= 0) return;
      const alpha = proximity * DANGER_EDGE_ALPHA * (0.75 + 0.25 * pulse);
      ctx.save();
      if (horizontal) {
        ctx.translate(alongPos, centerY);
        ctx.scale(DANGER_EDGE_REACH, DANGER_EDGE_BAND * perpSign);
      } else {
        ctx.translate(centerX, alongPos);
        ctx.scale(DANGER_EDGE_BAND * perpSign, DANGER_EDGE_REACH);
      }
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(${DANGER_EDGE_RGB}, ${alpha})`);
      g.addColorStop(1, `rgba(${DANGER_EDGE_RGB}, 0)`);
      ctx.fillStyle = g;
      // Nur die ins Feld weisende Hälfte der Ellipse füllen (die andere liegt hinter
      // der Kante und würde ohnehin von Bäumen/Spikes verdeckt).
      if (horizontal) ctx.fillRect(-1, 0, 2, 1);
      else ctx.fillRect(0, -1, 1, 2);
      ctx.restore();
    }
    spot(0, 0, true, 1, camera.x, camera.y); // oben
    spot(0, board.height, true, -1, camera.x, board.height - camera.y); // unten
    spot(0, 0, false, 1, camera.y, camera.x); // links
    spot(board.width, 0, false, -1, camera.y, board.width - camera.x); // rechts
  }

  function drawBorderTrees() {
    const tree = themedSprite("borderSprite");
    if (!tree) return;
    // Größe aus der Quellauflösung * PIXEL_UNIT (gemeinsames Texel-Raster).
    const { w, h } = spriteWorldSize(tree);
    const edges = borderEdges();

    // Stammfuß-Positionen je Rand sammeln (Achse = entlang des Rands, footInset
    // = senkrecht ins Feld). "top"/"bottom" reihen entlang x, "left"/"right"
    // entlang y. Alle Bäume stehen bewusst auf exakt derselben Höhe/Tiefe (kein
    // Höhen-/Tiefen-Jitter); nur ein kleiner Versatz ENTLANG des Rands lockert
    // die Reihe auf. Jeder Baum bekommt zusätzlich einen zufälligen z-Wert, der
    // ausschließlich die Zeichenreihenfolge steuert (siehe Sortierung unten).
    const trees = [];
    for (const edge of edges) {
      const horizontal = edge === "top" || edge === "bottom";
      const along = horizontal ? board.width : board.height;
      // An Ecken, die von einer zweiten Baum-Kante belegt sind, den Anfang/das
      // Ende der Seiten-Reihe aussparen, damit sich nicht zwei Bäume exakt in
      // der Ecke stapeln (die waagerechte Kante "besitzt" dort die Ecke).
      let startS = 0;
      let endS = along;
      if (edge === "left" || edge === "right") {
        if (edges.includes("top")) startS = TREE_SPACING;
        if (edges.includes("bottom")) endS = along - TREE_SPACING;
      }
      for (let i = 0, s = startS; s <= endS; i++, s += TREE_SPACING) {
        const r = hashUnit(edge + "t" + i);
        const z = hashUnit(edge + "z" + i); // nur Zeichenreihenfolge
        const jit = (r - 0.5) * TREE_SPACING * TREE_ALONG_JITTER_FACTOR;
        let footX;
        let footY;
        if (edge === "top") {
          footX = s + jit;
          footY = TREE_FOOT_INSET;
        } else if (edge === "bottom") {
          footX = s + jit;
          footY = board.height - TREE_FOOT_INSET;
        } else if (edge === "left") {
          // Bäume bleiben aufrecht; um sie an den Rand zu rücken (nicht mittig
          // ins Feld), wird der Stamm um die halbe Breite nach außen versetzt,
          // sodass die Kronen-Feldkante bei TREE_FOOT_INSET liegt (wie oben).
          footX = TREE_FOOT_INSET - w / 2;
          footY = s + jit;
        } else {
          footX = board.width - TREE_FOOT_INSET + w / 2;
          footY = s + jit;
        }
        trees.push({ footX, footY, w, h, z });
      }
    }
    // Zeichenreihenfolge: PRIMÄR nach footY (tiefer stehende Bäume zuletzt =
    // vorn). Das ist an vertikalen Rändern (links/rechts, Bäume übereinander)
    // zwingend, sonst malt der Stamm eines höher stehenden Baums über die Krone
    // des tieferen (der auffällige "Stamm schwebt auf Laub"-Fehler). An der
    // waagerechten Reihe (oben) haben alle Bäume dasselbe footY -> der Vergleich
    // ist dort immer 0 und der zufällige z-Wert entscheidet als Tiebreaker, sodass
    // die Überlappung dort nicht gleichförmig rechts-vor-links läuft.
    trees.sort((a, b) => a.footY - b.footY || a.z - b.z);

    for (const t of trees) {
      // Weicher Bodenschatten am Stammfuß (radialer Verlauf, gestaucht zur
      // Ellipse) - vor dem Baum gezeichnet, damit der Stamm darüber liegt.
      const shadowR = t.w * TREE_SHADOW_WIDTH_FACTOR;
      ctx.save();
      ctx.translate(t.footX, t.footY + TREE_SHADOW_DROP);
      ctx.scale(1, TREE_SHADOW_FLATNESS);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowR);
      grad.addColorStop(0, `rgba(0, 0, 0, ${TREE_SHADOW_ALPHA})`);
      grad.addColorStop(0.55, `rgba(0, 0, 0, ${TREE_SHADOW_ALPHA * 0.8})`);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, shadowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.drawImage(tree, snap(t.footX - t.w / 2), snap(t.footY - t.h), t.w, t.h);
    }
  }

  function drawBoundary(camera) {
    // An Rändern mit Baum-Deko bilden die Bäume die Kante - dort keine Spikes und
    // keine graue Rahmenlinie (die würde zwischen den Stämmen als harte Kante
    // auffallen). Die restlichen Ränder bleiben Spikes.
    const edges = borderEdges();
    const treed = (e) => edges.includes(e);

    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2;
    // Rahmenlinie nur an Kanten ohne Baum-Deko ziehen.
    ctx.beginPath();
    if (!treed("top")) { ctx.moveTo(0, 0); ctx.lineTo(board.width, 0); }
    if (!treed("bottom")) { ctx.moveTo(0, board.height); ctx.lineTo(board.width, board.height); }
    if (!treed("left")) { ctx.moveTo(0, 0); ctx.lineTo(0, board.height); }
    if (!treed("right")) { ctx.moveTo(board.width, 0); ctx.lineTo(board.width, board.height); }
    ctx.stroke();

    // Spikes ohne Eigenglühen zeichnen - die Gefahren-Warnung übernimmt jetzt
    // einheitlich das rote Kanten-Glühen (drawEdgeDangerGlow, unter den Spikes).
    if (!treed("top")) drawSpikeRow(0, 0, board.width, 0, 0, 1);
    if (!treed("bottom")) drawSpikeRow(0, board.height, board.width, board.height, 0, -1);
    if (!treed("left")) drawSpikeRow(0, 0, 0, board.height, 1, 0);
    if (!treed("right")) drawSpikeRow(board.width, 0, board.width, board.height, -1, 0);
  }

  // Breite/Radius am Punkt-Index i (0 = Kopf, n-1 = Schwanzende) unter
  // Berücksichtigung der Verjüngung - von drawTaperedBody und den
  // Muster-Zeichenfunktionen gemeinsam genutzt, damit Streifen/Punkte mit
  // der tatsächlichen Körperbreite an ihrer Position mitschrumpfen.
  function taperFactorAt(index, n) {
    const t = index / (n - 1); // 0 am Kopf, 1 am Schwanzende
    return 1 - t * (1 - SNAKE_TAIL_TAPER_FACTOR);
  }

  // Zeichnet den Körperpfad in mehreren Teilstücken mit zum Schwanz hin
  // abnehmender Linienbreite - eine einzelne stroke()-Anweisung kann keine
  // variable Breite entlang eines Pfads, daher die Aufteilung in Segmente.
  function drawTaperedBody(points, maxWidth, strokeStyle, alpha) {
    const n = points.length;
    const segCount = Math.max(1, Math.min(SNAKE_TAPER_SEGMENTS, n - 1));
    const pointsPerSegment = Math.ceil((n - 1) / segCount);
    ctx.strokeStyle = strokeStyle;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    for (let s = 0; s < segCount; s++) {
      const startIdx = s * pointsPerSegment;
      if (startIdx >= n - 1) break;
      const endIdx = Math.min(n - 1, startIdx + pointsPerSegment);
      const midIdx = (startIdx + endIdx) / 2;
      ctx.lineWidth = maxWidth * taperFactorAt(midIdx, n);
      ctx.beginPath();
      ctx.moveTo(points[startIdx][0], points[startIdx][1]);
      for (let i = startIdx + 1; i <= endIdx; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.stroke();
    }
    if (alpha !== undefined) ctx.globalAlpha = 1;
  }

  // Zeichnet die optionale Oberflächen-Textur ("stripes"/"dots") auf den
  // bereits gezeichneten Körper - "solid" braucht keine Zusatzzeichnung.
  function drawSnakePattern(snake, points) {
    const n = points.length;
    if (n < 2 || snake.pattern === "solid") return;
    const interval = SNAKE_PATTERN_POINT_INTERVAL;

    if (snake.pattern === "stripes") {
      ctx.strokeStyle = SNAKE_STRIPE_COLOR;
      ctx.lineWidth = SNAKE_STRIPE_WIDTH;
      for (let i = interval; i < n - 1; i += interval) {
        const localRadius = snake.radius * taperFactorAt(i, n);
        const [x1, y1] = points[i - 1];
        const [x2, y2] = points[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const perpX = (-(y2 - y1) / len) * localRadius;
        const perpY = ((x2 - x1) / len) * localRadius;
        const [px, py] = points[i];
        ctx.beginPath();
        ctx.moveTo(px + perpX, py + perpY);
        ctx.lineTo(px - perpX, py - perpY);
        ctx.stroke();
      }
    } else if (snake.pattern === "dots") {
      ctx.fillStyle = SNAKE_DOT_COLOR;
      for (let i = interval; i < n - 1; i += interval) {
        const localRadius = snake.radius * taperFactorAt(i, n);
        const [px, py] = points[i];
        ctx.beginPath();
        ctx.arc(px, py, localRadius * SNAKE_DOT_RADIUS_FACTOR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Geschuppter/segmentierter Look (nur Themes mit snakeScales, siehe themes.js):
  // dichte, quer über den Körper laufende, leicht nach vorn gebogene dunkle
  // Rillen. Halbtransparentes Schwarz statt eingefärbter Linien - liegt damit als
  // "Fuge" auf jeder Spielerfarbe, ohne snake.color parsen zu müssen. Die Rillen
  // schrumpfen über taperFactorAt mit der tatsächlichen Körperbreite mit.
  function drawSnakeScales(snake, points) {
    const n = points.length;
    if (n < 3) return;
    ctx.strokeStyle = SNAKE_SCALE_COLOR;
    ctx.lineWidth = SNAKE_SCALE_WIDTH;
    ctx.lineCap = "round";
    for (let i = SNAKE_SCALE_POINT_INTERVAL; i < n - 1; i += SNAKE_SCALE_POINT_INTERVAL) {
      const localRadius = snake.radius * taperFactorAt(i, n);
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const dirX = (x2 - x1) / len;
      const dirY = (y2 - y1) / len;
      const perpX = -dirY * localRadius;
      const perpY = dirX * localRadius;
      const [px, py] = points[i];
      // leichte Vorwärts-Wölbung (Chevron): Mittelpunkt der Rille sitzt einen
      // Tick in Blickrichtung vor der Querlinie -> "Schuppen"-Anmutung statt Leiter.
      const bowX = dirX * localRadius * 0.35;
      const bowY = dirY * localRadius * 0.35;
      ctx.beginPath();
      ctx.moveTo(px + perpX, py + perpY);
      ctx.quadraticCurveTo(px + bowX, py + bowY, px - perpX, py - perpY);
      ctx.stroke();
    }
  }

  function drawCrown(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#ffd700";
    ctx.strokeStyle = "#8a6d00";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-10, 5);
    ctx.lineTo(-10, -3);
    ctx.lineTo(-5, 3);
    ctx.lineTo(0, -8);
    ctx.lineTo(5, 3);
    ctx.lineTo(10, -3);
    ctx.lineTo(10, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function draw(state, camera, viewWorldHeight) {
    const scale = worldScale(viewWorldHeight);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    // Screen-Space-Hintergrund: dynamische Aurora (Classic) oder flache Fläche.
    if (theme.dynamicBg) {
      drawDynamicBackground();
    } else {
      ctx.fillStyle = "#050508";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (theme.pixelPerfect) {
      // Pixel-Art-Raster: Kamera-Offset auf ganze Pixel runden (pixelweiser Schwenk,
      // kein Subpixel-Drift/Flimmern), aber die SKALIERUNG kontinuierlich lassen -
      // ein früheres Runden auf ganze Texel-Pixel machte den Zoom stufig statt smooth.
      // Der harte Pixel-Look kommt weiterhin aus imageSmoothingEnabled=false.
      const ox = Math.round(canvas.width / 2 - camera.x * scale);
      const oy = Math.round(canvas.height / 2 - camera.y * scale);
      ctx.setTransform(scale, 0, 0, scale, ox, oy);
    } else {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-camera.x, -camera.y);
    }

    // Board-Fläche: gekacheltes Tile-Sprite, wenn das aktive Theme die Rolle
    // "boardTile" themt (und geladen ist), sonst die einfarbige Default-Fläche.
    const boardTile = themedSprite("boardTile");
    const boardTileName = theme.sprites.boardTile;
    if (boardTile && !patternCache[boardTileName]) {
      const pat = ctx.createPattern(boardTile, "repeat");
      // Kachel aufs Art-Pixel-Raster skalieren (Kachel = naturalSize * PIXEL_UNIT
      // world), statt implizit 1:1 world-pro-Quellpixel - sonst wären Boden-Pixel
      // viel größer als alle anderen Sprite-Pixel.
      if (pat && theme.pixelPerfect && pat.setTransform) {
        pat.setTransform(new DOMMatrix([PIXEL_UNIT, 0, 0, PIXEL_UNIT, 0, 0]));
      }
      patternCache[boardTileName] = pat;
    }
    // Board-Fläche nur füllen, wenn KEIN dynamischer Hintergrund aktiv ist - sonst
    // soll die Aurora durch das ganze Feld scheinen (nicht von #14141e verdeckt).
    if (!theme.dynamicBg) {
      ctx.fillStyle = (boardTile && patternCache[boardTileName]) || "#14141e";
      // An Rändern mit Baum-Deko zieht das Boden-Tile hinter der Reihe etwas über
      // die Kante hinaus (treeOverhang(), aus der Sprite-Geometrie hergeleitet),
      // damit die harte Bodenkante hinter den Kronen verschwindet statt als Linie
      // zwischen/neben den Bäumen sichtbar zu sein.
      const edges = borderEdges();
      const overhang = treeOverhang();
      const oT = edges.includes("top") ? overhang : 0;
      const oB = edges.includes("bottom") ? overhang : 0;
      const oL = edges.includes("left") ? overhang : 0;
      const oR = edges.includes("right") ? overhang : 0;
      ctx.fillRect(-oL, -oT, board.width + oL + oR, board.height + oT + oB);
      // Weicher Verlauf am Außenrand des Überhangs statt Hart-Schnitt - bleibt
      // sonst bei starkem Rauszoomen (hoher Score) wieder als Kante sichtbar.
      for (const edge of edges) {
        drawEdgeFade(edge, overhang);
      }
    }

    // Außerhalb des Felds abdunkeln, bevor Rand/Spikes/Deko darüber gezeichnet
    // werden (die bleiben so voll sichtbar).
    if (theme.dynamicBg) {
      drawOutOfBoundsShade(camera, scale);
    }

    drawEdgeDangerGlow(camera); // rotes Kanten-Glühen UNTER Bäume/Spikes (die liegen drüber)
    drawBorderTrees();
    drawBoundary(camera);
    drawObstacles(camera);

    const blinkPhase = (performance.now() % FOOD_BLINK_PERIOD_MS) / FOOD_BLINK_PERIOD_MS;
    const blinkAlpha = FOOD_BLINK_MIN_ALPHA + (1 - FOOD_BLINK_MIN_ALPHA) * (0.5 + 0.5 * Math.sin(blinkPhase * Math.PI * 2));
    for (const food of state.food) {
      // Während der eigenen Todesanimation das echte (schon gedroppte) Futter im
      // Todesbereich ausblenden - dort stehen die Auflöse-Kugeln dafür ein; erst nach
      // der Animation erscheint das Futter, sodass es nicht "vorher" auftaucht.
      if (isInDeathZone(food.x, food.y)) continue;
      const life = food.life ?? 1;
      const blinkFactor = life < FOOD_BLINK_START_LIFE ? blinkAlpha : 1;
      const fadeAlpha = life >= FOOD_FADE_START_LIFE
        ? FOOD_DEFAULT_ALPHA
        : FOOD_FADE_MIN_ALPHA + (FOOD_DEFAULT_ALPHA - FOOD_FADE_MIN_ALPHA) * (life / FOOD_FADE_START_LIFE);
      ctx.globalAlpha = blinkFactor * fadeAlpha;
      const sprite = themedSprite(foodSpriteRole(food.value));
      if (sprite) {
        // Größe aus der Sprite-Quellauflösung * PIXEL_UNIT (einheitliches Raster);
        // die Stufengröße steckt in der nativen Auflösung der Futter-PNGs. radius
        // dient nur noch als Bezug für Schwebehöhe/Schatten.
        const radius = foodRadius(food.value);
        const { w, h } = spriteWorldSize(sprite);
        // Sanftes Schweben (siehe FOOD_BOB_* in config.js): wave 0..1 pro Frame,
        // entkoppelt über eine feste Phase je Futter-ID. lift = Höhe über dem
        // echten Bodenpunkt food.y (nach oben = -y).
        const phase = hashUnit(food.id);
        const wave =
          0.5 +
          0.5 * Math.sin((performance.now() / FOOD_BOB_PERIOD_MS + phase) * Math.PI * 2);
        const lift = radius * (FOOD_BOB_BASE_LIFT_FACTOR + FOOD_BOB_AMPLITUDE_FACTOR * wave);

        // Kontakt-Schatten am echten Bodenpunkt (food.y): schrumpft/verblasst
        // leicht, je höher das Sprite schwebt - hebt es von der Textur ab. Der
        // Grund-Alpha (Blink/Fade) wird eingerechnet und danach wiederhergestellt.
        const baseAlpha = ctx.globalAlpha;
        const shadowW = w * FOOD_SHADOW_WIDTH_FACTOR * (1 - FOOD_SHADOW_LIFT_SHRINK * wave);
        ctx.globalAlpha = baseAlpha * FOOD_SHADOW_ALPHA * (1 - FOOD_SHADOW_LIFT_FADE * wave);
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(food.x, food.y, shadowW / 2, (shadowW / 2) * FOOD_SHADOW_FLATNESS, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = baseAlpha;

        // Zeichen-Ecke aufs Art-Pixel-Gitter rasten (w/h sind bereits Vielfache
        // von PIXEL_UNIT) - so sitzt jedes Futter pixelgenau auf demselben Raster.
        ctx.drawImage(sprite, snap(food.x - w / 2), snap(food.y - lift - h / 2), w, h);
      } else {
        ctx.fillStyle = foodColor(food);
        ctx.beginPath();
        ctx.arc(food.x, food.y, foodRadius(food.value), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    let leader = null;
    for (const snake of state.snakes) {
      if (snake.score > 0 && (!leader || snake.score > leader.score)) leader = snake;
    }

    for (const snake of state.snakes) {
      const points = snake.points;
      if (points.length === 0) continue;
      const isMe = snake.player_id === GameState.playerId;
      const [hx, hy] = points[0];

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Dash-Schein um den Körper: blau während des Dashs, ODER pulsierendes Gold an der
      // eigenen Schlange, solange der Dash aufgeladen/bereit ist (Signal "jetzt möglich").
      const dashReady = isMe && !snake.dashing && snake.dash_charge >= 1;
      let dashGlow = false;
      if (snake.dashing) {
        ctx.shadowColor = SNAKE_DASH_GLOW_COLOR;
        ctx.shadowBlur = SNAKE_DASH_GLOW_BLUR;
        dashGlow = true;
      } else if (dashReady) {
        const pulse = 0.5 + 0.5 * Math.sin((performance.now() / SNAKE_DASH_READY_PULSE_MS) * Math.PI * 2);
        ctx.shadowColor = SNAKE_DASH_READY_GLOW_COLOR;
        ctx.shadowBlur =
          SNAKE_DASH_READY_GLOW_BLUR_MIN +
          pulse * (SNAKE_DASH_READY_GLOW_BLUR_MAX - SNAKE_DASH_READY_GLOW_BLUR_MIN);
        dashGlow = true;
      }

      // Schlangen sind in beiden Themes farbecht-Vektor (server-zugewiesene
      // Spielerfarbe), keine festfarbigen Sprites. Kontur, Körper und ein
      // dezenter heller Glanzstreifen - alle verjüngen sich zum Schwanz hin.
      // Themes mit snakeScales (siehe themes.js) bekommen zusätzlich eine
      // dickere Kontur + prozedurale Schuppen-Rillen (Mockup-Look), ohne die
      // Farbechtheit aufzugeben.
      const scaled = !!theme.snakeScales;
      const outlineWidth = scaled ? SNAKE_SCALE_OUTLINE_WIDTH : SNAKE_OUTLINE_WIDTH;
      drawTaperedBody(points, snake.radius * 2 + outlineWidth * 2, SNAKE_OUTLINE_COLOR);
      drawTaperedBody(points, snake.radius * 2, snake.color);
      if (scaled) drawSnakeScales(snake, points);
      drawTaperedBody(points, snake.radius * 2 * SNAKE_SHINE_WIDTH_FACTOR, "#ffffff", SNAKE_SHINE_ALPHA);
      drawSnakePattern(snake, points);

      if (dashGlow) {
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
      }

      // Augen in Blickrichtung statt eines mittigen Punkts - Pupille leicht
      // nach vorn versetzt, damit die Schlange erkennbar "in eine Richtung schaut".
      const eyeRadius = snake.radius * SNAKE_EYE_RADIUS_FACTOR;
      const pupilRadius = snake.radius * SNAKE_PUPIL_RADIUS_FACTOR;
      const forwardX = Math.cos(snake.direction) * snake.radius * SNAKE_EYE_FORWARD_OFFSET;
      const forwardY = Math.sin(snake.direction) * snake.radius * SNAKE_EYE_FORWARD_OFFSET;
      const perpAngle = snake.direction + Math.PI / 2;
      const sideX = Math.cos(perpAngle) * snake.radius * SNAKE_EYE_SIDE_OFFSET;
      const sideY = Math.sin(perpAngle) * snake.radius * SNAKE_EYE_SIDE_OFFSET;
      const pupilForwardX = Math.cos(snake.direction) * eyeRadius * 0.4;
      const pupilForwardY = Math.sin(snake.direction) * eyeRadius * 0.4;

      for (const side of [1, -1]) {
        const eyeX = hx + forwardX + sideX * side;
        const eyeY = hy + forwardY + sideY * side;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(eyeX, eyeY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.beginPath();
        ctx.arc(eyeX + pupilForwardX, eyeY + pupilForwardY, pupilRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isMe) {
        ctx.strokeStyle = "#ffd700";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, snake.radius + 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Label über dem Kopf: oben die Punktzahl (größer, weil wichtiger als der Name),
      // darunter der kleinere Name - beide in Spielerfarbe. Im Pixel-Theme die Pixel-Font (muss
      // geladen sein, siehe document.fonts.load in main.js), sonst System-Font; Position
      // gesnappt. Score liegt ÜBER dem Namen, damit ihn beim Anführer die Krone (knapp
      // über dem Kopf) nicht verdeckt.
      const isPixelFont = theme.pixelPerfect;
      ctx.textAlign = "center";
      const labelX = snap(hx);
      const nameY = snap(hy - snake.radius - 12);
      const scoreY = snap(nameY - (isPixelFont ? 12 : 14));
      const drawLabelLine = (text, y, font, fill) => {
        ctx.font = font;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
        ctx.lineWidth = 3;
        ctx.strokeText(text, labelX, y);
        ctx.fillStyle = fill;
        ctx.fillText(text, labelX, y);
      };
      drawLabelLine(
        String(snake.score),
        scoreY,
        isPixelFont ? 'bold 11px "PixelFont", monospace' : "bold 13px sans-serif",
        snake.color
      );
      drawLabelLine(
        snake.name,
        nameY,
        isPixelFont ? 'bold 7px "PixelFont", monospace' : "bold 9px sans-serif",
        snake.color
      );

      if (leader && snake.id === leader.id) {
        // Anführer-Abzeichen: Pixel-Krone-Sprite falls das Theme sie themt, sonst Vektor.
        const crownSprite = themedSprite("crown");
        if (crownSprite) {
          const { w: cw, h: ch } = spriteWorldSize(crownSprite);
          const cy = hy - snake.radius - 10; // Unterkante der Krone knapp über dem Kopf
          ctx.drawImage(crownSprite, snap(hx - cw / 2), snap(cy - ch), cw, ch);
        } else {
          drawCrown(hx, hy - snake.radius - 30);
        }
      }
    }

    drawDeathAnimation();

    ctx.restore();
  }

  // Todesanimation der eigenen Schlange (siehe main.js): der Körper LÖST sich von hinten
  // nach vorn (Schwanz -> Kopf) in leuchtende Kugeln auf, die kurz aufpoppen und AN ORT
  // UND STELLE liegen bleiben; am Ende faden sie sanft aus - darunter liegt dann das
  // echte Futter, das das Backend beim Tod fallen lässt (die Schlange "wird" zum
  // liegenbleibenden Futter). Rein clientseitig, in Welt-Koordinaten (wird innerhalb
  // des Welt-Transforms von draw() gezeichnet).
  let deathAnim = null;
  function startDeathAnimation(snapshot) {
    const src = snapshot.points;
    if (!src || src.length === 0) return;
    const pts = src.map((p) => [p[0], p[1]]); // Kopie (Zustand friert ein)
    const n = pts.length;
    // Kugeln nur an gestuften Punkten (nicht jeder Körperpunkt) -> wirkt wie diskretes
    // Futter, nicht wie eine dichte Linie. Jede Kugel bekommt ihre Auflöse-Zeit
    // (Schwanz zuerst, gleiche Formel wie die Körper-Front unten) und stabile Werte.
    const orbCount = Math.max(6, Math.min(28, Math.round(n / 2)));
    const step = Math.max(1, Math.floor(n / orbCount));
    const orbs = [];
    for (let i = 0; i < n; i += step) {
      orbs.push({
        x: pts[i][0],
        y: pts[i][1],
        dissolveT: ((n - 1 - i) / Math.max(1, n - 1)) / DEATH_DISSOLVE_LEAD,
        color: DEATH_ORB_COLORS[orbs.length % DEATH_ORB_COLORS.length],
        r: snapshot.radius * DEATH_ORB_RADIUS_FACTOR * (0.8 + Math.random() * 0.5),
      });
    }
    // Bounding-Box des Körpers (+ Marge) - darin wird das echte Futter während der
    // Animation ausgeblendet (die gedroppte Spur liegt entlang des Körpers).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const m = snapshot.radius * 3;
    deathAnim = {
      pts,
      n,
      orbs,
      radius: snapshot.radius,
      color: snapshot.color,
      direction: snapshot.direction || 0,
      box: { minX: minX - m, minY: minY - m, maxX: maxX + m, maxY: maxY + m },
      start: performance.now(),
    };
  }
  function isDeathAnimating() {
    return deathAnim !== null;
  }
  function isInDeathZone(x, y) {
    if (!deathAnim) return false;
    const b = deathAnim.box;
    return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  }
  function drawDeathAnimation() {
    if (!deathAnim) return;
    const t = (performance.now() - deathAnim.start) / DEATH_ANIM_MS;
    if (t >= 1) {
      deathAnim = null;
      return;
    }
    const { pts, n, orbs, radius, color } = deathAnim;

    // (a) Restkörper: von Kopf (Index 0) bis zur Auflöse-Front. Die Front läuft mit der
    // Zeit vom Schwanz zum Kopf (DEATH_DISSOLVE_LEAD > 1 -> Kopf verschwindet vor Schluss).
    const frontIdx = Math.ceil((n - 1) * (1 - t * DEATH_DISSOLVE_LEAD)) - 1;
    if (frontIdx >= 1) {
      const body = pts.slice(0, frontIdx + 1);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      drawTaperedBody(body, radius * 2 + SNAKE_OUTLINE_WIDTH * 2, SNAKE_OUTLINE_COLOR);
      drawTaperedBody(body, radius * 2, color);
      // dezente Augen, solange der Kopf noch da ist
      const d = deathAnim.direction;
      const [hx, hy] = pts[0];
      const er = radius * SNAKE_EYE_RADIUS_FACTOR;
      for (const side of [1, -1]) {
        const ex = hx + Math.cos(d) * radius * SNAKE_EYE_FORWARD_OFFSET + Math.cos(d + Math.PI / 2) * radius * SNAKE_EYE_SIDE_OFFSET * side;
        const ey = hy + Math.sin(d) * radius * SNAKE_EYE_FORWARD_OFFSET + Math.sin(d + Math.PI / 2) * radius * SNAKE_EYE_SIDE_OFFSET * side;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ex, ey, er, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.beginPath();
        ctx.arc(ex + Math.cos(d) * er * 0.4, ey + Math.sin(d) * er * 0.4, radius * SNAKE_PUPIL_RADIUS_FACTOR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // (b) aufgelöste Kugeln: poppen auf, bleiben liegen, faden am Ende aus (additiv).
    const fadeAlpha = t < DEATH_ORB_FADE_START ? 1 : Math.max(0, 1 - (t - DEATH_ORB_FADE_START) / (1 - DEATH_ORB_FADE_START));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    for (const o of orbs) {
      if (t < o.dissolveT) continue;
      const age = (t - o.dissolveT) * DEATH_ANIM_MS;
      const pop = age < DEATH_ORB_POP_MS ? (age / DEATH_ORB_POP_MS) * 1.5 : 1 + 0.5 * Math.exp(-(age - DEATH_ORB_POP_MS) / 120);
      const r = o.r * Math.min(1.5, pop);
      // weicher Glüh-Hof
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r * 2.4);
      g.addColorStop(0, o.color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = fadeAlpha * 0.5;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      // heller Kern
      ctx.globalAlpha = fadeAlpha;
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return { setBoard, setObstacles, resizeToWindow, draw, setTheme, startDeathAnimation, isDeathAnimating };
}
