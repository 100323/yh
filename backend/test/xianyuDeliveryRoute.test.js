import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = resolve(__dirname, '..');

test('backend mounts Goofish delivery route', () => {
  const source = readFileSync(resolve(backendRoot, 'src/index.js'), 'utf8');

  assert.match(source, /import deliveryRoutes from '\.\/routes\/delivery\.js';/);
  assert.match(source, /app\.use\('\/api\/delivery', deliveryRoutes\);/);
});

test('delivery route keeps the Goofish invite-code contract', () => {
  const source = readFileSync(resolve(backendRoot, 'src/routes/delivery.js'), 'utf8');

  assert.match(source, /router\.post\('\/xianyu\/invite-code'/);
  assert.match(source, /XIAN_YU_DELIVERY_SECRET/);
  assert.match(source, /PROJECT_PUBLIC_URL/);
  assert.match(source, /registered_user_access_days/);
  assert.match(source, /message/);
  assert.match(source, /accessDays/);
});
