window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("game-canvas");
  const renderer = createRenderer(canvas);
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

  function updateDashMeter(charge, dashing) {
    // Beide Anzeigen (kompakter HUD-Ring für Desktop, großer Button für Touch)
    // teilen sich dieselbe Ring-Füllung + Bereit/Aktiv-Farblogik. pathLength="100"
    // auf den <circle>-Elementen (siehe index.html) macht dashoffset direkt zum
    // Prozentwert, unabhängig vom tatsächlichen SVG-Radius.
    const offset = 100 * (1 - charge);
    for (const el of [dashRing, dashBtn]) {
      el.querySelector(".dash-progress-fill").style.strokeDashoffset = offset;
      el.classList.toggle("active", !!dashing);
      el.classList.toggle("ready", !dashing && charge >= 1);
    }
  }

  function updateLeaderboard(snakes) {
    const sorted = [...snakes].sort((a, b) => b.score - a.score).slice(0, 8);
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
      const mySnake = msg.snakes.find((s) => s.player_id === GameState.playerId);
      if (mySnake) {
        camera = { x: mySnake.points[0][0], y: mySnake.points[0][1] };
        GameState.ownDirection = mySnake.direction;
        scoreEl.textContent = showDebugInfo
          ? `Score: ${mySnake.score} | Länge: ${Math.round(mySnake.length)} | Breite: ${mySnake.radius.toFixed(1)}`
          : `Score: ${mySnake.score}`;
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
        // langsamer als Reinzoomen (siehe ZOOM_LERP_FACTOR_OUT/IN in config.js).
        const zoomLerpFactor =
          targetViewWorldHeight > viewWorldHeight ? ZOOM_LERP_FACTOR_OUT : ZOOM_LERP_FACTOR_IN;
        viewWorldHeight += (targetViewWorldHeight - viewWorldHeight) * zoomLerpFactor;
      }

      renderer.draw({ snakes: msg.snakes, food: msg.food }, camera, viewWorldHeight);
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
