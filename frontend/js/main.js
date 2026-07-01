window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("game-canvas");
  const renderer = createRenderer(canvas);
  const scoreEl = document.getElementById("score");
  const overlay = document.getElementById("game-over-overlay");
  const finalScoreEl = document.getElementById("final-score");
  const restartBtn = document.getElementById("restart-btn");
  const connectionBanner = document.getElementById("connection-banner");
  const nameModal = document.getElementById("name-modal");
  const serverInput = document.getElementById("server-input");
  const nameInput = document.getElementById("name-input");
  const joinBtn = document.getElementById("join-btn");
  const controlToggleBtn = document.getElementById("control-toggle");
  const leaderboardList = document.getElementById("leaderboard-list");
  const dashMeterFill = document.getElementById("dash-meter-fill");

  let camera = { x: 0, y: 0 };
  let client = null;
  let pendingName = "";

  renderer.resizeToWindow();
  window.addEventListener("resize", () => renderer.resizeToWindow());

  // Namens-Modal wird immer zuerst gezeigt (kein Auto-Connect mehr beim Laden),
  // da der Server erst dort ausgewählt wird. Beide Felder werden aus dem
  // Storage vorbefüllt, sodass wiederkehrende Spieler nur noch Enter/Klick
  // brauchen, statt komplett am Modal vorbeizulaufen.
  serverInput.value =
    localStorage.getItem("snakeServer") || window.location.hostname || "localhost";
  nameInput.value = sessionStorage.getItem("snakeName") || "";

  function updateControlToggleLabel() {
    controlToggleBtn.textContent =
      GameState.controlMode === "relative"
        ? "Steuerung: relativ zur Schlange (Tab zum Umschalten)"
        : "Steuerung: absolut zum Bildschirm (Tab zum Umschalten)";
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
    const server = (serverInput.value || "").trim() || "localhost";
    const name = (nameInput.value || "").trim().slice(0, 20) || "Spieler";
    localStorage.setItem("snakeServer", server);
    sessionStorage.setItem("snakeName", name);
    pendingName = name;
    nameModal.classList.add("hidden");

    if (client) return; // already connected from an earlier submit

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    client = new WebSocketClient(`${protocol}://${server}:${window.location.port}/ws`);
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
      }

      renderer.draw({ snakes: msg.snakes, food: msg.food }, camera);
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
  }

  joinBtn.addEventListener("click", doJoin);
  for (const input of [serverInput, nameInput]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") doJoin();
    });
  }
});
