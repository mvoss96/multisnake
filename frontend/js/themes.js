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
//             renderer.js): boardTile, spike, foodCoin, foodGem, foodPotion.
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
    sprites: {
      boardTile: "tile_stone",
      spike: "spike_tile",
      foodCoin: "food_coin",
      foodGem: "food_gem",
      foodPotion: "food_potion",
    },
  },
];

const DEFAULT_THEME_ID = "classic";

// Liefert das Theme zur id, oder das Default-Theme bei unbekannter id.
function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME_ID);
}
