import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexHtml = await readFile(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const appJavaScript = await readFile(
  new URL("../app/app.js", import.meta.url),
  "utf8",
);

test("the start dialog disables native close requests", () => {
  const startDialog = indexHtml.match(
    /<dialog\s+[\s\S]*?id="start-overlay"[\s\S]*?>/,
  );

  assert.ok(startDialog, "The start overlay must remain a dialog");
  assert.match(startDialog[0], /\bopen\b/);
  assert.match(startDialog[0], /closedby="none"/);
});

test("the start dialog guards cancel, Escape, and unexpected close events", () => {
  assert.match(
    appJavaScript,
    /startOverlay\.addEventListener\("cancel",[\s\S]*?preventDefault\(\)/,
  );
  assert.match(
    appJavaScript,
    /startOverlay\.addEventListener\([\s\S]*?"keydown"[\s\S]*?event\.key !== "Escape"/,
  );
  assert.match(
    appJavaScript,
    /startOverlay\.addEventListener\("close",[\s\S]*?showModal\(\)/,
  );
});
