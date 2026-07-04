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

  // Pixel-Font vorladen: der Canvas nutzt einen Font erst, wenn er geladen ist
  // (anders als CSS wartet drawText nicht). Bis dahin fällt das Namens-Label auf
  // sans-serif zurück - unkritisch. Fehler ignorieren (Font optional).
  if (document.fonts && document.fonts.load) {
    document.fonts.load('11px "PixelFont"').catch(() => {});
    document.fonts.load('bold 11px "PixelFont"').catch(() => {});
  }

  // Design-Umschalter dynamisch aus der Registry erzeugen - ein neues Theme in
  // themes.js bekommt so automatisch seinen Button. Es gibt mehrere Umschalter
  // (Namens-Modal UND Game-Over-Overlay, beide .theme-select); pro Theme werden
  // alle zugehörigen Buttons in einer Liste gehalten, damit die Auswahl-Markierung
  // überall synchron bleibt.
  const themeButtons = new Map();
  for (const theme of THEMES) themeButtons.set(theme.id, []);
  for (const container of document.querySelectorAll(".theme-select")) {
    for (const theme of THEMES) {
      const btn = document.createElement("button");
      btn.className = "theme-option";
      btn.textContent = theme.label;
      btn.addEventListener("click", () => applyTheme(theme.id));
      container.appendChild(btn);
      themeButtons.get(theme.id).push(btn);
    }
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
      for (const btn of themeButtons.get(theme.id)) {
        btn.classList.toggle("selected", theme.id === themeId);
      }
    }
    renderer.setTheme(themeId);
  }

  applyTheme(activeThemeId);
  const scoreEl = document.getElementById("score");
  const overlay = document.getElementById("game-over-overlay");
  const finalScoreEl = document.getElementById("final-score");
  const goBestEl = document.getElementById("go-best");
  const goRankEl = document.getElementById("go-rank");
  const goRecordEl = document.getElementById("go-record");
  const goChangeNameBtn = document.getElementById("go-changename");
  const restartBtn = document.getElementById("restart-btn");
  const connectionOverlay = document.getElementById("connection-overlay");
  const reconnectRetryBtn = document.getElementById("reconnect-retry");
  const nameModal = document.getElementById("name-modal");
  const nameInput = document.getElementById("name-input");
  const joinBtn = document.getElementById("join-btn");
  const controlToggleBtn = document.getElementById("control-toggle");
  const leaderboardList = document.getElementById("leaderboard-list");
  const dashRing = document.getElementById("dash-ring");
  const dashBtn = document.getElementById("dash-btn");

  let camera = { x: 0, y: 0 };
  let lastOwnSnake = null; // zuletzt gerenderte eigene Schlange (für die Todesanimation)
  let dbgEls = null; // Debug-Konsole (nur wenn welcome.debug_enabled), einmal verdrahtet
  // Sound-Trigger: eigene Werte vom Vortick, um Flanken zu erkennen (Score steigt =
  // Futter gegessen, dashing false->true = Dash gestartet).
  let lastOwnScore = null;
  let lastDashing = false;

  // Debug-Konsole verdrahten (einmalig). Sendet die bestehenden debug_*-Befehle über
  // den Client; Panel per Toggle-Button oder Taste ` ein-/ausblendbar.
  function setupDebugConsole(client) {
    const el = (id) => document.getElementById(id);
    const toggle = el("dbg-toggle");
    const panel = el("debug-console");
    const bots = el("dbg-bots");
    const pause = el("dbg-pause");
    const invuln = el("dbg-invuln");
    const tx = el("dbg-tx");
    const ty = el("dbg-ty");
    const info = el("dbg-info");
    toggle.classList.remove("hidden");
    const setOpen = (open) => panel.classList.toggle("hidden", !open);
    const toggleOpen = () => setOpen(panel.classList.contains("hidden"));
    toggle.addEventListener("click", toggleOpen);
    el("dbg-close").addEventListener("click", () => setOpen(false));
    window.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) || "";
      // "^" (deutsches Layout, Taste links der 1) bzw. dieselbe physische Taste
      // (code "Backquote") blendet die Konsole ein/aus.
      const isToggleKey = e.key === "^" || e.code === "Backquote";
      if (isToggleKey && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        toggleOpen();
      }
    });
    const applyBots = () => {
      let n = parseInt(bots.value, 10);
      if (Number.isNaN(n)) return;
      n = Math.max(0, Math.min(50, n));
      bots.value = String(n);
      client.sendDebugBotCount(n);
    };
    el("dbg-bots-apply").addEventListener("click", applyBots);
    bots.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyBots();
    });
    pause.addEventListener("change", () => client.sendDebugPause(pause.checked));
    invuln.addEventListener("change", () => client.sendDebugInvulnerable(invuln.checked));
    el("dbg-tp").addEventListener("click", () => {
      const x = parseFloat(tx.value);
      const y = parseFloat(ty.value);
      if (!Number.isNaN(x) && !Number.isNaN(y)) client.sendDebugTeleport(x, y);
    });
    el("dbg-reset").addEventListener("click", () => client.sendDebugReset());
    return { pause, invuln, info };
  }

  // Zustand der Konsole aus dem State spiegeln (Pause/Unverwundbar/Schlangenzahl),
  // ohne die gerade fokussierte Checkbox zu überschreiben.
  function syncDebugConsole(msg) {
    if (!dbgEls) return;
    if (document.activeElement !== dbgEls.pause) dbgEls.pause.checked = !!msg.paused;
    const me = msg.snakes.find((s) => s.player_id === GameState.playerId);
    if (me && document.activeElement !== dbgEls.invuln) dbgEls.invuln.checked = !!me.invulnerable;
    dbgEls.info.textContent = `Schlangen im Spiel: ${msg.snakes.length}`;
  }

  let client = null;
  // Zuletzt bekannte Platzierung/Feldgröße der eigenen Schlange (aus onState),
  // für die Ergebnis-Karte beim Game Over festgehalten (der Game-Over-Tick selbst
  // enthält die eigene Schlange nicht mehr).
  let lastRank = 0;
  let lastTotal = 0;
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
        lastOwnSnake = mySnake; // für die Todesanimation (letzter bekannter Zustand)
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

  // Mute-Umschalter: Icon spiegelt den (persistierten) Zustand; Klick ist zugleich
  // eine Nutzergeste, über die der Audio-Kontext freigeschaltet werden kann.
  const muteBtn = document.getElementById("mute-toggle");
  function updateMuteLabel() {
    const m = Sound.isMuted();
    muteBtn.textContent = m ? "🔇" : "🔊";
    muteBtn.classList.toggle("muted", m);
  }
  updateMuteLabel();
  muteBtn.addEventListener("click", () => {
    Sound.unlock();
    Sound.setMuted(!Sound.isMuted());
    updateMuteLabel();
  });

  // Debug-Info (Länge/Breite der eigenen Schlange) ein-/ausblenden per Klick/Tap
  // auf den Score - praktisch zum Nachvollziehen des Score-basierten Wachstums,
  // ohne die Konsole zu bemühen.
  let showDebugInfo = false;
  scoreEl.style.cursor = "pointer";
  scoreEl.addEventListener("click", () => {
    showDebugInfo = !showDebugInfo;
  });

  let lastDashSig = "";
  let lastDashReady = false;
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
    // Chime beim Übergang "nicht bereit" -> "bereit" (vor dem Early-Return prüfen).
    if (ready && !lastDashReady) Sound.dashReady();
    lastDashReady = ready;
    const sig = `${dashing ? 1 : 0}:${ready ? 1 : 0}:${filled}:${offset.toFixed(1)}`;
    if (sig === lastDashSig) return;
    lastDashSig = sig;
    for (const el of [dashRing, dashBtn]) {
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
    // Play-Klick ist eine Nutzergeste -> Audio-Kontext freischalten (Autoplay-Policy).
    Sound.unlock();

    if (client) return; // already connected from an earlier submit

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    // Immer /ws. Admin-Rechte kommen über das Cookie, das der Server beim Ausliefern von
    // /admin setzt (Caddy hat den Pfad zuvor per basic_auth geschützt) - der Browser
    // sendet Cookies zuverlässig beim WS-Handshake mit; der Server meldet welcome.is_admin.
    client = new WebSocketClient(`${protocol}://${window.location.host}/ws`);
    window.__debugClient = client; // Konsole: window.__debugClient.sendDebugTeleport(x, y) etc.

    client.onConnectionChange = (isConnected) => {
      connectionOverlay.classList.toggle("hidden", isConnected);
    };

    client.onWelcome = (msg) => {
      GameState.playerId = msg.player_id;
      GameState.board = msg.board;
      renderer.setBoard(msg.board.width, msg.board.height);
      renderer.setObstacles(msg.obstacles || []);
      camera = { x: msg.board.width / 2, y: msg.board.height / 2 };
      overlay.classList.add("hidden");
      // Konsole zeigen bei lokalem Dev (debug_enabled) ODER wenn diese Verbindung als
      // Admin gilt (Basic-Auth über /admin + Cookie, siehe main.py -> welcome.is_admin).
      if ((msg.debug_enabled || msg.is_admin) && !dbgEls) dbgEls = setupDebugConsole(client);
      // Als Admin die Konsole gleich aufklappen (er ist gezielt auf /admin gegangen).
      if (msg.is_admin) document.getElementById("debug-console").classList.remove("hidden");
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
        // Sound-Flanken: Score gestiegen -> Futter gegessen (Tonhöhe nach Zuwachs);
        // dashing false->true -> Dash gestartet.
        if (lastOwnScore !== null && mySnake.score > lastOwnScore) {
          Sound.eat(mySnake.score - lastOwnScore);
        }
        lastOwnScore = mySnake.score;
        if (mySnake.dashing && !lastDashing) Sound.dashStart();
        lastDashing = !!mySnake.dashing;
        // Platzierung merken (Rang nach Score) - für die Game-Over-Ergebnis-Karte.
        lastTotal = msg.snakes.length;
        lastRank =
          msg.snakes.filter((s) => s.score > mySnake.score).length + 1;
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
      syncDebugConsole(msg);
    };

    client.onGameOver = (msg) => {
      // Ergebnis-Karte füllen: großer Score, Bestwert (localStorage) + Rekord-Badge,
      // zuletzt bekannte Platzierung.
      const score = msg.score;
      const prevBest = parseInt(localStorage.getItem("snakeBest") || "0", 10);
      const isRecord = score > prevBest;
      const best = Math.max(prevBest, score);
      localStorage.setItem("snakeBest", String(best));
      finalScoreEl.textContent = String(score);
      goBestEl.textContent = String(best);
      goRankEl.textContent = lastRank ? `${lastRank}/${lastTotal}` : "–";
      goRecordEl.classList.toggle("hidden", !isRecord);
      // Erst die Todesanimation (Körper zerplatzt, siehe renderer.js), dann das
      // Ergebnis-Overlay - statt sofort "Game Over". Fällt bei fehlendem letzten
      // Zustand (z.B. Tod im allerersten Tick) auf sofortiges Overlay zurück.
      Sound.death();
      // Trigger für ein frisches Leben zurücksetzen (Respawn beginnt sauber).
      lastOwnScore = null;
      lastDashing = false;
      if (lastOwnSnake) {
        renderer.startDeathAnimation(lastOwnSnake);
        lastOwnSnake = null;
        setTimeout(() => overlay.classList.remove("hidden"), DEATH_ANIM_MS);
      } else {
        overlay.classList.remove("hidden");
      }
    };

    restartBtn.addEventListener("click", () => {
      overlay.classList.add("hidden");
      client.sendRestart();
    });

    // "Erneut versuchen": der Client reconnectet ohnehin automatisch (siehe
    // network.js), dies forciert einen sofortigen Versuch statt zu warten.
    reconnectRetryBtn.addEventListener("click", () => client.connect());

    client.connect();
    setupInput(client, toggleControlMode);
    setupTouchControls(client, canvas);
  }

  joinBtn.addEventListener("click", doJoin);
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") doJoin();
  });

  // "Name ändern" (Game Over): sauberster Weg zurück zum Namens-Modal ist ein
  // Reload - der Name ist aus sessionStorage vorbefüllt, danach frisch verbinden.
  goChangeNameBtn.addEventListener("click", () => window.location.reload());
});
