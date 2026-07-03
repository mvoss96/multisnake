class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.onWelcome = null;
    this.onState = null;
    this.onGameOver = null;
    this.onConnectionChange = null;
    this.onDebugAuthResult = null;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      if (this.onConnectionChange) this.onConnectionChange(true);
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "welcome":
          if (this.onWelcome) this.onWelcome(msg);
          break;
        case "state":
          if (this.onState) this.onState(msg);
          break;
        case "game_over":
          if (this.onGameOver) this.onGameOver(msg);
          break;
        case "debug_auth_result":
          if (this.onDebugAuthResult) this.onDebugAuthResult(msg);
          break;
      }
    };

    this.ws.onclose = () => {
      if (this.onConnectionChange) this.onConnectionChange(false);
      setTimeout(() => this.connect(), 1000);
    };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendDirection(angle) {
    this.send({ type: "direction", angle });
  }

  sendRestart() {
    this.send({ type: "restart" });
  }

  sendDash() {
    this.send({ type: "dash" });
  }

  sendJoin(name) {
    this.send({ type: "join", name });
  }

  // Debug-Hilfen (siehe backend/main.py) - nicht für normales Gameplay gedacht.
  sendDebugPause(paused = true) {
    this.send({ type: "debug_pause", paused });
  }

  sendDebugTeleport(x, y) {
    this.send({ type: "debug_teleport", x, y });
  }

  sendDebugSpawnAt(x, y) {
    this.send({ type: "debug_spawn_at", x, y });
  }

  sendDebugInvulnerable(enabled = true) {
    this.send({ type: "debug_invulnerable", enabled });
  }

  sendDebugBotCount(count) {
    this.send({ type: "debug_bots", count });
  }

  sendDebugReset() {
    this.send({ type: "debug_reset" });
  }

  sendDebugAuth(token) {
    this.send({ type: "debug_auth", token });
  }
}
