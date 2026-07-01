import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, "../src/components/cards/SkinChallengeCard.vue"),
  "utf8",
);

test("SkinChallengeCard requests the active tower activity id explicitly", () => {
  assert.match(source, /import\s+\{\s*getTowerActId\s*\}\s+from\s+["']@\/utils\/towerActId\.js["']/);
  assert.match(
    source,
    /sendMessageWithPromise\(\s*tokenId,\s*["']towers_getinfo["'],\s*\{\s*actId:\s*getTowerActId\(\)\s*\}/s,
  );
});
