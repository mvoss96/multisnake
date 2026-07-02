// Theme-Registry - der einzige Ort, an dem ein Theme "was" definiert.
//
// Leitidee: Ein Theme beschreibt nur, WAS es überschreibt; alles Ungenannte
// fällt automatisch auf die Default-(Vektor-)Darstellung zurück. Dadurch ist
// "Klassisch" schlicht ein Theme ohne Sprites (alles Default), und ein neues
// Theme kommt in der Regel mit einem Eintrag hier + ein paar PNGs in
// frontend/assets/sprites/ + optional ein paar CSS-Regeln unter seiner
// bodyClass aus - renderer.js und main.js müssen dafür NICHT angefasst werden.
//
// Felder:
//   id        Stabile Kennung (localStorage-Wert + ?theme=<id>-URL-Parameter).
//   label     Beschriftung im Design-Umschalter (Namens-Modal, dynamisch erzeugt).
//   bodyClass CSS-Klasse an <body> für alle DOM-/HUD-Themings (siehe style.css),
//             oder null fürs Default-Aussehen.
//   sprites   Rollen-Name -> Sprite-Dateiname (ohne Pfad/.png). Nur genannte
//             Rollen werden im Canvas als Sprite gezeichnet; jede fehlende Rolle
//             bleibt die Default-Vektor-Variante. Bekannte Rollen (siehe
//             renderer.js): boardTile, spike, borderSprite (aufrechte Deko am
//             Kartenrand, ersetzt dort die Spikes), foodTier1/2/3 (nach Wert).
//   borderEdges  Array der Ränder, an denen borderSprite steht: "top" | "left" |
//             "right" | "bottom". Fehlt es (aber borderSprite ist gesetzt), gilt
//             ["top"]. Ohne borderSprite wird es ignoriert.
//   snakeScales  true = Schlangenkörper bekommt eine prozedurale Schuppen-/
//             Segment-Textur + dickere Kontur (farbecht, siehe renderer.js).
//             Fehlt/false = glatte Default-Vektor-Schlange.
//   pixelPerfect true = renderer.js rendert alle Sprites auf EINEM gemeinsamen
//             Art-Pixel-Raster (PIXEL_UNIT) und rastert Kamera/Zoom/Sprite-
//             Positionen auf ganze Pixel (knackiger Pixel-Art-Look, in Stufen).
//             Fehlt/false = weiche, kontinuierliche Kamera (Vektor-Look).
const THEMES = [
  {
    id: "classic",
    label: "Klassisch",
    bodyClass: null,
    sprites: {},
  },
  {
    id: "pixel",
    label: "Pixel-Art",
    bodyClass: "theme-pixel",
    snakeScales: true,
    pixelPerfect: true,
    borderEdges: ["top", "left"],
    sprites: {
      boardTile: "tile_forest",
      spike: "spike_tile",
      borderSprite: "tree",
      foodTier1: "food_strawberry",
      foodTier2: "food_gem",
      foodTier3: "food_potion",
    },
  },
];

const DEFAULT_THEME_ID = "classic";

// Liefert das Theme zur id, oder das Default-Theme bei unbekannter id.
function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME_ID);
}
