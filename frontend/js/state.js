const GameState = {
  playerId: null,
  board: { width: 0, height: 0 },
  ownDirection: 0,
  controlMode: localStorage.getItem("snakeControlMode") || "absolute",
};
