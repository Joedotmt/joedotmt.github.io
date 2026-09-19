const STORAGE_KEYS = Object.freeze({
  guessedIds: "lcgame_guessedIds",
  gamemode: "lcgame_gamemode",
  startTime: "lcgame_startTime",
});

export function saveProgress(guessedIds, gamemode) {
  localStorage.setItem(STORAGE_KEYS.guessedIds, JSON.stringify(guessedIds));
  localStorage.setItem(STORAGE_KEYS.gamemode, gamemode);
}

export function loadProgress() {
  let guessedIds = [];

  try {
    const storedIds = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.guessedIds) || "[]",
    );
    if (Array.isArray(storedIds)) guessedIds = storedIds;
  } catch (error) {
    console.warn("Ignoring invalid saved game data.", error);
  }

  const savedGamemode = Number.parseInt(
    localStorage.getItem(STORAGE_KEYS.gamemode),
    10,
  );

  return { guessedIds, savedGamemode };
}

export function saveStartTimestamp(timestamp) {
  localStorage.setItem(STORAGE_KEYS.startTime, timestamp);
}

export function loadStartTimestamp() {
  return Number.parseInt(localStorage.getItem(STORAGE_KEYS.startTime), 10);
}
