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
  const dashMeterFill = document.getElementById("dash-meter-fill");
  const dashBtn = document.getElementById("dash-btn");

  let camera = { x: 0, y: 0 };
  let client = null;
  let pendingName = "";
  // Zoomstufe, interpoliert anhand der eigenen Schlangenlänge (siehe onState) -
  // startet bei der kleinsten Zoomstufe (VIEW_WORLD_HEIGHT_MIN aus config.js).
  let viewWorldHeight = VIEW_WORLD_HEIGHT_MIN;

  renderer.resizeToWindow();
  window.addEventListener("resize", () => renderer.resizeToWindow());

  // Eine einzige Erkennung steuert alle Touch-spezifischen CSS-/Text-Unterschiede
  // (siehe body.touch-device in style.css). Die Event-Verdrahtung selbst
  // (setupTouchControls) läuft dagegen immer, unabhängig von dieser Erkennung -
  // Pointer Events vereinheitlichen Maus/Touch/Pen, ein Touchscreen-Laptop
  // bekommt so Tastatur- und Zeige-Steuerung gleichzeitig ohne Konflikt.
  const isTouchDevice = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  if (isTouchDevice) {
    document.body.classList.add("touch-device");
    document.getElementById("controls-hint").textContent =
      "Berühren & halten: Richtung zeigen · Button unten rechts: Dash · Dein goldener Ring markiert deine Schlange";
  }

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

  function updateDashMeter(charge, dashing) {
    dashMeterFill.style.width = `${Math.round(charge * 100)}%`;
    dashMeterFill.classList.toggle("active", !!dashing);
    dashMeterFill.classList.toggle("ready", !dashing && charge >= 1);

    // Ladestand zusätzlich direkt im Touch-Dash-Button (kreisförmige Füllung) -
    // spiegelt denselben Zustand wie der HUD-Balken, nur an einer für den
    // Daumen erreichbaren Stelle.
    dashBtn.style.setProperty("--dash-charge", `${Math.round(charge * 100)}%`);
    dashBtn.classList.toggle("active", !!dashing);
    dashBtn.classList.toggle("ready", !dashing && charge >= 1);
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

  function doJoin() {
    const name = (nameInput.value || "").trim().slice(0, 20) || "Spieler";
    sessionStorage.setItem("snakeName", name);
    pendingName = name;
    nameModal.classList.add("hidden");

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
        scoreEl.textContent = `Score: ${mySnake.score}`;
        updateDashMeter(mySnake.dash_charge, mySnake.dashing);

        // Kamera zoomt mit wachsendem eigenem Radius (Breite) kontinuierlich
        // raus, damit man sich selbst weiterhin gut im Blick behält (0 bei
        // minimaler, 1 bei maximaler Breite, siehe SNAKE_RADIUS_MIN/MAX in
        // config.js) - bewusst an der Breite festgemacht, nicht an der Länge.
        const growth = Math.min(
          1,
          Math.max(0, (mySnake.radius - SNAKE_RADIUS_MIN) / (SNAKE_RADIUS_MAX - SNAKE_RADIUS_MIN))
        );
        viewWorldHeight = VIEW_WORLD_HEIGHT_MIN + growth * (VIEW_WORLD_HEIGHT_MAX - VIEW_WORLD_HEIGHT_MIN);
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
