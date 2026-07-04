// Synthetisierte Spiel-Sounds über die Web Audio API - es werden KEINE Asset-Dateien
// geladen, alle Effekte entstehen aus Oszillatoren (Chiptune-Blips), passend zum
// Pixel-Look. Als globales `Sound` bereitgestellt - bewusst NICHT `Audio`, das würde
// den eingebauten window.Audio-Konstruktor verdecken. Konstanten kommen aus config.js
// (AUDIO_*). Browser erlauben Audio erst nach einer Nutzergeste (Autoplay-Policy),
// daher wird unlock() aus einem Klick-Handler heraus aufgerufen (Play-/Mute-Button).
const Sound = (() => {
  const STORAGE_KEY = "snakeAudioMuted";

  let ctx = null;
  let masterGain = null; // SFX-Summe -> destination
  let muted = readMuted();
  let lastEatAt = 0;

  function readMuted() {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? AUDIO_DEFAULT_MUTED : v === "1";
  }

  function unlock() {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return; // Browser ohne Web Audio -> lautlos, aber kein Fehler
      ctx = new Ctx();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : AUDIO_MASTER_GAIN;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function currentTime() {
    return ctx ? ctx.currentTime : 0;
  }

  // Ein einzelner Ton mit kurzer Attack + exponentiellem Ausklingen; optional ein
  // Frequenz-Slide (Whoosh/Tod). Räumt sich nach Ablauf selbst auf (stop + disconnect),
  // damit sich keine Nodes ansammeln.
  function blip({ freq, type = "square", durMs, gain = 1, slideTo = null }) {
    const target = masterGain;
    if (!ctx || muted || !target) return;
    const t0 = currentTime();
    const dur = durMs / 1000;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    }
    const g = ctx.createGain();
    // exponentielle Rampen brauchen Werte > 0 (nie exakt 0).
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(target);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  function eat(scoreDelta) {
    if (!ctx || muted) return;
    const t = performance.now();
    if (t - lastEatAt < AUDIO_EAT_MIN_INTERVAL_MS) return; // nicht stapeln
    lastEatAt = t;
    const freq = Math.min(
      AUDIO_EAT_MAX_FREQ,
      AUDIO_EAT_BASE_FREQ + Math.max(0, scoreDelta - 1) * AUDIO_EAT_FREQ_PER_POINT
    );
    blip({ freq, type: "square", durMs: AUDIO_EAT_DURATION_MS, gain: 0.6 });
  }

  // Kurzer Puffer mit weißem Rauschen (einmal pro Whoosh erzeugt, danach verworfen).
  function makeNoiseBuffer(durSec) {
    const len = Math.max(1, Math.ceil(ctx.sampleRate * durSec));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Dash: weißes Rauschen durch ein aufsteigendes Bandpass-Filter = "Whoosh".
  function dashStart() {
    if (!ctx || muted) return;
    const t0 = currentTime();
    const dur = AUDIO_DASH_DURATION_MS / 1000;
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(dur + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = AUDIO_DASH_FILTER_Q;
    bp.frequency.setValueAtTime(AUDIO_DASH_FILTER_FROM, t0);
    bp.frequency.exponentialRampToValueAtTime(AUDIO_DASH_FILTER_TO, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(AUDIO_DASH_GAIN, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    src.onended = () => {
      src.disconnect();
      bp.disconnect();
      g.disconnect();
    };
  }

  function dashReady() {
    AUDIO_DASH_READY_FREQS.forEach((f, i) => {
      setTimeout(
        () => blip({ freq: f, type: "triangle", durMs: AUDIO_DASH_READY_DURATION_MS, gain: 0.4 }),
        i * AUDIO_DASH_READY_DURATION_MS * 0.8
      );
    });
  }

  function death() {
    blip({
      freq: AUDIO_DEATH_FREQ_FROM,
      type: "sawtooth",
      durMs: DEATH_ANIM_MS,
      gain: 0.55,
      slideTo: AUDIO_DEATH_FREQ_TO,
    });
  }

  function setMuted(value) {
    muted = !!value;
    localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    if (ctx && masterGain) {
      const t = currentTime();
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setTargetAtTime(muted ? 0 : AUDIO_MASTER_GAIN, t, 0.02);
    }
  }

  function isMuted() {
    return muted;
  }

  return { unlock, setMuted, isMuted, eat, dashStart, dashReady, death };
})();
