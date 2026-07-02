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
  if (value >= 5) return "foodPotion";
  if (value >= 2) return "foodGem";
  return "foodCoin";
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

  function setBoard(width, height) {
    board = { width, height };
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
    const spriteW = spikeWidth * 1.3;
    const spriteH = spikeSprite ? spriteW * (spikeSprite.naturalHeight / spikeSprite.naturalWidth) : 0;

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
        ctx.translate(midX, midY);
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

  function drawBoundary(camera) {
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, board.width, board.height);

    const glowPhase = (performance.now() % SPIKE_GLOW_PERIOD_MS) / SPIKE_GLOW_PERIOD_MS;
    const pulse = 0.5 + 0.5 * Math.sin(glowPhase * Math.PI * 2);
    ctx.shadowColor = SPIKE_GLOW_COLOR;

    function glowForDistance(distance) {
      const proximity = Math.max(0, 1 - distance / SPIKE_GLOW_PROXIMITY);
      ctx.shadowBlur = proximity * (SPIKE_GLOW_BLUR_MIN + (SPIKE_GLOW_BLUR_MAX - SPIKE_GLOW_BLUR_MIN) * pulse);
    }

    glowForDistance(camera.y);
    drawSpikeRow(0, 0, board.width, 0, 0, 1);
    glowForDistance(board.height - camera.y);
    drawSpikeRow(0, board.height, board.width, board.height, 0, -1);
    glowForDistance(camera.x);
    drawSpikeRow(0, 0, 0, board.height, 1, 0);
    glowForDistance(board.width - camera.x);
    drawSpikeRow(board.width, 0, board.width, board.height, -1, 0);

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
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
    ctx.fillStyle = "#050508";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-camera.x, -camera.y);

    // Board-Fläche: gekacheltes Tile-Sprite, wenn das aktive Theme die Rolle
    // "boardTile" themt (und geladen ist), sonst die einfarbige Default-Fläche.
    const boardTile = themedSprite("boardTile");
    const boardTileName = theme.sprites.boardTile;
    if (boardTile && !patternCache[boardTileName]) {
      patternCache[boardTileName] = ctx.createPattern(boardTile, "repeat");
    }
    ctx.fillStyle = (boardTile && patternCache[boardTileName]) || "#14141e";
    ctx.fillRect(0, 0, board.width, board.height);

    drawBoundary(camera);

    const blinkPhase = (performance.now() % FOOD_BLINK_PERIOD_MS) / FOOD_BLINK_PERIOD_MS;
    const blinkAlpha = FOOD_BLINK_MIN_ALPHA + (1 - FOOD_BLINK_MIN_ALPHA) * (0.5 + 0.5 * Math.sin(blinkPhase * Math.PI * 2));
    for (const food of state.food) {
      const life = food.life ?? 1;
      const blinkFactor = life < FOOD_BLINK_START_LIFE ? blinkAlpha : 1;
      const fadeAlpha = life >= FOOD_FADE_START_LIFE
        ? FOOD_DEFAULT_ALPHA
        : FOOD_FADE_MIN_ALPHA + (FOOD_DEFAULT_ALPHA - FOOD_FADE_MIN_ALPHA) * (life / FOOD_FADE_START_LIFE);
      ctx.globalAlpha = blinkFactor * fadeAlpha;
      const sprite = themedSprite(foodSpriteRole(food.value));
      if (sprite) {
        // Seitenverhältnis erhalten (Edelstein/Trank sind höher als breit),
        // Höhe skaliert mit dem Wert-Radius (siehe FOOD_SPRITE_SCALE).
        const h = foodRadius(food.value) * FOOD_SPRITE_SCALE;
        const w = h * (sprite.naturalWidth / sprite.naturalHeight);
        ctx.drawImage(sprite, food.x - w / 2, food.y - h / 2, w, h);
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

      if (snake.dashing) {
        ctx.shadowColor = SNAKE_DASH_GLOW_COLOR;
        ctx.shadowBlur = SNAKE_DASH_GLOW_BLUR;
      }

      // Schlangen bleiben in beiden Themes die Vektor-Variante: die
      // Sprite-Ketten-Fassung kannte nur zwei Farben (gold/grün) und
      // ignorierte damit die server-zugewiesenen Spielerfarben - bis es
      // pro Farbe brauchbare Sprites gibt, gewinnt die Lesbarkeit.
      // Kontur, Körper und ein dezenter heller Glanzstreifen mittig auf dem
      // Körper - alle drei verjüngen sich zum Schwanz hin für eine organischere
      // Form statt eines gleichbleibend dicken Schlauchs.
      drawTaperedBody(points, snake.radius * 2 + SNAKE_OUTLINE_WIDTH * 2, SNAKE_OUTLINE_COLOR);
      drawTaperedBody(points, snake.radius * 2, snake.color);
      drawTaperedBody(points, snake.radius * 2 * SNAKE_SHINE_WIDTH_FACTOR, "#ffffff", SNAKE_SHINE_ALPHA);
      drawSnakePattern(snake, points);

      if (snake.dashing) {
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

      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      const labelY = hy - snake.radius - 12;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
      ctx.lineWidth = 3;
      ctx.strokeText(snake.name, hx, labelY);
      ctx.fillStyle = snake.color;
      ctx.fillText(snake.name, hx, labelY);

      if (leader && snake.id === leader.id) {
        drawCrown(hx, hy - snake.radius - 30);
      }
    }

    ctx.restore();
  }

  return { setBoard, resizeToWindow, draw, setTheme };
}
