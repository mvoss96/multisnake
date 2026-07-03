function setupInput(client, onToggleControlMode) {
  const pressed = new Set();
  const absoluteKeyToAngle = {
    ArrowUp: -Math.PI / 2,
    KeyW: -Math.PI / 2,
    ArrowDown: Math.PI / 2,
    KeyS: Math.PI / 2,
    ArrowLeft: Math.PI,
    KeyA: Math.PI,
    ArrowRight: 0,
    KeyD: 0,
  };
  let lastAbsoluteAngle = null;

  function sendRelativeTurn() {
    const left = pressed.has("ArrowLeft") || pressed.has("KeyA");
    const right = pressed.has("ArrowRight") || pressed.has("KeyD");
    if (!left && !right) return;
    let angle = GameState.ownDirection;
    if (left) angle -= RELATIVE_TURN_STEP;
    if (right) angle += RELATIVE_TURN_STEP;
    client.sendDirection(angle);
  }

  window.addEventListener("keydown", (event) => {
    // Tippt der Nutzer gerade in ein Eingabefeld (z.B. Debug-Konsole, Namensfeld),
    // nicht die Schlange steuern.
    const tag = (event.target && event.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.code === "Tab") {
      event.preventDefault();
      if (onToggleControlMode) onToggleControlMode();
      return;
    }

    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      if (!pressed.has(event.code)) client.sendDash();
      pressed.add(event.code);
      return;
    }

    pressed.add(event.code);
    if (GameState.controlMode === "absolute") {
      const angle = absoluteKeyToAngle[event.code];
      if (angle === undefined) return;
      if (angle !== lastAbsoluteAngle) {
        lastAbsoluteAngle = angle;
        client.sendDirection(angle);
      }
    } else if (GameState.controlMode === "relative") {
      if (event.code === "ArrowLeft" || event.code === "KeyA" || event.code === "ArrowRight" || event.code === "KeyD") {
        sendRelativeTurn();
      }
    }
  });

  window.addEventListener("keyup", (event) => {
    pressed.delete(event.code);
  });

  setInterval(() => {
    if (GameState.controlMode !== "relative") return;
    sendRelativeTurn();
  }, RELATIVE_POLL_MS);
}
