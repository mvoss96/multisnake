function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Interpoliert die Schlangen zwischen zwei Server-States. Der Server stellt pro Tick
// vorne genau EINEN neuen Kopfpunkt voran und trimmt hinten (siehe Snake.move/_trim im
// Backend), d.h. curr.points[i] entspricht raeumlich prev.points[i-1]: same-index-lerp
// laesst damit die gesamte Spur um den Bruchteil t eines Segments nach vorne fliessen -
// exakt die kontinuierliche Bewegung. Punkte jenseits der gemeinsamen Laenge (Schwanz
// bei Wachstum/Trim) werden unveraendert aus curr uebernommen. Neue/respawnte Schlangen
// (keine Historie in prev) werden hart aus curr gezeichnet.
function interpolateSnakes(prev, curr, t) {
  if (prev === curr || t >= 1) return curr.snakes;
  const prevById = new Map();
  for (const s of prev.snakes) prevById.set(s.id, s);
  return curr.snakes.map((s) => {
    const p = prevById.get(s.id);
    if (!p) return s;
    const overlap = Math.min(s.points.length, p.points.length);
    const points = new Array(s.points.length);
    for (let i = 0; i < overlap; i++) {
      const cp = s.points[i];
      const pp = p.points[i];
      points[i] = [lerp(pp[0], cp[0], t), lerp(pp[1], cp[1], t)];
    }
    for (let i = overlap; i < s.points.length; i++) points[i] = s.points[i];
    return { ...s, points, radius: lerp(p.radius, s.radius, t) };
  });
}

// Futter wird nur durch den Magneten bewegt; per-ID-Interpolation der Position glaettet
// auch das. Neu gespawntes Futter (keine Historie) wird hart aus curr gezeichnet.
function interpolateFood(prev, curr, t) {
  if (prev === curr || t >= 1) return curr.food;
  const prevById = new Map();
  for (const f of prev.food) prevById.set(f.id, f);
  return curr.food.map((f) => {
    const p = prevById.get(f.id);
    if (!p) return f;
    return { ...f, x: lerp(p.x, f.x, t), y: lerp(p.y, f.y, t) };
  });
}

