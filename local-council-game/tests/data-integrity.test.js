import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const alternateNames = JSON.parse(
  await readFile(new URL("../app/altnames.json", import.meta.url), "utf8"),
);
const originalNames = JSON.parse(
  await readFile(new URL("../app/originalnames.json", import.meta.url), "utf8"),
);
const coatOfArmsFiles = await readdir(
  new URL("../coas/", import.meta.url),
);

function sortedIds(records) {
  return records.map(({ LocalityId }) => LocalityId).sort((a, b) => a - b);
}

test("every locality has matching names and a coat-of-arms image", () => {
  const originalIds = sortedIds(originalNames);
  const alternateIds = sortedIds(alternateNames);
  const imageIds = coatOfArmsFiles
    .filter((filename) => /^\d+\.png$/.test(filename))
    .map((filename) => Number.parseInt(filename, 10))
    .sort((a, b) => a - b);

  assert.equal(new Set(originalIds).size, originalIds.length);
  assert.equal(new Set(alternateIds).size, alternateIds.length);
  assert.deepEqual(alternateIds, originalIds);
  assert.deepEqual(imageIds, originalIds);
});

test("every locality has at least one accepted answer", () => {
  for (const locality of alternateNames) {
    assert.ok(
      locality.Names.split(",").some((name) => name.trim().length > 0),
      `Locality ${locality.LocalityId} has no accepted names`,
    );
  }
});
