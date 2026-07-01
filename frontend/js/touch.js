// Halten/Ziehen auf dem Canvas zeigt die Richtung (Vorbild: slither.io).
// Nutzt bewusst Pointer Events (nicht Touch Events) - vereinheitlicht
// Maus/Touch/Pen in einer API, funktioniert daher unverändert auch mit der
// Maus auf einem Desktop-Browser.
function setupTouchControls(client, canvas, renderer) {
  let activePointerId = null;
  let lastAngle = null;
  let lastSendTime = 0;

  function updateFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const origin = renderer.getViewOrigin();
    const dx = event.clientX - rect.left - origin.x;
    const dy = event.clientY - rect.top - origin.y;
    if (Math.hypot(dx, dy) < TOUCH_STEER_DEADZONE_PX) return;

    const angle = Math.atan2(dy, dx);
    const now = performance.now();
    if (angle !== lastAngle && now - lastSendTime >= TOUCH_STEER_MIN_INTERVAL_MS) {
      client.sendDirection(angle);
      lastAngle = angle;
      lastSendTime = now;
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (activePointerId !== null) return; // erste Berührung gewinnt, Mehrfach-Touch ignoriert
    activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    updateFromEvent(event);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId) return;
    updateFromEvent(event);
  });

  function endTouch(event) {
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
  }
  canvas.addEventListener("pointerup", endTouch);
  canvas.addEventListener("pointercancel", endTouch);

  const dashBtn = document.getElementById("dash-btn");
  dashBtn.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    client.sendDash();
  });
}
