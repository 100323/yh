import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clubCarKing = readFileSync(resolve(__dirname, "../src/components/ClubCarKing.vue"), "utf8");
const carTaskCard = readFileSync(resolve(__dirname, "../src/components/CarTaskCard.vue"), "utf8");
const tokenWsMessaging = readFileSync(resolve(__dirname, "../src/stores/token/tokenWsMessaging.ts"), "utf8");

test("disabled car actions have no visible UI entry points", () => {
  for (const source of [clubCarKing, carTaskCard]) {
    const template = source.split("</template>")[0];
    assert.doesNotMatch(template, /智能发车/);
    assert.doesNotMatch(template, /一键收车/);
    assert.doesNotMatch(template, /@click=\"(?:sendCar|claimCar|smartSendCar|claimAllCars)/);
  }
});

test("the shared frontend websocket command boundary rejects car send and claim", () => {
  assert.match(tokenWsMessaging, /DISABLED_COMMANDS[\s\S]*car_send[\s\S]*car_claim/);
});
