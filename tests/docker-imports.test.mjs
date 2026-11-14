import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('every app file the server imports is copied into the container', () => {
  const docker = read('Dockerfile');
  const files = readdirSync(new URL('server/', root)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const needed = new Set();
  for (const f of files) {
    for (const m of read(`server/${f}`).matchAll(/from '\.\.\/(src\/[^']+)'/g)) needed.add(m[1]);
  }
  assert.ok(needed.size > 0);
  for (const p of needed) assert.ok(docker.includes(`COPY ${p} ./${p}`), `Dockerfile copies ${p}`);
});
