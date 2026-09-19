/**
 * Normalize a locality name using the game's established matching rules.
 * Keep this function behavior-compatible: accepted answers are game content.
 */
export function normalizeString(value) {
  if (!value) return "";

  let normalized = value.toLowerCase();

  normalized = normalized.replace(/ġ/g, "g");
  normalized = normalized.replace(/ħ/g, "h");
  normalized = normalized.replace(/ċ/g, "c");
  normalized = normalized.replace(/ż/g, "z");
  normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  normalized = normalized.replace(/[-–—]/g, " ");
  normalized = normalized.replace(/[']/g, "");
  normalized = normalized.replace(/\s+/g, " ").trim();

  if (!normalized.includes("san") && !normalized.includes("bay")) {
    const lastSpaceIndex = normalized.lastIndexOf(" ");
    if (lastSpaceIndex !== -1) {
      normalized = normalized.substring(lastSpaceIndex + 1);
    }
  }

  return normalized;
}

export function formatTime(milliseconds) {
  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((totalSeconds * 100) % 100);

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}