window.addEventListener("DOMContentLoaded", () => {
  // Theme-Wahl: gespeichert in localStorage, ein ?theme=<id>-URL-Parameter
  // übersteuert die gespeicherte Wahl (praktisch zum Verschicken von Test-Links).
  // Welche Themes es gibt und was sie themen, steht komplett in themes.js -
  // hier wird nur ausgewählt/verdrahtet, nicht definiert.
  const themeParam = new URLSearchParams(window.location.search).get("theme");
  let activeThemeId;
  if (themeParam && THEMES.some((t) => t.id === themeParam)) {
    activeThemeId = themeParam;
  } else if (themeParam) {
    activeThemeId = DEFAULT_THEME_ID; // expliziter, aber unbekannter Param -> Default
  } else {
    activeThemeId = localStorage.getItem("snakeTheme") || DEFAULT_THEME_ID;
  }

  const canvas = document.getElementById("game-canvas");
  const renderer = createRenderer(canvas, activeThemeId);

  // Design-Umschalter im Namens-Modal dynamisch aus der Registry erzeugen -
  // ein neues Theme in themes.js bekommt so automatisch seinen Button.
  const themeSelect = document.getElementById("theme-select");
  const themeButtons = new Map();
  for (const theme of THEMES) {
    const btn = document.createElement("button");
    btn.className = "theme-option";
    btn.textContent = theme.label;
    btn.addEventListener("click", () => applyTheme(theme.id));
    themeSelect.appendChild(btn);
    themeButtons.set(theme.id, btn);
  }

  function applyTheme(themeId) {
    activeThemeId = themeId;
    localStorage.setItem("snakeTheme", themeId);
    for (const theme of THEMES) {
      // Jedes Theme mit eigener bodyClass steuert darüber sein DOM-/HUD-Aussehen
      // (siehe style.css); Themes ohne bodyClass (z.B. Klassisch) = Default-Look.
      if (theme.bodyClass) {
        document.body.classList.toggle(theme.bodyClass, theme.id === themeId);
      }
      themeButtons.get(theme.id).classList.toggle("selected", theme.id === themeId);
    }
    renderer.setTheme(themeId);
  }

  applyTheme(activeThemeId);
  const scoreEl = document.getElementById("score");
  const overlay = document.getElementById("game-over-overlay");
  const finalScoreEl = document.getElementById("final-score");
  const restartBtn = document.getElementById("restart-btn");
  const connectionBanner = document.getElementById("connection-banner");
  const nameModal = document.getElementById("name-modal");
  const nameInput = document.getElementById("name-input");
  const joinBtn = document.getElementById("join-btn");
  const controlToggleBtn = document.getElementById("control-toggle");
  const leaderboardList = document.getElementById("leaderboard-list");
  const dashRing = document.getElementById("dash-ring");
  const dashBtn = document.getElementById("dash-btn");

  let camera = { x: 0, y: 0 };
  let client = null;
  let pendingName = "";

  // Zustandspuffer fuer die Interpolation (siehe renderFrame unten): die letzten zwei
  // empfangenen Server-States plus der Ankunftszeitpunkt und die geglaettete Dauer.
  let prevState = null;
  let currState = null;
  let stateArrival = 0;
  let interpDurationMs = INTERP_INITIAL_MS;
  let lastScoreText = "";
  // Diagnosewerte fürs Debug-Overlay (Klick auf den Score): geglättete FPS aus der
  // Renderschleife und geglätteter Netz-Jitter aus den State-Ankunftsabständen.
  let fpsEma = 0;
  let lastFrameTime = 0;
  let netJitterMs = 0;

  // Eine einzige Erkennung steuert alle Touch-spezifischen CSS-/Text-Unterschiede
  // (siehe body.touch-device in style.css). Die Event-Verdrahtung selbst
  // (setupTouchControls) läuft dagegen immer, unabhängig von dieser Erkennung -
  // Pointer Events vereinheitlichen Maus/Touch/Pen, ein Touchscreen-Laptop
  // bekommt so Tastatur- und Zeige-Steuerung gleichzeitig ohne Konflikt.
  const isTouchDevice = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  if (isTouchDevice) {
    document.body.classList.add("touch-device");
  }

  const minViewWorldHeight = isTouchDevice ? VIEW_WORLD_HEIGHT_MIN_MOBILE : VIEW_WORLD_HEIGHT_MIN;
  // Aktuelle (geglättete) und Ziel-Zoomstufe, siehe Angleichung in onState.
  let viewWorldHeight = minViewWorldHeight;
  let targetViewWorldHeight = minViewWorldHeight;

  renderer.resizeToWindow();
  window.addEventListener("resize", () => renderer.resizeToWindow());

  // Render-Schleife: zeichnet mit dem Display-Refresh (statt nur beim Eintreffen einer
  // State-Nachricht) und interpoliert zwischen den letzten zwei Server-States. Damit ist
  // die sichtbare Bewegung vom (auf Mobile ungleichmaessig eintreffenden) Netz-Takt
  // entkoppelt - der Jitter, der sich vorher als Ruckeln zeigte, wird ausgeblendet.
  // Laeuft immer; tut nichts, solange noch kein State empfangen wurde.
  function renderFrame(now) {
    // Geglättete FPS aus dem Abstand aufeinanderfolgender Frames (fürs Debug-Overlay).
    if (lastFrameTime) {
      const dt = now - lastFrameTime;
      if (dt > 0) {
        const inst = 1000 / dt;
        fpsEma = fpsEma ? fpsEma * (1 - FPS_SMOOTHING) + inst * FPS_SMOOTHING : inst;
      }
    }
    lastFrameTime = now;

    if (currState) {
      let t = interpDurationMs > 0 ? (now - stateArrival) / interpDurationMs : 1;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const snakes = interpolateSnakes(prevState, currState, t);
      const food = interpolateFood(prevState, currState, t);
      const mySnake = snakes.find((s) => s.player_id === GameState.playerId);
      if (mySnake && mySnake.points.length) {
        camera = { x: mySnake.points[0][0], y: mySnake.points[0][1] };
      }
      renderer.draw({ snakes, food }, camera, viewWorldHeight);
    }
    requestAnimationFrame(renderFrame);
  }
  requestAnimationFrame(renderFrame);

  // Namens-Modal wird immer zuerst gezeigt. Name wird aus dem Storage
  // vorbefüllt, sodass wiederkehrende Spieler nur noch Enter/Klick brauchen.
  nameInput.value = sessionStorage.getItem("snakeName") || "";

  function updateControlToggleLabel() {
    const suffix = isTouchDevice ? "" : " (Tab zum Umschalten)";
    controlToggleBtn.textContent =
      (GameState.controlMode === "relative"
        ? "Steuerung: relativ zur Schlange"
        : "Steuerung: absolut zum Bildschirm") + suffix;
  }

  function toggleControlMode() {
    GameState.controlMode = GameState.controlMode === "relative" ? "absolute" : "relative";
    localStorage.setItem("snakeControlMode", GameState.controlMode);
    updateControlToggleLabel();
  }

  updateControlToggleLabel();
  controlToggleBtn.addEventListener("click", toggleControlMode);

  // Debug-Info (Länge/Breite der eigenen Schlange) ein-/ausblenden per Klick/Tap
  // auf den Score - praktisch zum Nachvollziehen des Score-basierten Wachstums,
  // ohne die Konsole zu bemühen.
  let showDebugInfo = false;
  scoreEl.style.cursor = "pointer";
  scoreEl.addEventListener("click", () => {
    showDebugInfo = !showDebugInfo;
  });

  let lastDashSig = "";
  function updateDashMeter(charge, dashing) {
    // Beide Anzeigen (kompakter HUD-Ring für Desktop, großer Button für Touch)
    // teilen sich dieselbe Füll-Logik + Bereit/Aktiv-Zustände.
    // Klassik-Theme: SVG-Fortschrittsring (stroke-dashoffset, pathLength=100 auf
    // den <circle>-Elementen macht dashoffset direkt zum Prozentwert).
    const offset = 100 * (1 - charge);
    // Pixel-Theme: gestufte Gold-Füllung, die im Münz-Coin von unten aufsteigt
    // (siehe .dash-fill in style.css) - identisch für Ring und Button. In Stufen
    // gerundet (DASH_FILL_STEPS) für einen chunky, harten Pixel-Look statt einer
    // glatt gleitenden Kante.
    const filled = dashing ? 1 : Math.round(charge * DASH_FILL_STEPS) / DASH_FILL_STEPS;
    // Nur bei tatsaechlicher Aenderung ins DOM schreiben - onState laeuft 30x/s, die
    // Anzeige aendert sich aber viel seltener (spart Reflows, v.a. auf Mobile).
    const ready = !dashing && charge >= 1;
    const sig = `${dashing ? 1 : 0}:${ready ? 1 : 0}:${filled}:${offset.toFixed(1)}`;
    if (sig === lastDashSig) return;
    lastDashSig = sig;
    for (const el of [dashRing, dashBtn]) {
      // Ladestand fürs Pixel-Theme: gibt die volle Sanduhr-Sprite von unten nach
      // oben frei (clip-path in .hg-lit, siehe style.css).
      el.style.setProperty("--fill", filled);
      el.querySelector(".dash-progress-fill").style.strokeDashoffset = offset;
      el.classList.toggle("active", !!dashing);
      el.classList.toggle("ready", !dashing && charge >= 1);
      el.querySelector(".dash-fill").style.height = filled * 100 + "%";
    }
  }

  let lastLeaderboardSig = "";
  function updateLeaderboard(snakes) {
    const sorted = [...snakes].sort((a, b) => b.score - a.score).slice(0, 8);
    // Das komplette <ul> 30x/s neu aufzubauen (innerHTML + Reflow) war ein spuerbarer
    // Jank-Beitrag auf Mobile. Nur neu rendern, wenn sich die angezeigte Liste
    // wirklich geaendert hat (Reihenfolge, Name, Score oder Farbe).
    const sig = sorted.map((s) => `${s.player_id}\t${s.name}\t${s.score}\t${s.color}`).join("\n");
    if (sig === lastLeaderboardSig) return;
    lastLeaderboardSig = sig;
    leaderboardList.innerHTML = "";
    for (const snake of sorted) {
      const li = document.createElement("li");
      li.textContent = `${snake.name} — ${snake.score}`;
      if (snake.player_id === GameState.playerId) {
        li.classList.add("me");
      } else {
        li.style.color = snake.color;
      }
      leaderboardList.appendChild(li);
    }
  }

  // Nutzt auf Touch-Geräten den vollen Bildschirm (kein Browser-Chrome wie
  // Adressleiste) - muss synchron innerhalb eines Nutzer-Gesten-Handlers
  // aufgerufen werden (hier: der Spielen-Klick), sonst lehnen Browser die
  // Anfrage ab. Manche Browser (u.a. iOS Safari) unterstützen das für
  // beliebige Elemente gar nicht - stiller Fallback aufs normale Layout.
  function requestFullscreenIfSupported() {
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) return;
    try {
      const result = request.call(el);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {
      // Ignorieren - Vollbild ist ein Nice-to-have, kein Blocker fürs Spiel.
    }
  }

  function doJoin() {
    const name = (nameInput.value || "").trim().slice(0, 20) || "Spieler";
    sessionStorage.setItem("snakeName", name);
    pendingName = name;
    nameModal.classList.add("hidden");
    if (isTouchDevice) requestFullscreenIfSupported();

    if (client) return; // already connected from an earlier submit

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    client = new WebSocketClient(`${protocol}://${window.location.host}/ws`);
    window.__debugClient = client; // Konsole: window.__debugClient.sendDebugTeleport(x, y) etc.

    client.onConnectionChange = (isConnected) => {
      connectionBanner.classList.toggle("hidden", isConnected);
    };

    client.onWelcome = (msg) => {
      GameState.playerId = msg.player_id;
      GameState.board = msg.board;
      renderer.setBoard(msg.board.width, msg.board.height);
      camera = { x: msg.board.width / 2, y: msg.board.height / 2 };
      overlay.classList.add("hidden");
      client.sendJoin(pendingName);
    };

    client.onState = (msg) => {
      // Nur puffern + HUD (einmal pro Tick), NICHT zeichnen - das Zeichnen macht die
      // renderFrame-Schleife (Display-Refresh) mit Interpolation zwischen prev/curr.
      const now = performance.now();
      if (currState) {
        // Geglaetteter Mittelwert der tatsaechlichen Ankunftsabstaende (EMA), damit die
        // Interpolationsdauer der realen Tickrate folgt; grobe Aussetzer ignorieren.
        const gap = now - stateArrival;
        if (gap > 0 && gap < INTERP_SAMPLE_MAX_MS) {
          // Jitter = Abweichung dieses Abstands vom bisherigen Mittel (vor dem Update
          // gemessen), selbst wieder geglättet -> Maß für die Netz-Stabilität.
          const dev = Math.abs(gap - interpDurationMs);
          netJitterMs = netJitterMs ? netJitterMs * (1 - NET_JITTER_SMOOTHING) + dev * NET_JITTER_SMOOTHING : dev;
          interpDurationMs = interpDurationMs * (1 - INTERP_SMOOTHING) + gap * INTERP_SMOOTHING;
          interpDurationMs = Math.max(INTERP_MIN_MS, Math.min(INTERP_MAX_MS, interpDurationMs));
        }
      }
      prevState = currState || msg;
      currState = msg;
      stateArrival = now;

      const mySnake = msg.snakes.find((s) => s.player_id === GameState.playerId);
      if (mySnake) {
        GameState.ownDirection = mySnake.direction;
        let scoreText;
        if (showDebugInfo) {
          const netHz = interpDurationMs > 0 ? 1000 / interpDurationMs : 0;
          const netLabel =
            netJitterMs <= NET_JITTER_OK_MS
              ? "stabil"
              : netJitterMs <= NET_JITTER_POOR_MS
                ? "ok"
                : "instabil";
          scoreText =
            `Score: ${mySnake.score} | Länge: ${Math.round(mySnake.length)} | Breite: ${mySnake.radius.toFixed(1)}` +
            ` | Spieler: ${msg.snakes.length} | FPS: ${Math.round(fpsEma)}` +
            ` | Netz: ${netHz.toFixed(1)} Hz (Jitter ${netJitterMs.toFixed(1)} ms, ${netLabel})`;
        } else {
          scoreText = `Score: ${mySnake.score}`;
        }
        if (scoreText !== lastScoreText) {
          scoreEl.textContent = scoreText;
          lastScoreText = scoreText;
        }
        updateDashMeter(mySnake.dash_charge, mySnake.dashing);

        // Kamera zoomt mit wachsendem eigenem Radius (Breite) kontinuierlich
        // raus, damit man sich selbst weiterhin gut im Blick behält (0 bei
        // minimaler, 1 bei maximaler Breite, siehe SNAKE_RADIUS_MIN/MAX in
        // config.js) - bewusst an der Breite festgemacht, nicht an der Länge.
        const growth = Math.min(
          1,
          Math.max(0, (mySnake.radius - SNAKE_RADIUS_MIN) / (SNAKE_RADIUS_MAX - SNAKE_RADIUS_MIN))
        );
        targetViewWorldHeight = minViewWorldHeight + growth * (VIEW_WORLD_HEIGHT_MAX - minViewWorldHeight);
        // Nähert sich dem Ziel pro State-Update nur graduell an (statt zu springen),
        // damit Zoomstufen-Wechsel nicht ruckartig wirken - Rauszoomen bewusst
        // langsamer als Reinzoomen (siehe ZOOM_LERP_FACTOR_OUT/IN in config.js). Der
        // Zoom aendert sich langsam, daher genuegt die Angleichung pro Tick (30 Hz).
        const zoomLerpFactor =
          targetViewWorldHeight > viewWorldHeight ? ZOOM_LERP_FACTOR_OUT : ZOOM_LERP_FACTOR_IN;
        viewWorldHeight += (targetViewWorldHeight - viewWorldHeight) * zoomLerpFactor;
      }

      updateLeaderboard(msg.snakes);
    };

    client.onGameOver = (msg) => {
      finalScoreEl.textContent = `Score: ${msg.score}`;
      overlay.classList.remove("hidden");
    };

    restartBtn.addEventListener("click", () => {
      overlay.classList.add("hidden");
      client.sendRestart();
    });

    client.connect();
    setupInput(client, toggleControlMode);
    setupTouchControls(client, canvas);
  }

  joinBtn.addEventListener("click", doJoin);
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") doJoin();
  });
});
