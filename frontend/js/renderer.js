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

function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let board = { width: 0, height: 0 };

  function setBoard(width, height) {
    board = { width, height };
  }

  function resizeToWindow() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function worldScale() {
    return canvas.height / VIEW_WORLD_HEIGHT;
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

    ctx.fillStyle = SPIKE_FILL_COLOR;
    ctx.strokeStyle = SPIKE_STROKE_COLOR;
    ctx.lineWidth = 1;

    for (let i = 0; i < count; i++) {
      const offset = margin + step * i;
      const baseX1 = x1 + dirX * offset;
      const baseY1 = y1 + dirY * offset;
      const baseX2 = baseX1 + dirX * spikeWidth;
      const baseY2 = baseY1 + dirY * spikeWidth;
      const tipX = (baseX1 + baseX2) / 2 + normalX * SPIKE_SIZE;
      const tipY = (baseY1 + baseY2) / 2 + normalY * SPIKE_SIZE;

      ctx.beginPath();
      ctx.moveTo(baseX1, baseY1);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(baseX2, baseY2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
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

  function draw(state, camera) {
    const scale = worldScale();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#050508";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-camera.x, -camera.y);

    ctx.fillStyle = "#14141e";
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
      ctx.fillStyle = foodColor(food);
      ctx.beginPath();
      ctx.arc(food.x, food.y, foodRadius(food.value), 0, Math.PI * 2);
      ctx.fill();
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

      const bodyPath = new Path2D();
      bodyPath.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        bodyPath.lineTo(points[i][0], points[i][1]);
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (snake.dashing) {
        ctx.shadowColor = SNAKE_DASH_GLOW_COLOR;
        ctx.shadowBlur = SNAKE_DASH_GLOW_BLUR;
      }

      ctx.strokeStyle = SNAKE_OUTLINE_COLOR;
      ctx.lineWidth = snake.radius * 2 + SNAKE_OUTLINE_WIDTH * 2;
      ctx.stroke(bodyPath);

      ctx.strokeStyle = snake.color;
      ctx.lineWidth = snake.radius * 2;
      ctx.stroke(bodyPath);

      if (snake.dashing) {
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
      }

      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(points[0][0], points[0][1], snake.radius * 0.5, 0, Math.PI * 2);
      ctx.fill();

      const [hx, hy] = points[0];

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

  return { setBoard, resizeToWindow, draw };
}
