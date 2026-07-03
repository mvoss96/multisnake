// Schwimmender Touch-Joystick: der Finger kann irgendwo auf dem Canvas
// aufgesetzt werden, dieser Punkt wird der Ursprung. Anschließendes Ziehen
// relativ zu diesem Ursprung bestimmt die Richtung - unabhängig vom
// Tastatur-"absolut"/"relativ"-Modus (siehe input.js), der für Touch keine
// Rolle spielt. Nutzt bewusst Pointer Events (nicht Touch Events) -
// vereinheitlicht Maus/Touch/Pen in einer API, funktioniert daher
// unverändert auch mit der Maus auf einem Desktop-Browser.
function setupTouchControls(client, canvas) {
  let activePointerId = null;
  let originX = 0;
  let originY = 0;
  let lastAngle = null;
  let lastSendTime = 0;

  function updateFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const dx = event.clientX - rect.left - originX;
    const dy = event.clientY - rect.top - originY;
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
    // Rechtsklick mit der Maus = Dash (das Kontextmenü ist unten unterdrückt).
    // Zuerst geprüft, damit ein Rechtsklick auch während des Lenkens (linke Taste
    // gehalten) noch dasht und nicht den Ursprung/Steuer-Pointer beeinflusst.
    if (event.button === 2) {
      client.sendDash();
      return;
    }
    if (activePointerId !== null) return; // erste Berührung gewinnt, Mehrfach-Touch ignoriert
    activePointerId = event.pointerId;
    const rect = canvas.getBoundingClientRect();
    originX = event.clientX - rect.left;
    originY = event.clientY - rect.top;
    lastAngle = null; // neuer Ursprung: nächste Bewegung erzwingt eine frische Richtungsberechnung
    // setPointerCapture sorgt nur dafür, dass Events beim Bewegen außerhalb
    // des Canvas trotzdem ankommen - rein optional, Ursprung ist auch ohne
    // das gesetzt, daher defensiv statt den Handler abzubrechen.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Ignorieren - z.B. wenn der Browser die Pointer-ID nicht (mehr) kennt.
    }
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

  // CSS allein (touch-action/user-select/-webkit-touch-callout) unterdrückt das
  // lange-Halten-Kontextmenü ("Kopieren" etc.) nicht auf jedem Browser
  // zuverlässig (u.a. Android Chrome) - explizit verhindern.
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  dashBtn.addEventListener("contextmenu", (event) => event.preventDefault());
}
