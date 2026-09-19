import assert from "node:assert/strict";
import test from "node:test";

import { formatTime, normalizeString } from "../app/game-utils.js";

test("normalizes Maltese characters without changing established answers", () => {
  assert.equal(normalizeString("Żabbar"), "zabbar");
  assert.equal(normalizeString("Għaxaq"), "ghaxaq");
  assert.equal(normalizeString("L-Imsida"), "imsida");
  assert.equal(normalizeString("Raħal il-Ġdid"), "gdid");
  assert.equal(normalizeString("San Ġwann"), "san gwann");
  assert.equal(normalizeString("St. Julian's"), "julians");
  assert.equal(normalizeString("Saint Paul's Bay"), "saint pauls bay");
});

test("formats elapsed time exactly as the game UI expects", () => {
  assert.equal(formatTime(0), "00:00.00");
  assert.equal(formatTime(61_239), "01:01.23");
  assert.equal(formatTime(3_600_000), "60:00.00");
});
